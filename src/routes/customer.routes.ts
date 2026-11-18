import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { optionalCustomer, requireCustomer } from '../middleware/auth';
import { signInLimiter } from '../middleware/rateLimit';
import { ADDRESS_LABELS, Booking, BookingDoc, City, Customer, CustomerDoc } from '../models';
import {
  cancelBooking,
  createBooking,
  presentForCustomer,
  rescheduleBooking,
  reviewBooking,
} from '../services/bookingFlow';
import { verifyGoogleAccessToken } from '../services/google';
import { buildQuote, presentQuote } from '../services/pricing';
import { signToken } from '../services/tokens';
import { badRequest, notFound } from '../utils/errors';
import { dateString, objectId, parse, phone, timeString } from '../utils/validate';
import { isValidObjectId } from 'mongoose';

const router = Router();

export function presentCustomer(c: CustomerDoc) {
  return {
    id: String(c._id),
    phone: c.phone,
    name: c.name,
    email: c.email,
    avatarUrl: c.avatarUrl,
    addresses: c.addresses.map((a) => ({
      id: String(a._id),
      label: a.label,
      line1: a.line1,
      line2: a.line2,
      landmark: a.landmark,
      city: a.city,
      pincode: a.pincode,
      isDefault: a.isDefault,
    })),
  };
}

/* ---------------- Auth (Google) ---------------- */

router.post('/auth/google', signInLimiter, async (req, res) => {
  const body = parse(z.object({ accessToken: z.string().trim().min(10, 'Sign in with Google again').max(4096) }), req.body);
  const google = await verifyGoogleAccessToken(body.accessToken);
  let customer = await Customer.findOne({ googleId: google.sub });
  const isNew = !customer;
  if (!customer) customer = new Customer({ googleId: google.sub, name: google.name });
  if (customer.isBlocked) throw badRequest('Your account is on hold. Please contact support.', 'BLOCKED');
  customer.email = google.email;
  if (!customer.name && google.name) customer.name = google.name;
  if (google.picture) customer.avatarUrl = google.picture;
  customer.lastLoginAt = new Date();
  await customer.save();
  res.json({ token: signToken({ sub: String(customer._id), kind: 'customer' }), customer: presentCustomer(customer), isNew });
});

/* ---------------- Profile & addresses ---------------- */

router.get('/me', requireCustomer, (req, res) => {
  res.json({ customer: presentCustomer(req.customer!) });
});

router.patch('/me', requireCustomer, async (req, res) => {
  const body = parse(
    z.object({
      name: z.string().trim().min(2, 'Enter your name').max(80).optional(),
      phone: phone.optional(),
    }),
    req.body,
  );
  const customer = req.customer!;
  if (body.name !== undefined) customer.name = body.name;
  if (body.phone !== undefined) customer.phone = body.phone;
  await customer.save();
  res.json({ customer: presentCustomer(customer) });
});

const addressBody = z.object({
  label: z.enum(ADDRESS_LABELS).default('Home'),
  line1: z.string().trim().min(3, 'Enter house / flat and building').max(120),
  line2: z.string().trim().max(120).optional().default(''),
  landmark: z.string().trim().max(80).optional().default(''),
  city: z.string().trim().toLowerCase().min(1, 'Choose a city'),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Enter a 6-digit pincode'),
  isDefault: z.boolean().optional().default(false),
});

async function assertCity(slug: string) {
  const city = await City.findOne({ slug, isActive: true });
  if (!city) throw badRequest('We do not serve this city yet', 'CITY_UNAVAILABLE');
}

function setDefault(customer: CustomerDoc, id: string) {
  for (const a of customer.addresses) a.isDefault = String(a._id) === id;
}

router.post('/me/addresses', requireCustomer, async (req, res) => {
  const body = parse(addressBody, req.body);
  await assertCity(body.city);
  const customer = req.customer!;
  if (customer.addresses.length >= 10) throw badRequest('You can save up to 10 addresses', 'ADDRESS_LIMIT');
  customer.addresses.push(body);
  const added = customer.addresses[customer.addresses.length - 1];
  if (body.isDefault || customer.addresses.length === 1) setDefault(customer, String(added._id));
  await customer.save();
  res.status(201).json({ customer: presentCustomer(customer), addressId: String(added._id) });
});

router.patch('/me/addresses/:id', requireCustomer, async (req, res) => {
  const body = parse(addressBody.partial(), req.body);
  if (body.city) await assertCity(body.city);
  const customer = req.customer!;
  const address = isValidObjectId(String(req.params.id)) ? customer.addresses.id(String(req.params.id)) : null;
  if (!address) throw notFound('Address');
  const { isDefault, ...rest } = body;
  address.set(rest);
  if (isDefault) setDefault(customer, String(address._id));
  await customer.save();
  res.json({ customer: presentCustomer(customer) });
});

router.delete('/me/addresses/:id', requireCustomer, async (req, res) => {
  const customer = req.customer!;
  const address = isValidObjectId(String(req.params.id)) ? customer.addresses.id(String(req.params.id)) : null;
  if (!address) throw notFound('Address');
  const wasDefault = address.isDefault;
  address.deleteOne();
  if (wasDefault && customer.addresses.length) customer.addresses[0].isDefault = true;
  await customer.save();
  res.json({ customer: presentCustomer(customer) });
});

/* ---------------- Bookings ---------------- */

const itemsSchema = z
  .array(z.object({ serviceId: objectId, qty: z.coerce.number().int().min(1).max(config.booking.maxQty) }))
  .min(1, 'Your cart is empty')
  .max(config.booking.maxItems);

router.post('/bookings/quote', optionalCustomer, async (req, res) => {
  const body = parse(
    z.object({
      items: itemsSchema,
      couponCode: z.string().trim().max(30).optional().nullable(),
      city: z.string().trim().toLowerCase().optional().nullable(),
    }),
    req.body,
  );
  const quote = await buildQuote({ ...body, customerId: req.customer?._id });
  res.json({ quote: presentQuote(quote) });
});

router.post('/bookings', requireCustomer, async (req, res) => {
  const body = parse(
    z.object({
      city: z.string().trim().toLowerCase().min(1, 'Choose a city'),
      items: itemsSchema,
      couponCode: z.string().trim().max(30).optional().nullable(),
      addressId: objectId,
      date: dateString,
      time: timeString,
      notes: z.string().trim().max(500).optional(),
    }),
    req.body,
  );
  const customer = req.customer!;
  if (!customer.name) throw badRequest('Add your name before booking', 'NAME_REQUIRED');
  const booking = await createBooking(customer, body);
  res.status(201).json({ booking: presentForCustomer(booking) });
});

router.get('/bookings', requireCustomer, async (req, res) => {
  const bookings = await Booking.find({ customer: req.customer!._id }).sort({ 'slot.start': -1 }).limit(100).populate('professional');
  res.json({ bookings: bookings.map(presentForCustomer) });
});

async function ownBooking(customerId: unknown, idOrCode: string): Promise<BookingDoc> {
  const filter = isValidObjectId(idOrCode) ? { _id: idOrCode } : { code: idOrCode.toUpperCase() };
  const booking = await Booking.findOne({ ...filter, customer: customerId }).populate('professional');
  if (!booking) throw notFound('Booking');
  return booking;
}

router.get('/bookings/:id', requireCustomer, async (req, res) => {
  const booking = await ownBooking(req.customer!._id, String(req.params.id));
  res.json({ booking: presentForCustomer(booking) });
});

router.post('/bookings/:id/cancel', requireCustomer, async (req, res) => {
  const body = parse(z.object({ reason: z.string().trim().min(3, 'Tell us why you are cancelling').max(300) }), req.body);
  const booking = await ownBooking(req.customer!._id, String(req.params.id));
  await cancelBooking(booking, 'customer', body.reason);
  res.json({ booking: presentForCustomer(booking) });
});

router.post('/bookings/:id/reschedule', requireCustomer, async (req, res) => {
  const body = parse(z.object({ date: dateString, time: timeString }), req.body);
  const booking = await ownBooking(req.customer!._id, String(req.params.id));
  await rescheduleBooking(booking, body.date, body.time, 'customer');
  await booking.populate('professional');
  res.json({ booking: presentForCustomer(booking) });
});

router.post('/bookings/:id/review', requireCustomer, async (req, res) => {
  const body = parse(
    z.object({ rating: z.coerce.number().int().min(1, 'Pick a rating').max(5), comment: z.string().trim().max(1000).optional().default('') }),
    req.body,
  );
  const booking = await ownBooking(req.customer!._id, String(req.params.id));
  await reviewBooking(booking, body.rating, body.comment);
  res.json({ booking: presentForCustomer(booking) });
});

export default router;
