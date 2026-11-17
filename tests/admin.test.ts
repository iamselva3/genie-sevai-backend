import { Category, City, Professional } from '../src/models';
import { SEED_MANAGER, SEED_PRO_PASSWORD } from '../src/seed/seed';
import { adminToken, api, auth, book, loginCustomer, slot, useDatabase } from './helpers';

useDatabase();

let admin: string;
beforeAll(async () => {
  admin = await adminToken();
});

async function cleaningPros() {
  const chennai = await City.findOne({ slug: 'chennai' });
  const cleaning = await Category.findOne({ slug: 'cleaning' });
  return Professional.find({ city: chennai!._id, skills: cleaning!._id }).sort({ phone: 1 });
}

async function proToken(phone: string) {
  const res = await api().post('/api/v1/pro/auth/login').send({ phone, password: SEED_PRO_PASSWORD }).expect(200);
  return res.body.token as string;
}

describe('admin access', () => {
  it('rejects bad credentials and non-staff tokens', async () => {
    await api().post('/api/v1/admin/auth/login').send({ email: 'admin@sevai.in', password: 'wrong' }).expect(401);
    await api().get('/api/v1/admin/dashboard').expect(401);
    const { token } = await loginCustomer();
    await api().get('/api/v1/admin/dashboard').set(auth(token)).expect(401);
  });

  it('lets only admins manage staff accounts', async () => {
    const manager = await adminToken(SEED_MANAGER.email, SEED_MANAGER.password);
    await api().get('/api/v1/admin/dashboard').set(auth(manager)).expect(200);
    await api().get('/api/v1/admin/staff').set(auth(manager)).expect(403);
    const list = await api().get('/api/v1/admin/staff').set(auth(admin)).expect(200);
    expect(list.body.users).toHaveLength(2);
    const me = await api().get('/api/v1/admin/auth/me').set(auth(admin)).expect(200);
    await api().patch(`/api/v1/admin/staff/${me.body.user.id}`).set(auth(admin)).send({ isActive: false }).expect(400);
  });

  it('returns dashboard figures', async () => {
    const res = await api().get('/api/v1/admin/dashboard').set(auth(admin)).expect(200);
    expect(res.body.week).toHaveLength(7);
    expect(res.body.activeProfessionals).toBeGreaterThan(90);
    expect(res.body.services.active).toBeGreaterThan(40);
  });
});

describe('assigning professionals and running a job', () => {
  it('runs the full lifecycle: assign → on the way → PIN start → complete → review', async () => {
    const customer = await loginCustomer();
    const created = await book(customer.token, { days: 2, time: '10:00' });
    expect(created.status).toBe(201);
    const id = created.body.booking.id;

    // Eligible professionals: the two Chennai cleaners, both free
    const options = await api().get(`/api/v1/admin/bookings/${id}/professionals`).set(auth(admin)).expect(200);
    expect(options.body.professionals).toHaveLength(2);
    expect(options.body.professionals.every((p: { available: boolean }) => p.available)).toBe(true);

    // A professional from another skill is refused
    const electrician = await Professional.findOne({ bio: 'Electrician specialist' });
    await api().post(`/api/v1/admin/bookings/${id}/assign`).set(auth(admin)).send({ professionalId: String(electrician!._id) }).expect(400);

    const [proA] = await cleaningPros();
    const assigned = await api().post(`/api/v1/admin/bookings/${id}/assign`).set(auth(admin)).send({ professionalId: String(proA._id) }).expect(200);
    expect(assigned.body.booking.status).toBe('assigned');
    expect(assigned.body.booking.pin).toBeUndefined();

    // Customer now sees the professional and their PIN
    const view = await api().get(`/api/v1/bookings/${id}`).set(auth(customer.token)).expect(200);
    expect(view.body.booking.professional.name).toBe(proA.name);
    expect(view.body.booking.pin).toMatch(/^\d{4}$/);
    const pin = view.body.booking.pin as string;

    // Professional portal
    const pro = await proToken(proA.phone);
    const jobs = await api().get('/api/v1/pro/jobs').set(auth(pro)).expect(200);
    const job = jobs.body.jobs.find((j: { id: string }) => j.id === id);
    expect(job.customer.name).toBe('Test Customer');
    expect(job.pin).toBeUndefined();

    await api().post(`/api/v1/pro/jobs/${id}/status`).set(auth(pro)).send({ status: 'completed' }).expect(409);
    await api().post(`/api/v1/pro/jobs/${id}/status`).set(auth(pro)).send({ status: 'on_the_way' }).expect(200);
    const wrongPin = pin === '0000' ? '1111' : '0000';
    const bad = await api().post(`/api/v1/pro/jobs/${id}/status`).set(auth(pro)).send({ status: 'in_progress', pin: wrongPin }).expect(400);
    expect(bad.body.error.code).toBe('PIN_INVALID');
    await api().post(`/api/v1/pro/jobs/${id}/status`).set(auth(pro)).send({ status: 'in_progress', pin }).expect(200);

    // Customer can no longer cancel a started job
    await api().post(`/api/v1/bookings/${id}/cancel`).set(auth(customer.token)).send({ reason: 'changed mind' }).expect(409);

    const done = await api().post(`/api/v1/pro/jobs/${id}/status`).set(auth(pro)).send({ status: 'completed' }).expect(200);
    expect(done.body.job).toMatchObject({ status: 'completed', paymentStatus: 'paid' });

    const before = await Professional.findById(proA._id);
    const reviewed = await api().post(`/api/v1/bookings/${id}/review`).set(auth(customer.token)).send({ rating: 5, comment: 'Superb' }).expect(200);
    expect(reviewed.body.booking.review.rating).toBe(5);
    expect(reviewed.body.booking.canReview).toBe(false);
    await api().post(`/api/v1/bookings/${id}/review`).set(auth(customer.token)).send({ rating: 4 }).expect(409);
    const after = await Professional.findById(proA._id);
    expect(after!.ratingCount).toBe(before!.ratingCount + 1);
    expect(after!.jobsCompleted).toBe(before!.jobsCompleted);

    const history = await api().get('/api/v1/pro/jobs?scope=history').set(auth(pro)).expect(200);
    expect(history.body.jobs.map((j: { id: string }) => j.id)).toContain(id);

    const reviews = await api().get('/api/v1/admin/reviews').set(auth(admin)).expect(200);
    expect(reviews.body.items.some((r: { bookingId: string }) => r.bookingId === id)).toBe(true);
    await api().patch(`/api/v1/admin/reviews/${id}`).set(auth(admin)).send({ hidden: true }).expect(200);
  });

  it('prevents double-booking a professional and lets admins reassign', async () => {
    const [proA, proB] = await cleaningPros();
    const c1 = await loginCustomer();
    const c2 = await loginCustomer();
    const b1 = (await book(c1.token, { days: 5, time: '16:00' })).body.booking.id;
    const b2 = (await book(c2.token, { days: 5, time: '16:00' })).body.booking.id;

    await api().post(`/api/v1/admin/bookings/${b1}/assign`).set(auth(admin)).send({ professionalId: String(proA._id) }).expect(200);
    const busy = await api().post(`/api/v1/admin/bookings/${b2}/assign`).set(auth(admin)).send({ professionalId: String(proA._id) }).expect(409);
    expect(busy.body.error.code).toBe('PRO_BUSY');

    const options = await api().get(`/api/v1/admin/bookings/${b2}/professionals`).set(auth(admin)).expect(200);
    const a = options.body.professionals.find((p: { id: string }) => p.id === String(proA._id));
    expect(a.available).toBe(false);
    expect(a.reason).toMatch(/Busy with GS/);

    await api().post(`/api/v1/admin/bookings/${b2}/assign`).set(auth(admin)).send({ professionalId: String(proB._id) }).expect(200);

    // Another pro cannot touch this job
    const proAToken = await proToken(proA.phone);
    await api().post(`/api/v1/pro/jobs/${b2}/status`).set(auth(proAToken)).send({ status: 'on_the_way' }).expect(404);

    // A professional with active jobs cannot be deactivated
    const res = await api().patch(`/api/v1/admin/professionals/${proB._id}`).set(auth(admin)).send({ status: 'inactive' }).expect(409);
    expect(res.body.error.code).toBe('HAS_ACTIVE_JOBS');

    // Unassign and cancel from admin
    await api().post(`/api/v1/admin/bookings/${b2}/unassign`).set(auth(admin)).expect(200);
    const cancelled = await api().post(`/api/v1/admin/bookings/${b2}/cancel`).set(auth(admin)).send({ reason: 'Customer asked by phone' }).expect(200);
    expect(cancelled.body.booking.status).toBe('cancelled');
  });

  it('moves an assigned booking back to pending when the pro is busy at the new time', async () => {
    const [proA] = await cleaningPros();
    const c1 = await loginCustomer();
    const c2 = await loginCustomer();
    const morning = (await book(c1.token, { days: 6, time: '09:00' })).body.booking.id;
    const afternoon = (await book(c2.token, { days: 6, time: '15:00' })).body.booking.id;
    await api().post(`/api/v1/admin/bookings/${morning}/assign`).set(auth(admin)).send({ professionalId: String(proA._id) }).expect(200);
    await api().post(`/api/v1/admin/bookings/${afternoon}/assign`).set(auth(admin)).send({ professionalId: String(proA._id) }).expect(200);

    // Moving to a time where the same pro is free keeps the assignment
    let res = await api().post(`/api/v1/bookings/${morning}/reschedule`).set(auth(c1.token)).send(slot(6, '11:00')).expect(200);
    expect(res.body.booking.status).toBe('assigned');
    expect(res.body.booking.professional.name).toBe(proA.name);

    // Moving onto the pro's other job frees the booking for reassignment
    res = await api().post(`/api/v1/bookings/${morning}/reschedule`).set(auth(c1.token)).send(slot(6, '15:00')).expect(200);
    expect(res.body.booking.status).toBe('pending');
    expect(res.body.booking.professional).toBeNull();
    expect(res.body.booking.timeline.map((t: { status: string }) => t.status)).toEqual(
      expect.arrayContaining(['rescheduled', 'unassigned']),
    );
  });

  it('creates, filters and updates professionals', async () => {
    const chennai = await City.findOne({ slug: 'chennai' });
    const cleaning = await Category.findOne({ slug: 'cleaning' });
    const created = await api()
      .post('/api/v1/admin/professionals')
      .set(auth(admin))
      .send({ name: 'New Pro', phone: '7012345678', password: 'secret1', city: String(chennai!._id), skills: [String(cleaning!._id)], experienceYears: 3 })
      .expect(201);
    expect(created.body.professional.passwordHash).toBeUndefined();
    await api()
      .post('/api/v1/admin/professionals')
      .set(auth(admin))
      .send({ name: 'Dup', phone: '7012345678', password: 'secret1', city: String(chennai!._id), skills: [String(cleaning!._id)] })
      .expect(409);

    const list = await api().get(`/api/v1/admin/professionals?city=${chennai!._id}&skill=${cleaning!._id}`).set(auth(admin)).expect(200);
    expect(list.body.professionals).toHaveLength(3);

    // New pro increases slot capacity
    const slots = await api().get('/api/v1/slots?city=chennai&category=cleaning').expect(200);
    expect(slots.body.capacity).toBe(3);

    await api().post('/api/v1/pro/auth/login').send({ phone: '7012345678', password: 'secret1' }).expect(200);
    await api().patch(`/api/v1/admin/professionals/${created.body.professional.id}`).set(auth(admin)).send({ status: 'inactive' }).expect(200);
    await api().post('/api/v1/pro/auth/login').send({ phone: '7012345678', password: 'secret1' }).expect(401);
    await api().delete(`/api/v1/admin/professionals/${created.body.professional.id}`).set(auth(admin)).expect(200);
  });

  it('lists bookings with filters and search', async () => {
    const res = await api().get('/api/v1/admin/bookings?status=completed').set(auth(admin)).expect(200);
    expect(res.body.items.every((b: { status: string }) => b.status === 'completed')).toBe(true);
    const all = await api().get('/api/v1/admin/bookings?limit=2').set(auth(admin)).expect(200);
    expect(all.body.items).toHaveLength(2);
    expect(all.body.total).toBe(5);
    expect(all.body.pages).toBe(3);
    const code = all.body.items[0].code as string;
    const search = await api().get(`/api/v1/admin/bookings?q=${code}`).set(auth(admin)).expect(200);
    expect(search.body.items[0].code).toBe(code);
    await api().get('/api/v1/admin/bookings?status=bogus').set(auth(admin)).expect(400);
  });
});

describe('support desk', () => {
  it('takes enquiries and professional applications', async () => {
    await api().post('/api/v1/enquiries').send({ name: 'A', phone: '9999999999', message: 'short' }).expect(400);
    await api()
      .post('/api/v1/enquiries')
      .send({ name: 'Anu', phone: '9999999999', message: 'My AC is still not cooling after the service.' })
      .expect(201);
    const app1 = await api()
      .post('/api/v1/pro-applications')
      .send({ name: 'Kumar', phone: '9888888888', city: 'Chennai', skills: ['Plumbing'], experienceYears: 4 })
      .expect(201);
    expect(app1.body.duplicate).toBe(false);
    const dup = await api()
      .post('/api/v1/pro-applications')
      .send({ name: 'Kumar', phone: '9888888888', city: 'Chennai', skills: ['Plumbing'], experienceYears: 4 })
      .expect(200);
    expect(dup.body.duplicate).toBe(true);

    const enquiries = await api().get('/api/v1/admin/enquiries?status=open').set(auth(admin)).expect(200);
    expect(enquiries.body.enquiries).toHaveLength(1);
    await api().patch(`/api/v1/admin/enquiries/${enquiries.body.enquiries[0].id}`).set(auth(admin)).send({ status: 'resolved' }).expect(200);
    const apps = await api().get('/api/v1/admin/applications').set(auth(admin)).expect(200);
    await api().patch(`/api/v1/admin/applications/${apps.body.applications[0].id}`).set(auth(admin)).send({ status: 'approved' }).expect(200);
  });

  it('manages coupons', async () => {
    await api().post('/api/v1/admin/coupons').set(auth(admin)).send({ code: 'HALF', type: 'percent', value: 150 }).expect(400);
    const c = await api().post('/api/v1/admin/coupons').set(auth(admin)).send({ code: 'monsoon50', type: 'flat', value: 50 }).expect(201);
    expect(c.body.coupon.code).toBe('MONSOON50');
    await api().patch(`/api/v1/admin/coupons/${c.body.coupon.id}`).set(auth(admin)).send({ isActive: false }).expect(200);
    const pub = await api().get('/api/v1/coupons').expect(200);
    expect(pub.body.coupons.map((x: { code: string }) => x.code)).not.toContain('MONSOON50');
    await api().delete(`/api/v1/admin/coupons/${c.body.coupon.id}`).set(auth(admin)).expect(200);
  });

  it('blocks a customer from signing in to bookings', async () => {
    const { token, customer } = await loginCustomer();
    await api().patch(`/api/v1/admin/customers/${customer.id}`).set(auth(admin)).send({ isBlocked: true }).expect(200);
    await api().get('/api/v1/me').set(auth(token)).expect(403);
    const list = await api().get('/api/v1/admin/customers').set(auth(admin)).expect(200);
    expect(list.body.total).toBeGreaterThan(0);
  });
});
