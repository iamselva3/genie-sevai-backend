import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import {
  APPLICATION_STATUSES,
  Booking,
  Coupon,
  Customer,
  Enquiry,
  Professional,
  ProApplication,
  Service,
} from '../../models';
import { notFound } from '../../utils/errors';
import { addDays, localDate } from '../../utils/time';
import { pagination, parse } from '../../utils/validate';

const router = Router();

/* ---------------- Dashboard ---------------- */

router.get('/dashboard', async (_req, res) => {
  const today = localDate();
  const week = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));

  const [byStatus, todayCount, revenueAgg, weekAgg, pros, customers, openEnquiries, newApplications, topServices, recent, unassigned, liveServices] =
    await Promise.all([
      Booking.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      Booking.countDocuments({ 'slot.date': today, status: { $ne: 'cancelled' } }),
      Booking.aggregate<{ total: number }>([{ $match: { status: 'completed' } }, { $group: { _id: null, total: { $sum: '$pricing.total' } } }]),
      Booking.aggregate<{ _id: string; bookings: number; revenue: number }>([
        { $match: { 'slot.date': { $in: week }, status: { $ne: 'cancelled' } } },
        {
          $group: {
            _id: '$slot.date',
            bookings: { $sum: 1 },
            revenue: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$pricing.total', 0] } },
          },
        },
      ]),
      Professional.countDocuments({ status: 'active' }),
      Customer.countDocuments(),
      Enquiry.countDocuments({ status: 'open' }),
      ProApplication.countDocuments({ status: 'new' }),
      Booking.aggregate<{ _id: string; qty: number; revenue: number }>([
        { $match: { status: { $ne: 'cancelled' } } },
        { $unwind: '$items' },
        { $group: { _id: '$items.name', qty: { $sum: '$items.qty' }, revenue: { $sum: { $multiply: ['$items.price', '$items.qty'] } } } },
        { $sort: { qty: -1 } },
        { $limit: 5 },
      ]),
      Booking.find().sort({ createdAt: -1 }).limit(8).populate('customer', 'name phone').populate('professional', 'name'),
      Booking.find({ status: 'pending' }).sort({ 'slot.start': 1 }).limit(6).populate('customer', 'name phone'),
      Service.aggregate<{ _id: string; n: number }>([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);

  const statusCounts = Object.fromEntries(byStatus.map((s) => [s._id, s.n]));
  const weekMap = new Map(weekAgg.map((w) => [w._id, w]));
  res.json({
    today,
    statusCounts,
    todayBookings: todayCount,
    pendingAssignment: statusCounts.pending || 0,
    revenue: revenueAgg[0]?.total || 0,
    activeProfessionals: pros,
    customers,
    openEnquiries,
    newApplications,
    services: Object.fromEntries(liveServices.map((s) => [s._id, s.n])),
    week: week.map((d) => ({ date: d, bookings: weekMap.get(d)?.bookings || 0, revenue: weekMap.get(d)?.revenue || 0 })),
    topServices: topServices.map((t) => ({ name: t._id, qty: t.qty, revenue: t.revenue })),
    recent,
    unassigned,
  });
});

/* ---------------- Coupons ---------------- */

const couponBody = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,20}$/, 'Use 3-20 letters or numbers'),
  description: z.string().trim().max(160).optional(),
  type: z.enum(['percent', 'flat']),
  value: z.coerce.number().int().min(1).max(100000),
  maxDiscount: z.coerce.number().int().min(0).optional(),
  minOrder: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  validFrom: z.coerce.date().nullable().optional(),
  validTo: z.coerce.date().nullable().optional(),
  usageLimit: z.coerce.number().int().min(0).optional(),
  perCustomerLimit: z.coerce.number().int().min(0).optional(),
});

const percentCheck = (b: { type?: string; value?: number }) => !(b.type === 'percent' && (b.value ?? 0) > 100);

router.get('/coupons', async (_req, res) => {
  res.json({ coupons: await Coupon.find().sort({ createdAt: -1 }) });
});

router.post('/coupons', async (req, res) => {
  const body = parse(couponBody.refine(percentCheck, { message: 'A percent coupon cannot exceed 100%', path: ['value'] }), req.body);
  res.status(201).json({ coupon: await Coupon.create(body) });
});

router.patch('/coupons/:id', async (req, res) => {
  const body = parse(couponBody.partial().refine(percentCheck, { message: 'A percent coupon cannot exceed 100%', path: ['value'] }), req.body);
  if (!isValidObjectId(req.params.id)) throw notFound('Coupon');
  const coupon = await Coupon.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
  if (!coupon) throw notFound('Coupon');
  res.json({ coupon });
});

router.delete('/coupons/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw notFound('Coupon');
  const coupon = await Coupon.findByIdAndDelete(req.params.id);
  if (!coupon) throw notFound('Coupon');
  res.json({ ok: true });
});

/* ---------------- Reviews ---------------- */

router.get('/reviews', async (req, res) => {
  const q = parse(pagination, req.query);
  const filter = { review: { $ne: null } };
  const [items, total] = await Promise.all([
    Booking.find(filter)
      .sort({ 'review.at': -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate('customer', 'name phone')
      .populate('professional', 'name'),
    Booking.countDocuments(filter),
  ]);
  res.json({
    items: items.map((b) => ({
      bookingId: String(b._id),
      code: b.code,
      categoryName: b.categoryName,
      items: b.items.map((i) => i.name),
      customer: b.customer,
      professional: b.professional,
      review: b.review,
    })),
    total,
    page: q.page,
    pages: Math.max(1, Math.ceil(total / q.limit)),
  });
});

router.patch('/reviews/:bookingId', async (req, res) => {
  const body = parse(z.object({ hidden: z.boolean() }), req.body);
  if (!isValidObjectId(req.params.bookingId)) throw notFound('Review');
  const booking = await Booking.findOne({ _id: req.params.bookingId, review: { $ne: null } });
  if (!booking || !booking.review) throw notFound('Review');
  booking.review.hidden = body.hidden;
  booking.markModified('review');
  await booking.save();
  res.json({ review: booking.review });
});

/* ---------------- Enquiries & applications ---------------- */

router.get('/enquiries', async (req, res) => {
  const q = parse(z.object({ status: z.enum(['open', 'resolved']).optional() }), req.query);
  res.json({ enquiries: await Enquiry.find(q.status ? { status: q.status } : {}).sort({ createdAt: -1 }).limit(200) });
});

router.patch('/enquiries/:id', async (req, res) => {
  const body = parse(z.object({ status: z.enum(['open', 'resolved']) }), req.body);
  if (!isValidObjectId(req.params.id)) throw notFound('Enquiry');
  const enquiry = await Enquiry.findByIdAndUpdate(req.params.id, body, { new: true });
  if (!enquiry) throw notFound('Enquiry');
  res.json({ enquiry });
});

router.get('/applications', async (req, res) => {
  const q = parse(z.object({ status: z.enum(APPLICATION_STATUSES).optional() }), req.query);
  res.json({ applications: await ProApplication.find(q.status ? { status: q.status } : {}).sort({ createdAt: -1 }).limit(200) });
});

router.patch('/applications/:id', async (req, res) => {
  const body = parse(z.object({ status: z.enum(APPLICATION_STATUSES) }), req.body);
  if (!isValidObjectId(req.params.id)) throw notFound('Application');
  const application = await ProApplication.findByIdAndUpdate(req.params.id, body, { new: true });
  if (!application) throw notFound('Application');
  res.json({ application });
});

export default router;
