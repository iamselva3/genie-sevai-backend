import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { config } from '../config';
import { AppError } from '../utils/errors';

/**
 * Picture storage (banner photos).
 *
 * With R2 configured, pictures go to the Cloudflare R2 bucket under `uploads/<name>`. Without it they
 * are written to UPLOAD_DIR. Either way they are reachable at `/uploads/<name>` on the API (see
 * `readUpload`). When R2_PUBLIC_DOMAIN is set, the stored URL points straight at the bucket instead.
 */

const r2 = config.uploads.r2;
export const usesR2 = config.uploads.driver === 'r2' && Boolean(r2.accountId && r2.accessKeyId && r2.secretAccessKey && r2.bucket);

if (config.uploads.driver === 'r2' && !usesR2) {
  console.warn('[storage] STORAGE_DRIVER=r2 but the R2 keys are missing - saving pictures to UPLOAD_DIR instead');
}

let client: S3Client | null = null;
function s3() {
  client ??= new S3Client({
    region: 'auto',
    endpoint: `https://${r2.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
  return client;
}

/** Upload names are random: 24 hex characters plus the extension. */
export const UPLOAD_NAME = /^[a-f0-9]{24}\.(png|jpg|webp|avif)$/;

const CONTENT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' };
const CACHE = 'public, max-age=31536000, immutable';

/** Saves a picture and returns the URL to store (`/uploads/<name>` or the bucket's public URL). */
export async function saveUpload(name: string, body: Buffer): Promise<string> {
  if (!UPLOAD_NAME.test(name)) throw new Error(`Bad upload name ${name}`);
  if (usesR2) {
    try {
      await s3().send(
        new PutObjectCommand({
          Bucket: r2.bucket,
          Key: `uploads/${name}`,
          Body: body,
          ContentType: CONTENT_TYPES[name.split('.')[1]],
          CacheControl: CACHE,
        }),
      );
    } catch (err) {
      console.error('[storage] R2 upload failed:', (err as Error)?.name || err);
      throw new AppError(502, 'Could not save the picture right now. Please try again.', 'STORAGE_FAILED');
    }
    return r2.publicUrl ? `${r2.publicUrl}/uploads/${name}` : `/uploads/${name}`;
  }
  await mkdir(config.uploads.dir, { recursive: true });
  await writeFile(path.join(config.uploads.dir, name), body);
  return `/uploads/${name}`;
}

/** Reads a picture from R2 for `/uploads/<name>`; null when it is not in the bucket. */
export async function readUpload(name: string): Promise<{ body: Readable; type: string; length?: number; etag?: string } | null> {
  if (!usesR2 || !UPLOAD_NAME.test(name)) return null;
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: r2.bucket, Key: `uploads/${name}` }));
    return {
      body: out.Body as Readable,
      type: out.ContentType || CONTENT_TYPES[name.split('.')[1]],
      length: out.ContentLength,
      etag: out.ETag,
    };
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

export const UPLOAD_CACHE_CONTROL = CACHE;
