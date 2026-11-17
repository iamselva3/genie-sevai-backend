import { api, auth, loginCustomer, nextPhone, useDatabase } from './helpers';

useDatabase();

describe('customer OTP sign-in', () => {
  it('rejects invalid phone numbers', async () => {
    const res = await api().post('/api/v1/auth/otp/send').send({ phone: '12345' }).expect(400);
    expect(res.body.error.message).toMatch(/10-digit/);
  });

  it('signs in with the right code and creates the customer once', async () => {
    const phone = nextPhone();
    const sent = await api().post('/api/v1/auth/otp/send').send({ phone }).expect(200);
    expect(sent.body.devCode).toMatch(/^\d{6}$/);
    const first = await api().post('/api/v1/auth/otp/verify').send({ phone, code: sent.body.devCode }).expect(200);
    expect(first.body.isNew).toBe(true);
    expect(first.body.token).toBeTruthy();

    const again = await api().post('/api/v1/auth/otp/send').send({ phone }).expect(200);
    const second = await api().post('/api/v1/auth/otp/verify').send({ phone, code: again.body.devCode }).expect(200);
    expect(second.body.isNew).toBe(false);
    expect(second.body.customer.id).toBe(first.body.customer.id);
  });

  it('rejects wrong codes, single-use codes and locks after 5 attempts', async () => {
    const phone = nextPhone();
    const sent = await api().post('/api/v1/auth/otp/send').send({ phone }).expect(200);
    const wrong = sent.body.devCode === '000000' ? '111111' : '000000';
    await api().post('/api/v1/auth/otp/verify').send({ phone, code: wrong }).expect(400);
    await api().post('/api/v1/auth/otp/verify').send({ phone, code: sent.body.devCode }).expect(200);
    // used code cannot be replayed
    await api().post('/api/v1/auth/otp/verify').send({ phone, code: sent.body.devCode }).expect(400);

    const fresh = await api().post('/api/v1/auth/otp/send').send({ phone }).expect(200);
    const bad = fresh.body.devCode === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) await api().post('/api/v1/auth/otp/verify').send({ phone, code: bad }).expect(400);
    await api().post('/api/v1/auth/otp/verify').send({ phone, code: fresh.body.devCode }).expect(429);
  });

  it('protects profile routes', async () => {
    await api().get('/api/v1/me').expect(401);
    await api().get('/api/v1/me').set(auth('garbage')).expect(401);
  });
});

describe('profile & addresses', () => {
  it('updates the profile', async () => {
    const { token } = await loginCustomer(undefined, null);
    const res = await api().patch('/api/v1/me').set(auth(token)).send({ name: 'Asha', email: 'asha@example.com' }).expect(200);
    expect(res.body.customer).toMatchObject({ name: 'Asha', email: 'asha@example.com' });
    await api().patch('/api/v1/me').set(auth(token)).send({ email: 'not-an-email' }).expect(400);
  });

  it('manages addresses with a single default', async () => {
    const { token } = await loginCustomer();
    await api()
      .post('/api/v1/me/addresses')
      .set(auth(token))
      .send({ line1: '1 Main Rd', city: 'chennai', pincode: '12' })
      .expect(400);
    await api()
      .post('/api/v1/me/addresses')
      .set(auth(token))
      .send({ line1: '1 Main Rd', city: 'salem', pincode: '636001' })
      .expect(400);

    const a = await api().post('/api/v1/me/addresses').set(auth(token)).send({ line1: '1 Main Rd', city: 'chennai', pincode: '600001' }).expect(201);
    expect(a.body.customer.addresses[0].isDefault).toBe(true);
    const b = await api()
      .post('/api/v1/me/addresses')
      .set(auth(token))
      .send({ label: 'Work', line1: '5 Tech Park', city: 'chennai', pincode: '600096', isDefault: true })
      .expect(201);
    const defaults = b.body.customer.addresses.filter((x: { isDefault: boolean }) => x.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].label).toBe('Work');

    const del = await api().delete(`/api/v1/me/addresses/${b.body.addressId}`).set(auth(token)).expect(200);
    expect(del.body.customer.addresses).toHaveLength(1);
    expect(del.body.customer.addresses[0].isDefault).toBe(true);
    await api().delete('/api/v1/me/addresses/xyz').set(auth(token)).expect(404);
  });
});
