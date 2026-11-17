import crypto from 'crypto';
import { Types } from 'mongoose';
import { config } from '../config';
import {
  ACTIVE_JOB_STATUSES,
  Actor,
  Booking,
  BookingDoc,
  BookingStatus,
  Coupon,
  CustomerDoc,
  Professional,
  ProfessionalDoc,
  Service,
} from '../models';
import { AppError, badRequest, conflict, notFound } from '../utils/errors';
import { addMinutes, slotInstant } from '../utils/time';
import { buildQuote } from './pricing';
import { checkSlot } from './slots';

/** Allowed next statuses. `assigned` is reached only through assignProfessional, `cancelled` through cancelBooking. */
export const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ['assigned', 'cancelled'],
  assigned: ['on_the_way', 'in_progress', 'cancelled'],
  on_the_way: ['in_progress', 'cancelled'],
  in_progress: ['completed'],
  completed: [],
  cancelled: [],
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateCode() {
  let out = 'GS';
  for (let i = 0; i < 6; i += 1) out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  return out;
}

export function generatePin() {
  return String(crypto.randomInt(1000, 10000));
}

function slotWindow(date: string, time: string, durationMinutes: number) {
  const start = slotInstant(date, time);
  return { start, end: addMinutes(start, durationMinutes + config.booking.bufferMinutes) };
}

function log(booking: BookingDoc, status: BookingDoc['timeline'][number]['status'], actor: Actor, note = '') {
  booking.timeline.push({ status, actor, note, at: new Date() });
}

export interface CreateBookingInput {
  city: string;
  items: { serviceId: string; qty: number }[];
  couponCode?: string | null;
  addressId: string;
  date: string;
  time: string;
  notes?: string;
}

export async function createBooking(customer: CustomerDoc, input: CreateBookingInput) {
  const address = customer.addresses.id(input.addressId);
  if (!address) throw badRequest('Choose a saved address', 'ADDRESS_REQUIRED');
  if (address.city !== input.city.toLowerCase()) {
    throw badRequest('The address is in a different city than your booking', 'ADDRESS_CITY_MISMATCH');
  }

  const quote = await buildQuote({
    items: input.items,
    couponCode: input.couponCode,
    city: input.city,
    customerId: customer._id,
    strictCoupon: true,
  });
  const city = quote.city!;

  const slot = await checkSlot({ cityId: city._id, categoryId: quote.category._id, date: input.date, time: input.time });
  if (!slot.ok) throw badRequest(slot.reason, 'SLOT_UNAVAILABLE');

  const window = slotWindow(input.date, input.time, quote.durationMinutes);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const booking = await Booking.create({
        code: generateCode(),
        customer: customer._id,
        category: quote.category._id,
        categoryName: quote.category.name,
        city: city._id,
        cityName: city.name,
        items: quote.lines.map((l) => ({
          service: l.service._id,
          name: l.name,
          price: l.price,
          mrp: l.mrp,
          qty: l.qty,
          durationMinutes: l.durationMinutes,
        })),
        address: {
          label: address.label,
          line1: address.line1,
          line2: address.line2,
          landmark: address.landmark,
          city: city.name,
          pincode: address.pincode,
        },
        slot: { date: input.date, time: input.time, ...window },
        durationMinutes: quote.durationMinutes,
        pricing: {
          subtotal: quote.subtotal,
          discount: quote.discount,
          visitFee: quote.visitFee,
          total: quote.total,
          couponCode: quote.coupon?.code ?? '',
        },
        pin: generatePin(),
        notes: input.notes?.trim() ?? '',
        timeline: [{ status: 'pending', actor: 'customer', note: 'Booking placed', at: new Date() }],
      });
      if (quote.coupon) await Coupon.updateOne({ _id: quote.coupon._id }, { $inc: { usedCount: 1 } });
      return booking;
    } catch (err) {
      const dup = (err as { code?: number; keyPattern?: Record<string, unknown> }).code === 11000;
      if (!dup || !(err as { keyPattern?: Record<string, unknown> }).keyPattern?.code) throw err;
    }
  }
  throw new AppError(500, 'Could not create booking, please retry', 'BOOKING_CODE');
}

/** All professionals for the booking's city + category, with whether they're free for its slot. */
export async function professionalOptions(booking: BookingDoc) {
  const pros = await Professional.find({ city: booking.city, skills: booking.category, status: 'active' }).sort({
    rating: -1,
    jobsCompleted: -1,
  });
  const clashes = await Booking.find({
    _id: { $ne: booking._id },
    professional: { $in: pros.map((p) => p._id) },
    status: { $in: ACTIVE_JOB_STATUSES },
    'slot.start': { $lt: booking.slot.end },
    'slot.end': { $gt: booking.slot.start },
  }).select('professional code slot');
  const busy = new Map(clashes.map((c) => [String(c.professional), c]));
  return pros.map((pro) => {
    const clash = busy.get(String(pro._id));
    return {
      professional: pro,
      available: !clash,
      reason: clash ? `Busy with ${clash.code} at ${clash.slot.time}` : '',
    };
  });
}

async function isProFree(proId: Types.ObjectId, booking: BookingDoc) {
  const clash = await Booking.exists({
    _id: { $ne: booking._id },
    professional: proId,
    status: { $in: ACTIVE_JOB_STATUSES },
    'slot.start': { $lt: booking.slot.end },
    'slot.end': { $gt: booking.slot.start },
  });
  return !clash;
}

export async function assignProfessional(booking: BookingDoc, professionalId: string, actor: Actor = 'admin') {
  if (!['pending', 'assigned'].includes(booking.status)) {
    throw conflict(`A ${booking.status.replace(/_/g, ' ')} booking cannot be reassigned`, 'INVALID_STATUS');
  }
  const pro = await Professional.findById(professionalId);
  if (!pro) throw notFound('Professional');
  if (pro.status !== 'active') throw badRequest(`${pro.name} is not active`, 'PRO_INACTIVE');
  if (!pro.city.equals(booking.city)) throw badRequest(`${pro.name} works in a different city`, 'PRO_WRONG_CITY');
  if (!pro.skills.some((s) => s.equals(booking.category))) {
    throw badRequest(`${pro.name} is not trained for ${booking.categoryName}`, 'PRO_WRONG_SKILL');
  }
  if (!(await isProFree(pro._id, booking))) throw conflict(`${pro.name} already has a job at this time`, 'PRO_BUSY');

  const reassign = booking.status === 'assigned';
  booking.professional = pro._id;
  booking.status = 'assigned';
  log(booking, 'assigned', actor, reassign ? `Reassigned to ${pro.name}` : `${pro.name} assigned`);
  await booking.save();
  return pro;
}

export async function unassignProfessional(booking: BookingDoc, actor: Actor, note = 'Professional removed') {
  if (booking.status !== 'assigned') throw conflict('Only an assigned booking can be unassigned', 'INVALID_STATUS');
  booking.professional = null;
  booking.status = 'pending';
  log(booking, 'unassigned', actor, note);
  await booking.save();
}

export async function advanceStatus(
  booking: BookingDoc,
  next: BookingStatus,
  actor: Actor,
  opts: { pin?: string; note?: string; requirePin?: boolean } = {},
) {
  if (next === 'assigned') throw badRequest('Use assign to set a professional', 'USE_ASSIGN');
  if (next === 'cancelled') throw badRequest('Use cancel to cancel a booking', 'USE_CANCEL');
  if (!TRANSITIONS[booking.status].includes(next)) {
    throw conflict(`Cannot move a booking from ${booking.status.replace(/_/g, ' ')} to ${next.replace(/_/g, ' ')}`, 'INVALID_TRANSITION');
  }
  if (!booking.professional) throw conflict('Assign a professional first', 'NO_PROFESSIONAL');

  if (next === 'in_progress' && opts.requirePin && opts.pin !== booking.pin) {
    throw badRequest('That service PIN is not right. Ask the customer for the 4-digit PIN.', 'PIN_INVALID');
  }

  booking.status = next;
  const notes: Record<string, string> = {
    on_the_way: 'Professional is on the way',
    in_progress: 'Service started',
    completed: 'Service completed',
  };
  log(booking, next, actor, opts.note?.trim() || notes[next] || '');

  if (next === 'completed') {
    booking.paymentStatus = 'paid';
    await Professional.updateOne({ _id: booking.professional }, { $inc: { jobsCompleted: 1 } });
  }
  await booking.save();
}

export function customerCanCancel(booking: BookingDoc) {
  return ['pending', 'assigned', 'on_the_way'].includes(booking.status);
}

export function customerCanReschedule(booking: BookingDoc, now = new Date()) {
  return (
    ['pending', 'assigned'].includes(booking.status) &&
    booking.slot.start.getTime() - now.getTime() > config.booking.rescheduleCutoffMinutes * 60_000
  );
}

export async function cancelBooking(booking: BookingDoc, actor: Actor, reason: string) {
  const allowed = actor === 'customer' ? customerCanCancel(booking) : !['completed', 'cancelled'].includes(booking.status);
  if (!allowed) throw conflict(`A ${booking.status.replace(/_/g, ' ')} booking cannot be cancelled`, 'INVALID_STATUS');
  booking.status = 'cancelled';
  booking.cancellation = { reason: reason.trim(), by: actor, at: new Date() };
  log(booking, 'cancelled', actor, reason.trim());
  await booking.save();
  if (booking.pricing.couponCode) {
    await Coupon.updateOne({ code: booking.pricing.couponCode, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
  }
}

export async function rescheduleBooking(booking: BookingDoc, date: string, time: string, actor: Actor) {
  if (actor === 'customer' && !customerCanReschedule(booking)) {
    throw conflict(
      `Bookings can be rescheduled up to ${config.booking.rescheduleCutoffMinutes / 60} hours before the slot`,
      'RESCHEDULE_CLOSED',
    );
  }
  if (!['pending', 'assigned'].includes(booking.status)) {
    throw conflict('This booking can no longer be rescheduled', 'INVALID_STATUS');
  }
  if (booking.slot.date === date && booking.slot.time === time) throw badRequest('Pick a different slot', 'SAME_SLOT');

  const slot = await checkSlot({ cityId: booking.city, categoryId: booking.category, date, time, excludeBookingId: booking._id });
  if (!slot.ok) throw badRequest(slot.reason, 'SLOT_UNAVAILABLE');

  const from = `${booking.slot.date} ${booking.slot.time}`;
  booking.slot = { date, time, ...slotWindow(date, time, booking.durationMinutes) };
  log(booking, 'rescheduled', actor, `Moved from ${from} to ${date} ${time}`);

  if (booking.professional && !(await isProFree(booking.professional as Types.ObjectId, booking))) {
    booking.professional = null;
    booking.status = 'pending';
    log(booking, 'unassigned', 'system', 'Professional is busy at the new time; finding another');
  }
  await booking.save();
}

export async function reviewBooking(booking: BookingDoc, rating: number, comment: string) {
  if (booking.status !== 'completed') throw conflict('You can rate a booking after it is completed', 'NOT_COMPLETED');
  if (booking.review) throw conflict('You have already rated this booking', 'ALREADY_REVIEWED');
  booking.review = { rating, comment: comment.trim(), at: new Date(), hidden: false };
  await booking.save();

  const blend = (avg: number, count: number) => Math.round(((avg * count + rating) / (count + 1)) * 100) / 100;
  if (booking.professional) {
    const pro = await Professional.findById(booking.professional);
    if (pro) {
      pro.rating = blend(pro.rating, pro.ratingCount);
      pro.ratingCount += 1;
      await pro.save();
    }
  }
  const services = await Service.find({ _id: { $in: booking.items.map((i) => i.service) } });
  for (const s of services) {
    s.rating = blend(s.rating, s.ratingCount);
    s.ratingCount += 1;
    await s.save();
  }
}

/* ---------------- Presenters ---------------- */

const SHOW_PIN: BookingStatus[] = ['assigned', 'on_the_way'];

function presentPro(pro: ProfessionalDoc | null) {
  if (!pro) return null;
  return {
    id: String(pro._id),
    name: pro.name,
    phone: pro.phone,
    rating: pro.rating,
    ratingCount: pro.ratingCount,
    experienceYears: pro.experienceYears,
    jobsCompleted: pro.jobsCompleted,
  };
}

function baseBooking(b: BookingDoc) {
  return {
    id: String(b._id),
    code: b.code,
    status: b.status,
    categoryName: b.categoryName,
    category: String(b.category),
    cityName: b.cityName,
    items: b.items.map((i) => ({
      serviceId: String(i.service),
      name: i.name,
      price: i.price,
      mrp: i.mrp,
      qty: i.qty,
      durationMinutes: i.durationMinutes,
    })),
    address: b.address,
    slot: { date: b.slot.date, time: b.slot.time, start: b.slot.start },
    durationMinutes: b.durationMinutes,
    pricing: b.pricing,
    paymentMethod: b.paymentMethod,
    paymentStatus: b.paymentStatus,
    timeline: b.timeline,
    notes: b.notes,
    createdAt: b.createdAt,
  };
}

/** Booking as the customer sees it. Expects `professional` to be populated. */
export function presentForCustomer(b: BookingDoc) {
  const pro = b.populated('professional') ? (b.professional as unknown as ProfessionalDoc) : null;
  return {
    ...baseBooking(b),
    pin: SHOW_PIN.includes(b.status) ? b.pin : null,
    professional: presentPro(pro),
    cancellation: b.cancellation ?? null,
    review: b.review ? { rating: b.review.rating, comment: b.review.comment, at: b.review.at } : null,
    canCancel: customerCanCancel(b),
    canReschedule: customerCanReschedule(b),
    canReview: b.status === 'completed' && !b.review,
  };
}

/** Booking as the assigned professional sees it. Expects `customer` to be populated. */
export function presentForPro(b: BookingDoc) {
  const customer = b.customer as unknown as { name?: string; phone?: string } | null;
  return {
    ...baseBooking(b),
    customer: customer ? { name: customer.name || 'Customer', phone: customer.phone || '' } : null,
    review: b.review && !b.review.hidden ? { rating: b.review.rating, comment: b.review.comment } : null,
  };
}
