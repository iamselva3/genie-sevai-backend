import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config';
import { City, Service } from '../src/models';
import { adminToken, api, auth, useDatabase } from './helpers';

useDatabase();

// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

let token: string;
beforeAll(async () => {
  token = await adminToken();
});

const home = (city = 'chennai') => api().get(`/api/v1/catalog/home?city=${city}`).expect(200);

describe('home banners', () => {
  it('serves the seeded banners in order, with links and live prices resolved', async () => {
    const res = await home();
    const banners = res.body.banners as Array<Record<string, unknown>>;
    expect(banners.map((b) => b.title)).toEqual(['Shine, shine', 'Flat ₹100 off', 'AC service, cool in an hour', '20% off, up to ₹300']);
    expect(banners[0]).toMatchObject({
      action: 'service',
      href: '/c/cleaning?s=bathroom-deep-cleaning',
      service: { slug: 'bathroom-deep-cleaning', price: 499, mrp: 599 },
      background: '#D7F0EA',
      textTone: 'dark',
      art: 'bathroom',
    });
    expect(banners[1]).toMatchObject({ action: 'coupon', couponCode: 'WELCOME100', href: null });
    expect(banners[0]).not.toHaveProperty('cities');
  });

  it('drops banners whose service is no longer offered', async () => {
    await Service.updateOne({ slug: 'foam-jet-ac-service-split' }, { status: 'unavailable' });
    const res = await home();
    expect(res.body.banners.map((b: { title: string }) => b.title)).not.toContain('AC service, cool in an hour');
    await Service.updateOne({ slug: 'foam-jet-ac-service-split' }, { status: 'active' });
  });
});

describe('admin banners', () => {
  it('needs a signed-in staff member', async () => {
    await api().get('/api/v1/admin/banners').expect(401);
    await api().post('/api/v1/admin/uploads').set('Content-Type', 'image/png').send(PNG).expect(401);
  });

  it('uploads a picture and serves it publicly', async () => {
    const res = await api().post('/api/v1/admin/uploads').set(auth(token)).set('Content-Type', 'image/png').send(PNG).expect(201);
    expect(res.body.url).toMatch(/^\/uploads\/[a-f0-9]{24}\.png$/);
    const saved = await readFile(path.join(config.uploads.dir, path.basename(res.body.url)));
    expect(saved.equals(PNG)).toBe(true);

    const served = await api().get(res.body.url).expect(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('rejects files that are not pictures', async () => {
    await api().post('/api/v1/admin/uploads').set(auth(token)).set('Content-Type', 'image/svg+xml').send('<svg/>').expect(415);
    await api().post('/api/v1/admin/uploads').set(auth(token)).set('Content-Type', 'image/png').send(Buffer.from('not really a png')).expect(400);
    const big = Buffer.concat([PNG, Buffer.alloc(config.uploads.maxBytes)]);
    await api().post('/api/v1/admin/uploads').set(auth(token)).set('Content-Type', 'image/png').send(big).expect(413);
  });

  it('creates, schedules, targets and removes a banner', async () => {
    const upload = await api().post('/api/v1/admin/uploads').set(auth(token)).set('Content-Type', 'image/png').send(PNG).expect(201);
    const created = await api()
      .post('/api/v1/admin/banners')
      .set(auth(token))
      .send({ title: 'Monsoon pest shield', layout: 'image', imageUrl: upload.body.url, background: '#0f766e', action: 'category', target: 'Pest-Control' })
      .expect(201);
    const banner = created.body.banner;
    expect(banner).toMatchObject({ background: '#0F766E', target: 'pest-control', sortOrder: 4, isActive: true });

    let titles = (await home()).body.banners.map((b: { title: string }) => b.title);
    expect(titles[titles.length - 1]).toBe('Monsoon pest shield');

    // Only for Bengaluru
    const bengaluru = await City.findOne({ slug: 'bengaluru' });
    await api().patch(`/api/v1/admin/banners/${banner.id}`).set(auth(token)).send({ cities: [String(bengaluru!._id)] }).expect(200);
    expect((await home('chennai')).body.banners.map((b: { title: string }) => b.title)).not.toContain('Monsoon pest shield');
    expect((await home('bengaluru')).body.banners.map((b: { title: string }) => b.title)).toContain('Monsoon pest shield');

    // Scheduled for later, then switched off
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await api().patch(`/api/v1/admin/banners/${banner.id}`).set(auth(token)).send({ startsAt: tomorrow }).expect(200);
    expect((await home('bengaluru')).body.banners.map((b: { title: string }) => b.title)).not.toContain('Monsoon pest shield');
    await api().patch(`/api/v1/admin/banners/${banner.id}`).set(auth(token)).send({ startsAt: null, isActive: false }).expect(200);
    expect((await home('bengaluru')).body.banners.map((b: { title: string }) => b.title)).not.toContain('Monsoon pest shield');

    await api().delete(`/api/v1/admin/banners/${banner.id}`).set(auth(token)).expect(200);
    await api().delete(`/api/v1/admin/banners/${banner.id}`).set(auth(token)).expect(404);
    titles = (await home()).body.banners.map((b: { title: string }) => b.title);
    expect(titles).toHaveLength(4);
  });

  it('validates banners', async () => {
    const post = (body: object) => api().post('/api/v1/admin/banners').set(auth(token)).send(body);
    expect((await post({ title: 'x' }).expect(400)).body.error.message).toMatch(/^title/);
    expect((await post({ title: 'Go', action: 'service' }).expect(400)).body.error.message).toMatch(/^target/);
    expect((await post({ title: 'Go', action: 'link', target: 'javascript:alert(1)' }).expect(400)).body.error.message).toMatch(/^target/);
    expect((await post({ title: 'Go', action: 'link', target: '//evil.example' }).expect(400)).body.error.message).toMatch(/^target/);
    expect((await post({ title: 'Go', layout: 'image' }).expect(400)).body.error.message).toMatch(/^imageUrl/);
    expect((await post({ title: 'Go', imageUrl: '/etc/passwd' }).expect(400)).body.error.message).toMatch(/^imageUrl/);
    expect((await post({ title: 'Go', background: 'red' }).expect(400)).body.error.message).toMatch(/^background/);
    await post({ title: 'Go', action: 'link', target: '/explore' }).expect(201);
  });

  it('reorders banners', async () => {
    const list = (await api().get('/api/v1/admin/banners').set(auth(token)).expect(200)).body.banners as Array<{ id: string; title: string }>;
    const reversed = [...list].reverse();
    await api().post('/api/v1/admin/banners/reorder').set(auth(token)).send({ ids: reversed.map((b) => b.id) }).expect(200);
    const after = (await api().get('/api/v1/admin/banners').set(auth(token)).expect(200)).body.banners as Array<{ title: string }>;
    expect(after.map((b) => b.title)).toEqual(reversed.map((b) => b.title));
  });
});
