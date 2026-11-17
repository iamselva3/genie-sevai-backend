import { config } from '../config';
import { AdminUser, Booking, Category, City, Coupon, Customer, Professional, Service } from '../models';
import { generateCode, generatePin } from '../services/bookingFlow';
import { hashPassword } from '../services/tokens';
import { slugify } from '../utils/slugify';
import { addDays, addMinutes, localDate, slotInstant } from '../utils/time';
import { CATEGORIES, CITIES, COUPONS, FIRST_NAMES, flattenServices, LAST_NAMES } from './data';

export const SEED_PRO_PASSWORD = 'Pro@12345';
export const SEED_MANAGER = { email: 'ops@sevai.in', password: 'Ops@12345' };
export const DEMO_CUSTOMER_PHONE = '9876543210';

/** Small deterministic PRNG so seeded ratings look varied but repeatable. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Seeds an empty database. Returns counts of what was created. */
export async function runSeed(opts: { demoBookings?: boolean } = {}) {
  const rand = rng(42);

  const cities = await City.insertMany(CITIES.map((c, i) => ({ ...c, sortOrder: i })));
  const cityBySlug = new Map(cities.map((c) => [c.slug, c]));

  const categories = await Category.insertMany(
    CATEGORIES.map((c, i) => ({ name: c.name, slug: c.slug, icon: c.icon, tagline: c.tagline, description: c.description, sortOrder: i })),
  );

  const serviceDocs = CATEGORIES.flatMap((c, ci) =>
    flattenServices(c).map((s, si) => ({
      ...s,
      category: categories[ci]._id,
      slug: slugify(s.name),
      description: `${s.name}. ${c.description}`,
      cities: s.cities.map((slug) => cityBySlug.get(slug)!._id),
      rating: Math.round((4.55 + rand() * 0.4) * 100) / 100,
      ratingCount: Math.floor(800 + rand() * 24000),
      sortOrder: si,
    })),
  );
  const services = await Service.insertMany(serviceDocs);

  // Two professionals per active city and category, plus a multi-skill handyman in Chennai.
  const proHash = await hashPassword(SEED_PRO_PASSWORD);
  const activeCities = cities.filter((c) => c.isActive);
  const pros: Record<string, unknown>[] = [];
  activeCities.forEach((city, ci) => {
    categories.forEach((cat, ki) => {
      for (let n = 1; n <= 2; n += 1) {
        const idx = ci * 31 + ki * 7 + n * 3;
        pros.push({
          name: `${FIRST_NAMES[idx % FIRST_NAMES.length]} ${LAST_NAMES[(idx * 3 + n) % LAST_NAMES.length]}`,
          // 9 + city + category + n + 55555  -> e.g. 9102155555 (Chennai, Home Cleaning, #1)
          phone: `9${ci + 1}${String(ki).padStart(2, '0')}${n}55555`,
          passwordHash: proHash,
          city: city._id,
          skills: [cat._id],
          experienceYears: 2 + Math.floor(rand() * 9),
          bio: `${cat.name} specialist`,
          rating: Math.round((4.5 + rand() * 0.45) * 100) / 100,
          ratingCount: Math.floor(40 + rand() * 360),
          jobsCompleted: Math.floor(60 + rand() * 900),
        });
      }
    });
  });
  const bySlug = (slug: string) => categories.find((c) => c.slug === slug)!._id;
  pros.push({
    name: 'Mohan Das',
    phone: '9000000001',
    passwordHash: proHash,
    city: cityBySlug.get('chennai')!._id,
    skills: [bySlug('electrician'), bySlug('plumbing'), bySlug('carpentry')],
    experienceYears: 12,
    bio: 'All-round handyman',
    rating: 4.92,
    ratingCount: 512,
    jobsCompleted: 1430,
  });
  const professionals = await Professional.insertMany(pros);

  await AdminUser.create([
    { name: 'Genie Sevai Admin', email: config.admin.email, passwordHash: await hashPassword(config.admin.password), role: 'admin' },
    { name: 'Operations Desk', email: SEED_MANAGER.email, passwordHash: await hashPassword(SEED_MANAGER.password), role: 'manager' },
  ]);

  await Coupon.insertMany(COUPONS);

  let bookings = 0;
  if (opts.demoBookings) bookings = await seedDemoBookings();

  return {
    cities: cities.length,
    categories: categories.length,
    services: services.length,
    professionals: professionals.length,
    coupons: COUPONS.length,
    bookings,
  };
}

/** A demo customer with a few bookings in different states so the admin dashboard has data. */
async function seedDemoBookings() {
  const chennai = await City.findOne({ slug: 'chennai' });
  if (!chennai) return 0;
  const customer = await Customer.create({
    phone: DEMO_CUSTOMER_PHONE,
    name: 'Priya Raman',
    email: 'priya@example.com',
    addresses: [{ label: 'Home', line1: '12, Lotus Apartments, 3rd Main Road', line2: 'Adyar', landmark: 'Near Adyar Depot', city: 'chennai', pincode: '600020', isDefault: true }],
  });
  const address = customer.addresses[0];
  const today = localDate();

  const plan: { slug: string; dayOffset: number; time: string; status: string; rating?: number }[] = [
    { slug: 'bathroom-deep-cleaning', dayOffset: -3, time: '10:00', status: 'completed', rating: 5 },
    { slug: 'foam-jet-ac-service-split', dayOffset: -10, time: '15:00', status: 'completed', rating: 4 },
    { slug: 'cockroach-control-1-bhk', dayOffset: -2, time: '12:00', status: 'cancelled' },
    { slug: 'tap-repair-replacement', dayOffset: 1, time: '11:00', status: 'pending' },
    { slug: 'ceiling-fan-installation', dayOffset: 2, time: '16:00', status: 'assigned' },
  ];

  let created = 0;
  for (const p of plan) {
    const service = await Service.findOne({ slug: p.slug }).populate('category');
    if (!service) continue;
    const category = service.category as unknown as InstanceType<typeof Category>;
    const date = addDays(today, p.dayOffset);
    const start = slotInstant(date, p.time);
    const pro =
      p.status === 'pending'
        ? null
        : await Professional.findOne({ city: chennai._id, skills: category._id, status: 'active' }).sort({ phone: 1 });
    const subtotal = service.price;
    const visitFee = subtotal >= config.pricing.freeVisitAbove ? 0 : config.pricing.visitFee;
    const placedAt = addMinutes(start, -60 * 24 * 2);
    const timeline: Record<string, unknown>[] = [{ status: 'pending', actor: 'customer', note: 'Booking placed', at: placedAt }];
    if (pro) timeline.push({ status: 'assigned', actor: 'admin', note: `${pro.name} assigned`, at: addMinutes(placedAt, 30) });
    if (p.status === 'completed') {
      timeline.push({ status: 'on_the_way', actor: 'professional', note: 'Professional is on the way', at: addMinutes(start, -30) });
      timeline.push({ status: 'in_progress', actor: 'professional', note: 'Service started', at: start });
      timeline.push({ status: 'completed', actor: 'professional', note: 'Service completed', at: addMinutes(start, service.durationMinutes) });
    }
    if (p.status === 'cancelled') timeline.push({ status: 'cancelled', actor: 'customer', note: 'Plans changed', at: addMinutes(placedAt, 60) });

    await Booking.create({
      code: generateCode(),
      customer: customer._id,
      category: category._id,
      categoryName: category.name,
      city: chennai._id,
      cityName: chennai.name,
      items: [{ service: service._id, name: service.name, price: service.price, mrp: service.mrp, qty: 1, durationMinutes: service.durationMinutes }],
      address: { label: address.label, line1: address.line1, line2: address.line2, landmark: address.landmark, city: chennai.name, pincode: address.pincode },
      slot: { date, time: p.time, start, end: addMinutes(start, service.durationMinutes + config.booking.bufferMinutes) },
      durationMinutes: service.durationMinutes,
      pricing: { subtotal, discount: 0, visitFee, total: subtotal + visitFee, couponCode: '' },
      paymentStatus: p.status === 'completed' ? 'paid' : 'pending',
      status: p.status,
      professional: pro?._id ?? null,
      pin: generatePin(),
      timeline,
      cancellation: p.status === 'cancelled' ? { reason: 'Plans changed', by: 'customer', at: addMinutes(placedAt, 60) } : null,
      review: p.rating ? { rating: p.rating, comment: p.rating === 5 ? 'Spotless work, very polite.' : 'Good service, came 10 minutes late.', at: addMinutes(start, 200), hidden: false } : null,
      createdAt: placedAt,
    });
    created += 1;
  }
  return created;
}
