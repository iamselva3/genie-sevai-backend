import { Router } from 'express';
import { isValidObjectId, Model } from 'mongoose';
import { z } from 'zod';
import { Booking, Category, City, Professional, Service, SERVICE_STATUSES } from '../../models';
import { conflict, notFound } from '../../utils/errors';
import { slugify } from '../../utils/slugify';
import { escapeRegex, objectId, parse, slug } from '../../utils/validate';

const router = Router();

async function uniqueSlug(model: Model<{ slug: string }>, base: string, excludeId?: string) {
  const root = slugify(base) || 'item';
  let candidate = root;
  for (let i = 2; ; i += 1) {
    const clash = await model.exists(excludeId ? { slug: candidate, _id: { $ne: excludeId } } : { slug: candidate });
    if (!clash) return candidate;
    candidate = `${root}-${i}`;
  }
}

function idParam(id: string, what: string) {
  if (!isValidObjectId(id)) throw notFound(what);
  return id;
}

/* ---------------- Cities ---------------- */

const cityBody = z.object({
  name: z.string().trim().min(2).max(60),
  slug: slug.optional(),
  state: z.string().trim().max(60).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

router.get('/cities', async (_req, res) => {
  const [cities, pros] = await Promise.all([
    City.find().sort({ sortOrder: 1, name: 1 }),
    Professional.aggregate<{ _id: unknown; n: number }>([{ $group: { _id: '$city', n: { $sum: 1 } } }]),
  ]);
  const counts = new Map(pros.map((p) => [String(p._id), p.n]));
  res.json({ cities: cities.map((c) => ({ ...c.toJSON(), professionals: counts.get(String(c._id)) || 0 })) });
});

router.post('/cities', async (req, res) => {
  const body = parse(cityBody, req.body);
  const city = await City.create({ ...body, slug: body.slug || (await uniqueSlug(City as never, body.name)) });
  res.status(201).json({ city });
});

router.patch('/cities/:id', async (req, res) => {
  const body = parse(cityBody.partial(), req.body);
  const city = await City.findByIdAndUpdate(idParam(req.params.id, 'City'), body, { new: true, runValidators: true });
  if (!city) throw notFound('City');
  res.json({ city });
});

router.delete('/cities/:id', async (req, res) => {
  const id = idParam(req.params.id, 'City');
  const [pros, bookings] = await Promise.all([Professional.countDocuments({ city: id }), Booking.countDocuments({ city: id })]);
  if (pros || bookings) throw conflict('This city has professionals or bookings. Turn it off instead of deleting.', 'IN_USE');
  const city = await City.findByIdAndDelete(id);
  if (!city) throw notFound('City');
  await Service.updateMany({ cities: id }, { $pull: { cities: id } });
  res.json({ ok: true });
});

/* ---------------- Categories ---------------- */

const categoryBody = z.object({
  name: z.string().trim().min(2).max(60),
  slug: slug.optional(),
  tagline: z.string().trim().max(120).optional(),
  description: z.string().trim().max(1000).optional(),
  icon: z.string().trim().max(40).optional(),
  imageUrl: z.string().trim().url('Enter a full image URL').max(500).optional().or(z.literal('')),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

router.get('/categories', async (_req, res) => {
  const [categories, counts] = await Promise.all([
    Category.find().sort({ sortOrder: 1, name: 1 }),
    Service.aggregate<{ _id: { c: unknown; s: string }; n: number }>([
      { $group: { _id: { c: '$category', s: '$status' }, n: { $sum: 1 } } },
    ]),
  ]);
  res.json({
    categories: categories.map((c) => {
      const mine = counts.filter((r) => String(r._id.c) === String(c._id));
      const by = (s: string) => mine.find((r) => r._id.s === s)?.n || 0;
      return { ...c.toJSON(), services: { active: by('active'), unavailable: by('unavailable'), hidden: by('hidden') } };
    }),
  });
});

router.post('/categories', async (req, res) => {
  const body = parse(categoryBody, req.body);
  const category = await Category.create({ ...body, slug: body.slug || (await uniqueSlug(Category as never, body.name)) });
  res.status(201).json({ category });
});

router.patch('/categories/:id', async (req, res) => {
  const body = parse(categoryBody.partial(), req.body);
  const category = await Category.findByIdAndUpdate(idParam(req.params.id, 'Category'), body, { new: true, runValidators: true });
  if (!category) throw notFound('Category');
  res.json({ category });
});

router.delete('/categories/:id', async (req, res) => {
  const id = idParam(req.params.id, 'Category');
  const services = await Service.countDocuments({ category: id });
  if (services) throw conflict(`Delete or move its ${services} services first, or hide the category instead.`, 'IN_USE');
  const bookings = await Booking.countDocuments({ category: id });
  if (bookings) throw conflict('This category has bookings. Hide it instead of deleting.', 'IN_USE');
  const category = await Category.findByIdAndDelete(id);
  if (!category) throw notFound('Category');
  await Professional.updateMany({ skills: id }, { $pull: { skills: id } });
  res.json({ ok: true });
});

/* ---------------- Services ---------------- */

const serviceBody = z.object({
  category: objectId,
  name: z.string().trim().min(2).max(100),
  slug: slug.optional(),
  group: z.string().trim().max(60).optional(),
  shortDescription: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  inclusions: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  exclusions: z.array(z.string().trim().min(1).max(120)).max(12).optional(),
  price: z.coerce.number().int().min(0).max(500000),
  mrp: z.coerce.number().int().min(0).max(500000).optional(),
  durationMinutes: z.coerce.number().int().min(10).max(24 * 60),
  status: z.enum(SERVICE_STATUSES).optional(),
  unavailableReason: z.string().trim().max(120).optional(),
  cities: z.array(objectId).max(100).optional(),
  isPopular: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
  imageUrl: z.string().trim().url('Enter a full image URL').max(500).optional().or(z.literal('')),
});

async function assertCategory(id?: string) {
  if (id && !(await Category.exists({ _id: id }))) throw notFound('Category');
}

router.get('/services', async (req, res) => {
  const q = parse(
    z.object({ category: objectId.optional(), status: z.enum(SERVICE_STATUSES).optional(), q: z.string().trim().max(60).optional() }),
    req.query,
  );
  const filter: Record<string, unknown> = {};
  if (q.category) filter.category = q.category;
  if (q.status) filter.status = q.status;
  if (q.q) filter.name = new RegExp(escapeRegex(q.q), 'i');
  const services = await Service.find(filter).sort({ sortOrder: 1, name: 1 }).populate('category', 'name slug').populate('cities', 'name slug');
  res.json({ services });
});

router.get('/services/:id', async (req, res) => {
  const service = await Service.findById(idParam(req.params.id, 'Service')).populate('category', 'name slug');
  if (!service) throw notFound('Service');
  res.json({ service });
});

router.post('/services', async (req, res) => {
  const body = parse(serviceBody, req.body);
  await assertCategory(body.category);
  const service = await Service.create({ ...body, slug: body.slug || (await uniqueSlug(Service as never, body.name)) });
  res.status(201).json({ service });
});

router.patch('/services/:id', async (req, res) => {
  const body = parse(serviceBody.partial(), req.body);
  await assertCategory(body.category);
  const id = idParam(req.params.id, 'Service');
  if (body.slug && (await Service.exists({ slug: body.slug, _id: { $ne: id } }))) throw conflict('That slug is already in use', 'DUPLICATE');
  const service = await Service.findByIdAndUpdate(id, body, { new: true, runValidators: true }).populate('category', 'name slug');
  if (!service) throw notFound('Service');
  res.json({ service });
});

router.patch('/services/:id/status', async (req, res) => {
  const body = parse(
    z.object({ status: z.enum(SERVICE_STATUSES), unavailableReason: z.string().trim().max(120).optional() }),
    req.body,
  );
  const update: Record<string, unknown> = { status: body.status };
  if (body.unavailableReason !== undefined) update.unavailableReason = body.unavailableReason;
  const service = await Service.findByIdAndUpdate(idParam(req.params.id, 'Service'), update, { new: true }).populate('category', 'name slug');
  if (!service) throw notFound('Service');
  res.json({ service });
});

router.delete('/services/:id', async (req, res) => {
  const service = await Service.findByIdAndDelete(idParam(req.params.id, 'Service'));
  if (!service) throw notFound('Service');
  res.json({ ok: true });
});

export default router;
