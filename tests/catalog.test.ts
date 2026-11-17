import { adminToken, api, auth, useDatabase } from './helpers';
import { Category, Service } from '../src/models';

useDatabase();

describe('public catalogue', () => {
  it('lists only active cities', async () => {
    const res = await api().get('/api/v1/cities').expect(200);
    const slugs = res.body.cities.map((c: { slug: string }) => c.slug);
    expect(slugs).toEqual(expect.arrayContaining(['chennai', 'bengaluru']));
    expect(slugs).not.toContain('salem');
  });

  it('returns home data with categories, popular services and stats', async () => {
    const res = await api().get('/api/v1/catalog/home?city=chennai').expect(200);
    expect(res.body.categories).toHaveLength(10);
    expect(res.body.popular.length).toBeGreaterThan(5);
    expect(res.body.stats.professionals).toBeGreaterThan(0);
    const cleaning = res.body.categories.find((c: { slug: string }) => c.slug === 'cleaning');
    expect(cleaning.startingPrice).toBe(499);
    // Category shelves: first three categories, each with its own services
    expect(res.body.rows).toHaveLength(3);
    expect(res.body.rows[0].category.slug).toBe('salon-women');
    for (const row of res.body.rows) {
      expect(row.services.length).toBeGreaterThan(0);
      expect(row.services.length).toBeLessThanOrEqual(8);
      expect(row.services.every((s: { category: { slug: string } }) => s.category.slug === row.category.slug)).toBe(true);
    }
  });

  it('shows unavailable services as not bookable, with the reason', async () => {
    const res = await api().get('/api/v1/catalog/categories/cleaning').expect(200);
    const sofa = res.body.services.find((s: { slug: string }) => s.slug === 'sofa-shampooing-5-seats');
    expect(sofa.bookable).toBe(false);
    expect(sofa.unavailableReason).toMatch(/serviced/);
    expect(res.body.groups).toEqual(['Bathroom', 'Kitchen', 'Full home', 'Sofa & carpet']);
  });

  it('never exposes hidden services', async () => {
    const res = await api().get('/api/v1/catalog/categories/appliances').expect(200);
    expect(res.body.services.map((s: { slug: string }) => s.slug)).not.toContain('geyser-check-up');
    await api().get('/api/v1/catalog/services/geyser-check-up').expect(404);
    const search = await api().get('/api/v1/catalog/search?q=geyser').expect(200);
    expect(search.body.services).toHaveLength(0);
  });

  it('marks city-restricted services per city', async () => {
    const madurai = await api().get('/api/v1/catalog/services/bathroom-waterproofing?city=madurai').expect(200);
    expect(madurai.body.service.bookable).toBe(false);
    expect(madurai.body.service.unavailableReason).toBe('Not available in Madurai yet');
    const chennai = await api().get('/api/v1/catalog/services/bathroom-waterproofing?city=chennai').expect(200);
    expect(chennai.body.service.bookable).toBe(true);
  });

  it('searches services by name, group and category', async () => {
    const res = await api().get('/api/v1/catalog/search?q=clean').expect(200);
    expect(res.body.services.length).toBeGreaterThan(3);
    const regexChars = await api().get('/api/v1/catalog/search?q=(.*').expect(200);
    expect(regexChars.body.services).toHaveLength(0);
    await api().get('/api/v1/catalog/search?q=').expect(400);
  });

  it('lists 7 days of slots with availability', async () => {
    const res = await api().get('/api/v1/slots?city=chennai&category=cleaning').expect(200);
    expect(res.body.days).toHaveLength(7);
    expect(res.body.capacity).toBe(2);
    expect(res.body.days[1].slots).toHaveLength(12);
    expect(res.body.days[1].slots.every((s: { available: boolean }) => s.available)).toBe(true);
  });

  it('lists public coupons', async () => {
    const res = await api().get('/api/v1/coupons').expect(200);
    expect(res.body.coupons.map((c: { code: string }) => c.code)).toContain('WELCOME100');
  });
});

describe('admin visibility controls reach the customer catalogue', () => {
  let token: string;
  beforeAll(async () => {
    token = await adminToken();
  });

  it('hiding a category removes it from the site', async () => {
    const category = await Category.findOne({ slug: 'pest-control' });
    await api().patch(`/api/v1/admin/categories/${category!._id}`).set(auth(token)).send({ isActive: false }).expect(200);
    const home = await api().get('/api/v1/catalog/home').expect(200);
    expect(home.body.categories.map((c: { slug: string }) => c.slug)).not.toContain('pest-control');
    await api().get('/api/v1/catalog/categories/pest-control').expect(404);
    await api().get('/api/v1/catalog/services/mosquito-control').expect(404);
    await api().patch(`/api/v1/admin/categories/${category!._id}`).set(auth(token)).send({ isActive: true }).expect(200);
    await api().get('/api/v1/catalog/categories/pest-control').expect(200);
  });

  it('service status changes are reflected immediately', async () => {
    const service = await Service.findOne({ slug: 'kitchen-deep-cleaning' });
    const url = `/api/v1/admin/services/${service!._id}/status`;

    await api().patch(url).set(auth(token)).send({ status: 'unavailable', unavailableReason: 'Crew on leave' }).expect(200);
    let res = await api().get('/api/v1/catalog/services/kitchen-deep-cleaning').expect(200);
    expect(res.body.service).toMatchObject({ bookable: false, unavailableReason: 'Crew on leave' });

    await api().patch(url).set(auth(token)).send({ status: 'hidden' }).expect(200);
    await api().get('/api/v1/catalog/services/kitchen-deep-cleaning').expect(404);

    await api().patch(url).set(auth(token)).send({ status: 'active' }).expect(200);
    res = await api().get('/api/v1/catalog/services/kitchen-deep-cleaning').expect(200);
    expect(res.body.service.bookable).toBe(true);
  });

  it('creates a category and service that customers can see', async () => {
    const cat = await api()
      .post('/api/v1/admin/categories')
      .set(auth(token))
      .send({ name: 'Laundry & Ironing', tagline: 'Picked up, pressed, returned', icon: 'shirt' })
      .expect(201);
    expect(cat.body.category.slug).toBe('laundry-ironing');
    await api()
      .post('/api/v1/admin/services')
      .set(auth(token))
      .send({ category: cat.body.category.id, name: 'Wash & iron (5 kg)', price: 399, durationMinutes: 30 })
      .expect(201);
    const res = await api().get('/api/v1/catalog/categories/laundry-ironing').expect(200);
    expect(res.body.services).toHaveLength(1);
    // Category with services cannot be deleted
    await api().delete(`/api/v1/admin/categories/${cat.body.category.id}`).set(auth(token)).expect(409);
  });

  it('validates admin input', async () => {
    await api().post('/api/v1/admin/services').set(auth(token)).send({ name: 'x' }).expect(400);
    await api().patch('/api/v1/admin/services/not-an-id/status').set(auth(token)).send({ status: 'active' }).expect(404);
  });
});
