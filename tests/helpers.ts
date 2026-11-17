import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { config } from '../src/config';
import { Service } from '../src/models';
import { runSeed } from '../src/seed/seed';
import { addDays, localDate } from '../src/utils/time';

export const app = createApp();
export const api = () => request(app);

/** Spins up an in-memory MongoDB for the test file, seeded with the demo catalogue. */
export function useDatabase() {
  let mongod: MongoMemoryServer;
  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri('sevai-test'));
    await runSeed({ demoBookings: false });
  });
  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let phoneCounter = 0;
/** Unique valid mobile numbers per test run. */
export function nextPhone() {
  phoneCounter += 1;
  return `8${String(100000000 + phoneCounter).slice(-9)}`;
}

export async function loginCustomer(phone = nextPhone(), name: string | null = 'Test Customer') {
  const sent = await api().post('/api/v1/auth/otp/send').send({ phone }).expect(200);
  const verified = await api().post('/api/v1/auth/otp/verify').send({ phone, code: sent.body.devCode }).expect(200);
  const token = verified.body.token as string;
  if (name) await api().patch('/api/v1/me').set(auth(token)).send({ name }).expect(200);
  return { token, phone, customer: verified.body.customer };
}

export async function addAddress(token: string, city = 'chennai') {
  const res = await api()
    .post('/api/v1/me/addresses')
    .set(auth(token))
    .send({ label: 'Home', line1: '42, Test Street', city, pincode: '600001' })
    .expect(201);
  return res.body.addressId as string;
}

export async function adminToken(email = config.admin.email, password = config.admin.password) {
  const res = await api().post('/api/v1/admin/auth/login').send({ email, password }).expect(200);
  return res.body.token as string;
}

export async function serviceId(slug: string) {
  const s = await Service.findOne({ slug });
  if (!s) throw new Error(`No service ${slug}`);
  return String(s._id);
}

/** A slot `days` from today at `time` (always far enough ahead to pass the lead-time rule). */
export function slot(days = 2, time = '11:00') {
  return { date: addDays(localDate(), days), time };
}

export async function book(
  token: string,
  opts: { slug?: string; qty?: number; city?: string; days?: number; time?: string; couponCode?: string; addressId?: string } = {},
) {
  const addressId = opts.addressId ?? (await addAddress(token, opts.city ?? 'chennai'));
  return api()
    .post('/api/v1/bookings')
    .set(auth(token))
    .send({
      city: opts.city ?? 'chennai',
      items: [{ serviceId: await serviceId(opts.slug ?? 'bathroom-deep-cleaning'), qty: opts.qty ?? 1 }],
      addressId,
      couponCode: opts.couponCode,
      ...slot(opts.days, opts.time),
    });
}
