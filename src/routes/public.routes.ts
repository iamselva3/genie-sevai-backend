import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { optionalCustomer } from '../middleware/auth';
import { Booking, Category, City, Coupon, Enquiry, ProApplication, Professional, Service } from '../models';
import { findCityBySlug, presentCategory, presentService, visibleCategories } from '../services/catalog';
import { slotDays } from '../services/slots';
import { badRequest, notFound } from '../utils/errors';
import { escapeRegex, objectId, parse, phone } from '../utils/validate';

const router = Router();

const cityQuery = z.object({ city: z.string().trim().toLowerCase().max(60).optional() });

router.get('/cities', async (_req, res) => {
  const cities = await City.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
  res.json({ cities: cities.map((c) => ({ id: String(c._id), slug: c.slug, name: c.name, state: c.state })) });
});

router.get('/catalog/home', async (req, res) => {
  const { city: citySlug } = parse(cityQuery, req.query);
  const city = await findCityBySlug(citySlug);
  const categories = await visibleCategories(city);
  const visibleIds = categories.map((c) => c.id);

  const popularDocs = await Service.find({ category: { $in: visibleIds }, status: { $ne: 'hidden' }, isPopular: true })
    .sort({ sortOrder: 1, ratingCount: -1 })
    .limit(12)
    .populate('category');

  const [pros, completed, ratingAgg] = await Promise.all([
    Professional.countDocuments({ status: 'active', ...(city ? { city: city._id } : {}) }),
    Booking.countDocuments({ status: 'completed' }),
    Professional.aggregate<{ avg: number }>([
      { $match: { status: 'active', ratingCount: { $gt: 0 } } },
      { $group: { _id: null, avg: { $avg: '$rating' } } },
    ]),
  ]);

  // A few category "shelves" for the home page (first visible categories that have bookable services).
  const rowCategories = categories.filter((c) => ((c as { bookableCount?: number }).bookableCount ?? 0) > 0).slice(0, 3);
  const rowDocs = await Service.find({ category: { $in: rowCategories.map((c) => c.id) }, status: { $ne: 'hidden' } })
    .sort({ sortOrder: 1, name: 1 })
    .populate('category');
  const rows = rowCategories.map((c) => ({
    category: c,
    services: rowDocs
      .filter((s) => String((s.category as unknown as { _id: unknown })._id) === c.id)
      .slice(0, 8)
      .map((s) => presentService(s, s.category as never, city)),
  }));

  res.json({
    city: city ? { slug: city.slug, name: city.name } : null,
    categories,
    rows,
    popular: popularDocs.map((s) => presentService(s, s.category as never, city)),
    stats: {
      professionals: pros,
      completedBookings: completed,
      averageRating: ratingAgg[0] ? Math.round(ratingAgg[0].avg * 10) / 10 : null,
    },
  });
});

router.get('/catalog/categories', async (req, res) => {
  const { city: citySlug } = parse(cityQuery, req.query);
  const city = await findCityBySlug(citySlug);
  res.json({ categories: await visibleCategories(city) });
});

router.get('/catalog/categories/:slug', async (req, res) => {
  const { city: citySlug } = parse(cityQuery, req.query);
  const category = await Category.findOne({ slug: req.params.slug.toLowerCase(), isActive: true });
  if (!category) throw notFound('Category');
  const city = await findCityBySlug(citySlug);
  const services = await Service.find({ category: category._id, status: { $ne: 'hidden' } }).sort({ sortOrder: 1, name: 1 });
  const presented = services.map((s) => presentService(s, category, city));
  const groups = [...new Set(presented.map((s) => s.group))];
  const professionals = city
    ? await Professional.countDocuments({ status: 'active', city: city._id, skills: category._id })
    : await Professional.countDocuments({ status: 'active', skills: category._id });
  res.json({ category: presentCategory(category, { professionals }), groups, services: presented });
});

router.get('/catalog/services/:slug', async (req, res) => {
  const { city: citySlug } = parse(cityQuery, req.query);
  const service = await Service.findOne({ slug: req.params.slug.toLowerCase(), status: { $ne: 'hidden' } }).populate('category');
  const category = service?.category as unknown as InstanceType<typeof Category> | undefined;
  if (!service || !category || !category.isActive) throw notFound('Service');
  const city = await findCityBySlug(citySlug);
  res.json({ service: presentService(service, category, city) });
});

router.get('/catalog/search', async (req, res) => {
  const { q, city: citySlug } = parse(
    z.object({ q: z.string().trim().min(1, 'Type something to search').max(60), city: z.string().trim().toLowerCase().optional() }),
    req.query,
  );
  const city = await findCityBySlug(citySlug);
  const pattern = new RegExp(escapeRegex(q), 'i');
  const categories = await Category.find({ isActive: true });
  const visibleIds = categories.map((c) => c._id);
  const matchedCategoryIds = categories.filter((c) => pattern.test(c.name) || pattern.test(c.tagline)).map((c) => c._id);
  const services = await Service.find({
    category: { $in: visibleIds },
    status: { $ne: 'hidden' },
    $or: [{ name: pattern }, { group: pattern }, { shortDescription: pattern }, { category: { $in: matchedCategoryIds } }],
  })
    .sort({ ratingCount: -1 })
    .limit(20)
    .populate('category');
  res.json({
    categories: categories.filter((c) => matchedCategoryIds.some((id) => id.equals(c._id))).map((c) => presentCategory(c)),
    services: services.map((s) => presentService(s, s.category as never, city)),
  });
});

router.get('/slots', async (req, res) => {
  const q = parse(
    z.object({
      city: z.string().trim().toLowerCase().min(1, 'Choose a city'),
      category: z.string().trim().toLowerCase().min(1, 'Choose a category'),
      exclude: objectId.optional(),
    }),
    req.query,
  );
  const city = await findCityBySlug(q.city);
  if (!city) throw badRequest('We do not serve this city yet', 'CITY_UNAVAILABLE');
  const category = await Category.findOne({ slug: q.category, isActive: true });
  if (!category) throw notFound('Category');
  const result = await slotDays({
    cityId: city._id,
    categoryId: category._id,
    excludeBookingId: q.exclude ? new Types.ObjectId(q.exclude) : null,
  });
  res.json(result);
});

router.get('/coupons', async (_req, res) => {
  const now = new Date();
  const coupons = await Coupon.find({
    isActive: true,
    isPublic: true,
    $and: [
      { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
      { $or: [{ validTo: null }, { validTo: { $gte: now } }] },
    ],
  }).sort({ minOrder: 1 });
  res.json({
    coupons: coupons
      .filter((c) => c.usageLimit === 0 || c.usedCount < c.usageLimit)
      .map((c) => ({ code: c.code, description: c.description, type: c.type, value: c.value, maxDiscount: c.maxDiscount, minOrder: c.minOrder })),
  });
});

router.post('/enquiries', optionalCustomer, async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2, 'Tell us your name').max(80),
      phone,
      email: z.string().trim().email('Enter a valid email').max(120).optional().or(z.literal('')),
      topic: z.string().trim().max(60).optional(),
      message: z.string().trim().min(10, 'Tell us a little more (10+ characters)').max(2000),
      bookingCode: z.string().trim().max(12).optional(),
    }),
    req.body,
  );
  const enquiry = await Enquiry.create({ ...body, customer: req.customer?._id ?? null });
  res.status(201).json({ enquiry: { id: String(enquiry._id), status: enquiry.status } });
});

router.post('/pro-applications', async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2, 'Tell us your name').max(80),
      phone,
      city: z.string().trim().min(2, 'Which city do you work in?').max(60),
      skills: z.array(z.string().trim().min(1).max(60)).min(1, 'Pick at least one skill').max(10),
      experienceYears: z.coerce.number().int().min(0).max(50),
      message: z.string().trim().max(1000).optional(),
    }),
    req.body,
  );
  const existing = await ProApplication.findOne({ phone: body.phone, status: { $in: ['new', 'contacted'] } });
  if (existing) {
    res.status(200).json({ application: { id: String(existing._id), status: existing.status }, duplicate: true });
    return;
  }
  const application = await ProApplication.create(body);
  res.status(201).json({ application: { id: String(application._id), status: application.status }, duplicate: false });
});

export default router;
