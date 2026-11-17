import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { Booking, BOOKING_STATUSES, BookingDoc } from '../../models';
import {
  advanceStatus,
  assignProfessional,
  cancelBooking,
  professionalOptions,
  rescheduleBooking,
  unassignProfessional,
} from '../../services/bookingFlow';
import { notFound } from '../../utils/errors';
import { dateString, escapeRegex, objectId, pagination, parse, timeString } from '../../utils/validate';
import { Customer } from '../../models';

const router = Router();

async function loadBooking(id: string): Promise<BookingDoc> {
  if (!isValidObjectId(id)) throw notFound('Booking');
  const booking = await Booking.findById(id);
  if (!booking) throw notFound('Booking');
  return booking;
}

async function detail(booking: BookingDoc) {
  await booking.populate([
    { path: 'customer', select: 'name phone email' },
    { path: 'professional', select: 'name phone rating ratingCount jobsCompleted experienceYears' },
  ]);
  return booking.toJSON();
}

router.get('/bookings', async (req, res) => {
  const q = parse(
    pagination.extend({
      status: z.enum(BOOKING_STATUSES).optional(),
      city: objectId.optional(),
      category: objectId.optional(),
      professional: objectId.optional(),
      date: dateString.optional(),
      q: z.string().trim().max(40).optional(),
    }),
    req.query,
  );
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.city) filter.city = q.city;
  if (q.category) filter.category = q.category;
  if (q.professional) filter.professional = q.professional;
  if (q.date) filter['slot.date'] = q.date;
  if (q.q) {
    const pattern = new RegExp(escapeRegex(q.q), 'i');
    const customers = await Customer.find({ $or: [{ phone: pattern }, { name: pattern }] }).select('_id').limit(200);
    filter.$or = [{ code: pattern }, { customer: { $in: customers.map((c) => c._id) } }];
  }
  const [items, total] = await Promise.all([
    Booking.find(filter)
      .sort({ 'slot.start': -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate('customer', 'name phone')
      .populate('professional', 'name phone'),
    Booking.countDocuments(filter),
  ]);
  res.json({ items, total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)) });
});

router.get('/bookings/:id', async (req, res) => {
  res.json({ booking: await detail(await loadBooking(req.params.id)) });
});

router.get('/bookings/:id/professionals', async (req, res) => {
  const booking = await loadBooking(req.params.id);
  const options = await professionalOptions(booking);
  res.json({
    professionals: options.map((o) => ({
      id: String(o.professional._id),
      name: o.professional.name,
      phone: o.professional.phone,
      rating: o.professional.rating,
      ratingCount: o.professional.ratingCount,
      jobsCompleted: o.professional.jobsCompleted,
      experienceYears: o.professional.experienceYears,
      available: o.available,
      reason: o.reason,
      current: booking.professional ? o.professional._id.equals(booking.professional as never) : false,
    })),
  });
});

router.post('/bookings/:id/assign', async (req, res) => {
  const body = parse(z.object({ professionalId: objectId }), req.body);
  const booking = await loadBooking(req.params.id);
  await assignProfessional(booking, body.professionalId, 'admin');
  res.json({ booking: await detail(booking) });
});

router.post('/bookings/:id/unassign', async (req, res) => {
  const booking = await loadBooking(req.params.id);
  await unassignProfessional(booking, 'admin');
  res.json({ booking: await detail(booking) });
});

router.post('/bookings/:id/status', async (req, res) => {
  const body = parse(
    z.object({ status: z.enum(['on_the_way', 'in_progress', 'completed']), note: z.string().trim().max(300).optional() }),
    req.body,
  );
  const booking = await loadBooking(req.params.id);
  await advanceStatus(booking, body.status, 'admin', { note: body.note ? `${body.note} (by operations)` : undefined });
  res.json({ booking: await detail(booking) });
});

router.post('/bookings/:id/cancel', async (req, res) => {
  const body = parse(z.object({ reason: z.string().trim().min(3, 'Add a reason').max(300) }), req.body);
  const booking = await loadBooking(req.params.id);
  await cancelBooking(booking, 'admin', body.reason);
  res.json({ booking: await detail(booking) });
});

router.post('/bookings/:id/reschedule', async (req, res) => {
  const body = parse(z.object({ date: dateString, time: timeString }), req.body);
  const booking = await loadBooking(req.params.id);
  await rescheduleBooking(booking, body.date, body.time, 'admin');
  res.json({ booking: await detail(booking) });
});

export default router;
