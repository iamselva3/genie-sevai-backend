import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { ACTIVE_JOB_STATUSES, Booking, Category, City, Customer, Professional, PRO_STATUSES } from '../../models';
import { hashPassword } from '../../services/tokens';
import { badRequest, conflict, notFound } from '../../utils/errors';
import { escapeRegex, objectId, pagination, parse, phone } from '../../utils/validate';

const router = Router();

/* ---------------- Professionals ---------------- */

const proBody = z.object({
  name: z.string().trim().min(2).max(80),
  phone,
  email: z.string().trim().email('Enter a valid email').max(120).optional().or(z.literal('')),
  password: z.string().min(6, 'Use at least 6 characters').max(100),
  city: objectId,
  skills: z.array(objectId).min(1, 'Pick at least one skill').max(20),
  experienceYears: z.coerce.number().int().min(0).max(50).optional(),
  bio: z.string().trim().max(500).optional(),
  status: z.enum(PRO_STATUSES).optional(),
});

async function assertRefs(city?: string, skills?: string[]) {
  if (city && !(await City.exists({ _id: city }))) throw badRequest('Choose a valid city', 'BAD_CITY');
  if (skills && (await Category.countDocuments({ _id: { $in: skills } })) !== new Set(skills).size) {
    throw badRequest('One of the skills does not exist', 'BAD_SKILL');
  }
}

router.get('/professionals', async (req, res) => {
  const q = parse(
    z.object({
      city: objectId.optional(),
      skill: objectId.optional(),
      status: z.enum(PRO_STATUSES).optional(),
      q: z.string().trim().max(60).optional(),
    }),
    req.query,
  );
  const filter: Record<string, unknown> = {};
  if (q.city) filter.city = q.city;
  if (q.skill) filter.skills = q.skill;
  if (q.status) filter.status = q.status;
  if (q.q) {
    const pattern = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ name: pattern }, { phone: pattern }];
  }
  const pros = await Professional.find(filter).sort({ name: 1 }).populate('city', 'name slug').populate('skills', 'name slug icon');
  const active = await Booking.aggregate<{ _id: unknown; n: number }>([
    { $match: { professional: { $in: pros.map((p) => p._id) }, status: { $in: ACTIVE_JOB_STATUSES } } },
    { $group: { _id: '$professional', n: { $sum: 1 } } },
  ]);
  const counts = new Map(active.map((a) => [String(a._id), a.n]));
  res.json({ professionals: pros.map((p) => ({ ...p.toJSON(), activeJobs: counts.get(String(p._id)) || 0 })) });
});

router.get('/professionals/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw notFound('Professional');
  const pro = await Professional.findById(req.params.id).populate('city', 'name slug').populate('skills', 'name slug icon');
  if (!pro) throw notFound('Professional');
  const jobs = await Booking.find({ professional: pro._id }).sort({ 'slot.start': -1 }).limit(30).populate('customer', 'name phone');
  res.json({ professional: pro, jobs });
});

router.post('/professionals', async (req, res) => {
  const body = parse(proBody, req.body);
  await assertRefs(body.city, body.skills);
  const { password, ...rest } = body;
  const pro = await Professional.create({ ...rest, passwordHash: await hashPassword(password) });
  res.status(201).json({ professional: pro });
});

router.patch('/professionals/:id', async (req, res) => {
  const body = parse(proBody.partial(), req.body);
  if (!isValidObjectId(req.params.id)) throw notFound('Professional');
  await assertRefs(body.city, body.skills);
  const pro = await Professional.findById(req.params.id);
  if (!pro) throw notFound('Professional');

  const changesWork = body.status === 'inactive' || (body.city && body.city !== String(pro.city));
  if (changesWork) {
    const activeJobs = await Booking.countDocuments({ professional: pro._id, status: { $in: ACTIVE_JOB_STATUSES } });
    if (activeJobs) throw conflict(`Reassign their ${activeJobs} active job(s) first`, 'HAS_ACTIVE_JOBS');
  }
  const { password, ...rest } = body;
  pro.set(rest);
  if (password) pro.passwordHash = await hashPassword(password);
  await pro.save();
  await pro.populate([{ path: 'city', select: 'name slug' }, { path: 'skills', select: 'name slug icon' }]);
  res.json({ professional: pro });
});

router.delete('/professionals/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw notFound('Professional');
  const history = await Booking.countDocuments({ professional: req.params.id });
  if (history) throw conflict('This professional has booking history. Mark them inactive instead.', 'IN_USE');
  const pro = await Professional.findByIdAndDelete(req.params.id);
  if (!pro) throw notFound('Professional');
  res.json({ ok: true });
});

/* ---------------- Customers ---------------- */

router.get('/customers', async (req, res) => {
  const q = parse(pagination.extend({ q: z.string().trim().max(60).optional() }), req.query);
  const filter: Record<string, unknown> = {};
  if (q.q) {
    const pattern = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ name: pattern }, { phone: pattern }, { email: pattern }];
  }
  const [customers, total] = await Promise.all([
    Customer.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
    Customer.countDocuments(filter),
  ]);
  const counts = await Booking.aggregate<{ _id: unknown; n: number; spent: number }>([
    { $match: { customer: { $in: customers.map((c) => c._id) } } },
    {
      $group: {
        _id: '$customer',
        n: { $sum: 1 },
        spent: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$pricing.total', 0] } },
      },
    },
  ]);
  const map = new Map(counts.map((c) => [String(c._id), c]));
  res.json({
    items: customers.map((c) => ({
      ...c.toJSON(),
      bookings: map.get(String(c._id))?.n || 0,
      spent: map.get(String(c._id))?.spent || 0,
    })),
    total,
    page: q.page,
    pages: Math.max(1, Math.ceil(total / q.limit)),
  });
});

router.get('/customers/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw notFound('Customer');
  const customer = await Customer.findById(req.params.id);
  if (!customer) throw notFound('Customer');
  const bookings = await Booking.find({ customer: customer._id }).sort({ 'slot.start': -1 }).limit(50);
  res.json({ customer, bookings });
});

router.patch('/customers/:id', async (req, res) => {
  const body = parse(z.object({ isBlocked: z.boolean() }), req.body);
  if (!isValidObjectId(req.params.id)) throw notFound('Customer');
  const customer = await Customer.findByIdAndUpdate(req.params.id, body, { new: true });
  if (!customer) throw notFound('Customer');
  res.json({ customer });
});

export default router;
