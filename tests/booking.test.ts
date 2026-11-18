import { Coupon } from '../src/models';
import { addAddress, api, auth, book, loginCustomer, serviceId, slot, useDatabase } from './helpers';

useDatabase();

const quote = (body: Record<string, unknown>, token?: string) => {
  const req = api().post('/api/v1/bookings/quote');
  if (token) req.set(auth(token));
  return req.send(body);
};

describe('quotes', () => {
  it('adds a visit fee to small orders and waives it on bigger ones', async () => {
    const tap = await serviceId('tap-repair-replacement');
    const small = await quote({ items: [{ serviceId: tap, qty: 1 }] }).expect(200);
    expect(small.body.quote).toMatchObject({ subtotal: 129, visitFee: 79, total: 208 });
    const big = await quote({ items: [{ serviceId: tap, qty: 4 }] }).expect(200);
    expect(big.body.quote).toMatchObject({ subtotal: 516, visitFee: 0, total: 516 });
  });

  it('merges duplicate lines and totals the duration', async () => {
    const tap = await serviceId('tap-repair-replacement');
    const res = await quote({ items: [{ serviceId: tap, qty: 1 }, { serviceId: tap, qty: 2 }] }).expect(200);
    expect(res.body.quote.lines).toHaveLength(1);
    expect(res.body.quote.lines[0].qty).toBe(3);
    expect(res.body.quote.durationMinutes).toBe(90);
  });

  it('applies coupons and reports unusable ones without failing', async () => {
    const bath = await serviceId('bathroom-deep-cleaning');
    const ok = await quote({ items: [{ serviceId: bath, qty: 1 }], couponCode: 'welcome100' }).expect(200);
    expect(ok.body.quote).toMatchObject({ discount: 100, total: 399, coupon: { code: 'WELCOME100' } });

    const tooSmall = await quote({ items: [{ serviceId: bath, qty: 1 }], couponCode: 'GENIE20' }).expect(200);
    expect(tooSmall.body.quote.discount).toBe(0);
    expect(tooSmall.body.quote.couponError).toMatch(/Add ₹500 more/);

    const bogus = await quote({ items: [{ serviceId: bath, qty: 1 }], couponCode: 'NOPE' }).expect(200);
    expect(bogus.body.quote.couponError).toBe('This coupon is not valid');
  });

  it('rejects carts that cannot be booked', async () => {
    const bath = await serviceId('bathroom-deep-cleaning');
    const tap = await serviceId('tap-repair-replacement');
    const sofa = await serviceId('sofa-shampooing-5-seats');
    const proofing = await serviceId('bathroom-waterproofing');
    const geyser = await serviceId('geyser-check-up');

    let res = await quote({ items: [{ serviceId: bath, qty: 1 }, { serviceId: tap, qty: 1 }] }).expect(400);
    expect(res.body.error.code).toBe('MIXED_CATEGORIES');
    res = await quote({ items: [{ serviceId: sofa, qty: 1 }] }).expect(400);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    res = await quote({ items: [{ serviceId: proofing, qty: 1 }], city: 'madurai' }).expect(400);
    expect(res.body.error.message).toMatch(/Not available in Madurai/);
    res = await quote({ items: [{ serviceId: geyser, qty: 1 }] }).expect(400);
    expect(res.body.error.code).toBe('SERVICE_NOT_FOUND');
    await quote({ items: [] }).expect(400);
    await quote({ items: [{ serviceId: bath, qty: 11 }] }).expect(400);
  });
});

describe('placing bookings', () => {
  it('requires sign-in, a name, a phone number and a saved address', async () => {
    const bath = await serviceId('bathroom-deep-cleaning');
    await api().post('/api/v1/bookings').send({}).expect(401);

    const nameless = await loginCustomer(undefined, null);
    const addressId = await addAddress(nameless.token);
    const res = await api()
      .post('/api/v1/bookings')
      .set(auth(nameless.token))
      .send({ city: 'chennai', items: [{ serviceId: bath, qty: 1 }], addressId, ...slot() })
      .expect(400);
    expect(res.body.error.code).toBe('NAME_REQUIRED');

    const noPhone = await loginCustomer(null);
    const noPhoneAddress = await addAddress(noPhone.token);
    const phoneless = await api()
      .post('/api/v1/bookings')
      .set(auth(noPhone.token))
      .send({ city: 'chennai', items: [{ serviceId: bath, qty: 1 }], addressId: noPhoneAddress, ...slot() })
      .expect(400);
    expect(phoneless.body.error.code).toBe('PHONE_REQUIRED');

    const { token } = await loginCustomer();
    const noAddr = await api()
      .post('/api/v1/bookings')
      .set(auth(token))
      .send({ city: 'chennai', items: [{ serviceId: bath, qty: 1 }], addressId: '6650f1f1f1f1f1f1f1f1f1f1', ...slot() })
      .expect(400);
    expect(noAddr.body.error.code).toBe('ADDRESS_REQUIRED');
  });

  it('rejects slots in the past, too far ahead or off the grid', async () => {
    const { token } = await loginCustomer();
    let res = await book(token, { days: -1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
    res = await book(token, { days: 9 });
    expect(res.status).toBe(400);
    res = await book(token, { time: '07:00' });
    expect(res.status).toBe(400);
    res = await book(token, { time: '11:30' });
    expect(res.status).toBe(400);
  });

  it('rejects an address from another city', async () => {
    const { token } = await loginCustomer();
    const addressId = await addAddress(token, 'bengaluru');
    const res = await book(token, { addressId, city: 'chennai' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ADDRESS_CITY_MISMATCH');
  });

  it('creates a pending booking with server-side pricing', async () => {
    const { token } = await loginCustomer();
    const res = await book(token, { couponCode: 'WELCOME100', days: 3, time: '09:00' });
    expect(res.status).toBe(201);
    const b = res.body.booking;
    expect(b.code).toMatch(/^GS[A-Z0-9]{6}$/);
    expect(b).toMatchObject({ status: 'pending', categoryName: 'Home Cleaning', cityName: 'Chennai', pin: null, professional: null });
    expect(b.pricing).toMatchObject({ subtotal: 499, discount: 100, visitFee: 0, total: 399, couponCode: 'WELCOME100' });
    expect(b.canCancel).toBe(true);
    expect(b.canReschedule).toBe(true);

    const coupon = await Coupon.findOne({ code: 'WELCOME100' });
    expect(coupon!.usedCount).toBeGreaterThanOrEqual(1);

    // per-customer limit
    const again = await book(token, { couponCode: 'WELCOME100', days: 3, time: '10:00' });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('COUPON_USED');

    const list = await api().get('/api/v1/bookings').set(auth(token)).expect(200);
    expect(list.body.bookings).toHaveLength(1);
    const byCode = await api().get(`/api/v1/bookings/${b.code}`).set(auth(token)).expect(200);
    expect(byCode.body.booking.id).toBe(b.id);
  });

  it('fills a slot once every professional is booked', async () => {
    // Chennai has 2 cleaning professionals
    const target = { days: 4, time: '14:00' };
    for (let i = 0; i < 2; i += 1) {
      const { token } = await loginCustomer();
      expect((await book(token, target)).status).toBe(201);
    }
    const { token } = await loginCustomer();
    const res = await book(token, target);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/filled up/);

    const slots = await api().get('/api/v1/slots?city=chennai&category=cleaning').expect(200);
    const day = slots.body.days[4];
    expect(day.slots.find((s: { time: string }) => s.time === '14:00').available).toBe(false);
    expect(day.slots.find((s: { time: string }) => s.time === '15:00').available).toBe(true);
  });

  it('keeps bookings private to their customer', async () => {
    const owner = await loginCustomer();
    const created = await book(owner.token, { days: 5 });
    const stranger = await loginCustomer();
    await api().get(`/api/v1/bookings/${created.body.booking.id}`).set(auth(stranger.token)).expect(404);
    await api().post(`/api/v1/bookings/${created.body.booking.id}/cancel`).set(auth(stranger.token)).send({ reason: 'not mine' }).expect(404);
  });
});

describe('changing bookings', () => {
  it('reschedules to a free slot and records it', async () => {
    const { token } = await loginCustomer();
    const created = await book(token, { days: 2, time: '12:00' });
    const id = created.body.booking.id;
    await api().post(`/api/v1/bookings/${id}/reschedule`).set(auth(token)).send(slot(2, '12:00')).expect(400);
    const res = await api().post(`/api/v1/bookings/${id}/reschedule`).set(auth(token)).send(slot(3, '17:00')).expect(200);
    expect(res.body.booking.slot.time).toBe('17:00');
    expect(res.body.booking.timeline.map((t: { status: string }) => t.status)).toContain('rescheduled');
  });

  it('cancels once, frees the coupon and blocks rating', async () => {
    const { token } = await loginCustomer();
    const created = await book(token, { couponCode: 'WELCOME100', days: 6 });
    const id = created.body.booking.id;
    const before = (await Coupon.findOne({ code: 'WELCOME100' }))!.usedCount;

    await api().post(`/api/v1/bookings/${id}/review`).set(auth(token)).send({ rating: 5 }).expect(409);
    await api().post(`/api/v1/bookings/${id}/cancel`).set(auth(token)).send({ reason: '' }).expect(400);
    const res = await api().post(`/api/v1/bookings/${id}/cancel`).set(auth(token)).send({ reason: 'Plans changed' }).expect(200);
    expect(res.body.booking).toMatchObject({ status: 'cancelled', canCancel: false, canReschedule: false });
    expect(res.body.booking.cancellation.reason).toBe('Plans changed');
    await api().post(`/api/v1/bookings/${id}/cancel`).set(auth(token)).send({ reason: 'again' }).expect(409);

    expect((await Coupon.findOne({ code: 'WELCOME100' }))!.usedCount).toBe(before - 1);
    // coupon can be used again after cancelling
    expect((await book(token, { couponCode: 'WELCOME100', days: 6, time: '18:00' })).status).toBe(201);
  });
});
