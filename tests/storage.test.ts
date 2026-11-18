/* Banner photos stored in Cloudflare R2. The bucket is faked here so the tests never touch the real one. */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

type Stored = { Body: Buffer; ContentType?: string; CacheControl?: string };

jest.mock('@aws-sdk/client-s3', () => {
  const objects = new Map<string, Stored & { Bucket: string }>();
  class Command {
    constructor(public input: Record<string, unknown>) {}
  }
  class PutObjectCommand extends Command {}
  class GetObjectCommand extends Command {}
  class S3Client {
    constructor(public options: Record<string, unknown>) {}
    async send(cmd: Command) {
      const key = `${cmd.input.Bucket}/${cmd.input.Key}`;
      if (cmd instanceof PutObjectCommand) {
        objects.set(key, cmd.input as unknown as Stored & { Bucket: string });
        return {};
      }
      const found = objects.get(key);
      if (!found) throw Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
      return { Body: Readable.from([found.Body]), ContentType: found.ContentType, ContentLength: found.Body.length, ETag: '"etag-1"' };
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, __objects: objects };
});

// Must be set before the app (and its config) is loaded.
process.env.STORAGE_DRIVER = 'r2';
process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-key';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
process.env.R2_BUCKET_NAME = 'sevai';
process.env.R2_PUBLIC_DOMAIN = '';

/* eslint-disable @typescript-eslint/no-require-imports */
const { adminToken, api, auth, useDatabase } = require('./helpers') as typeof import('./helpers');
const { config } = require('../src/config') as typeof import('../src/config');
const { __objects: objects } = jest.requireMock('@aws-sdk/client-s3') as { __objects: Map<string, Stored> };

useDatabase();

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

describe('banner photos in Cloudflare R2', () => {
  it('stores uploads in the bucket and serves them from /uploads', async () => {
    const token = await adminToken();
    const res = await api().post('/api/v1/admin/uploads').set(auth(token)).set('Content-Type', 'image/png').send(PNG).expect(201);
    expect(res.body.url).toMatch(/^\/uploads\/[a-f0-9]{24}\.png$/);
    const name = path.basename(res.body.url);

    const stored = objects.get(`sevai/uploads/${name}`);
    expect(stored?.Body.equals(PNG)).toBe(true);
    expect(stored?.ContentType).toBe('image/png');
    expect(stored?.CacheControl).toMatch(/immutable/);
    // nothing is written to the server's disk
    expect(existsSync(path.join(config.uploads.dir, name))).toBe(false);

    const served = await api().get(res.body.url).buffer(true).parse((r, done) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c)).on('end', () => done(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toMatch(/max-age=31536000/);
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect((served.body as Buffer).equals(PNG)).toBe(true);
  });

  it('answers 404 for pictures that are not in the bucket', async () => {
    await api().get('/uploads/0123456789abcdef01234567.png').expect(404);
    await api().get('/uploads/../../etc/passwd').expect(404);
  });
});
