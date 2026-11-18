import { config } from '../src/config';
import { api, auth, googleToken, loginCustomer, nextPhone, useDatabase } from './helpers';

useDatabase();

const google = (accessToken: string) => api().post('/api/v1/auth/google').send({ accessToken });

describe('customer Google sign-in', () => {
  it('creates the customer once and keeps their Google details', async () => {
    const sub = `g-asha-${Date.now()}`;
    const first = await google(googleToken({ sub, email: 'Asha@Example.com', name: 'Asha K', picture: 'https://lh3.googleusercontent.com/a/asha' })).expect(200);
    expect(first.body.isNew).toBe(true);
    expect(first.body.token).toBeTruthy();
    expect(first.body.customer).toMatchObject({ name: 'Asha K', email: 'asha@example.com', phone: '', avatarUrl: 'https://lh3.googleusercontent.com/a/asha' });

    const again = await google(googleToken({ sub, email: 'asha.k@example.com', name: 'Someone Else' })).expect(200);
    expect(again.body.isNew).toBe(false);
    expect(again.body.customer.id).toBe(first.body.customer.id);
    // the email follows the Google account; a name the customer already has is kept
    expect(again.body.customer).toMatchObject({ email: 'asha.k@example.com', name: 'Asha K' });
  });

  it('rejects forged and malformed tokens', async () => {
    const [head, payload] = googleToken().split('.');
    await google(`${head}.${payload}.${Buffer.from('forged-signature-0123456789abcdef').toString('base64url')}`).expect(401);
    await google('test.bm90LWpzb24.c2ln').expect(401);
    await api().post('/api/v1/auth/google').send({}).expect(400);
  });

  describe('real Google tokens', () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    afterEach(() => fetchSpy.mockReset());
    afterAll(() => fetchSpy.mockRestore());

    const googleSays = (tokeninfo: Record<string, unknown>, ok = true) =>
      fetchSpy.mockImplementation(async (url) =>
        String(url).includes('tokeninfo')
          ? new Response(JSON.stringify(tokeninfo), { status: ok ? 200 : 400 })
          : new Response(JSON.stringify({ name: 'Ravi Kumar', picture: 'https://lh3.googleusercontent.com/a/ravi' }), { status: 200 }),
      );
    const clientId = config.google.clientIds[0];

    it('accepts a token issued to our client for a verified email', async () => {
      googleSays({ aud: clientId, azp: clientId, sub: `g-ravi-${Date.now()}`, email: 'ravi@example.com', email_verified: 'true' });
      const res = await google('ya29.real-looking-access-token').expect(200);
      expect(res.body.customer).toMatchObject({ email: 'ravi@example.com', name: 'Ravi Kumar' });
      expect(String(fetchSpy.mock.calls[0][0])).toContain('oauth2.googleapis.com/tokeninfo');
    });

    it('rejects tokens for another app, unverified emails and expired tokens', async () => {
      googleSays({ aud: 'someone-else.apps.googleusercontent.com', sub: 'g-x', email: 'x@example.com', email_verified: 'true' });
      expect((await google('ya29.other-app-token').expect(401)).body.error.code).toBe('GOOGLE_WRONG_CLIENT');
      googleSays({ aud: clientId, sub: 'g-y', email: 'y@example.com', email_verified: 'false' });
      expect((await google('ya29.unverified-token').expect(401)).body.error.code).toBe('GOOGLE_UNVERIFIED');
      googleSays({ error_description: 'Invalid Value' }, false);
      expect((await google('ya29.expired-token').expect(401)).body.error.code).toBe('GOOGLE_INVALID');
    });
  });

  it('protects profile routes', async () => {
    await api().get('/api/v1/me').expect(401);
    await api().get('/api/v1/me').set(auth('garbage')).expect(401);
  });
});

describe('profile & addresses', () => {
  it('updates the name and mobile number (the email stays the Google one)', async () => {
    const { token, customer } = await loginCustomer(null, null);
    const phone = nextPhone();
    const res = await api().patch('/api/v1/me').set(auth(token)).send({ name: 'Asha', phone, email: 'other@example.com' }).expect(200);
    expect(res.body.customer).toMatchObject({ name: 'Asha', phone, email: customer.email });
    await api().patch('/api/v1/me').set(auth(token)).send({ phone: '12345' }).expect(400);
    // family members can share one contact number
    const other = await loginCustomer(phone);
    expect(other.phone).toBe(phone);
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
