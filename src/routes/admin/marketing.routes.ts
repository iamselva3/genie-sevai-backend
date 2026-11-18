import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import express, { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { config } from '../../config';
import { Banner, BANNER_ACTIONS, BANNER_ART, BANNER_LAYOUTS } from '../../models';
import { AppError, badRequest, notFound } from '../../utils/errors';
import { objectId, parse } from '../../utils/validate';

const router = Router();

/* ---------------- Picture uploads ---------------- */

const IMAGE_TYPES: Record<string, { ext: string; looksRight: (b: Buffer) => boolean }> = {
  'image/png': { ext: 'png', looksRight: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/jpeg': { ext: 'jpg', looksRight: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/webp': { ext: 'webp', looksRight: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  'image/avif': { ext: 'avif', looksRight: (b) => b.toString('ascii', 4, 8) === 'ftyp' && /avi[fs]/.test(b.toString('ascii', 8, 12)) },
};

/** Raw upload: the request body is the picture itself, Content-Type says what it is. */
router.post(
  '/uploads',
  express.raw({ type: Object.keys(IMAGE_TYPES), limit: config.uploads.maxBytes }),
  async (req, res) => {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const kind = IMAGE_TYPES[type];
    if (!kind) throw new AppError(415, 'Upload a PNG, JPEG, WebP or AVIF picture', 'UNSUPPORTED_TYPE');
    const body = req.body as unknown;
    if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('The picture is empty');
    if (!kind.looksRight(body)) throw badRequest('That file is not a valid picture', 'BAD_IMAGE');

    await mkdir(config.uploads.dir, { recursive: true });
    const name = `${randomBytes(12).toString('hex')}.${kind.ext}`;
    await writeFile(path.join(config.uploads.dir, name), body);
    res.status(201).json({ url: `/uploads/${name}`, bytes: body.length });
  },
);

/* ---------------- Banners ---------------- */

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #FFD43B')
  .transform((v) => v.toUpperCase());

const imageUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^\/uploads\/[a-f0-9]{24}\.(png|jpg|webp|avif)$/.test(v) || /^https:\/\/\S+$/.test(v), 'Upload a picture or use an https link');

const bannerFields = z.object({
  title: z.string().trim().min(2, 'Add a title').max(80),
  subtitle: z.string().trim().max(160).optional(),
  eyebrow: z.string().trim().max(40).optional(),
  ctaLabel: z.string().trim().max(24).optional(),
  imageUrl: imageUrl.optional(),
  layout: z.enum(BANNER_LAYOUTS).optional(),
  background: hex.optional(),
  textTone: z.enum(['dark', 'light']).optional(),
  art: z.enum(BANNER_ART).optional(),
  action: z.enum(BANNER_ACTIONS).optional(),
  target: z.string().trim().max(300).optional(),
  cities: z.array(objectId).max(50).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
});

type BannerInput = Partial<z.infer<typeof bannerFields>>;

/** Rules that depend on several fields; checked on the merged (saved + incoming) banner. */
function checkBanner(b: BannerInput) {
  const action = b.action ?? 'none';
  const target = (b.target ?? '').trim();
  if (action !== 'none' && !target) throw badRequest('target: Choose what the banner opens');
  if (action === 'link' && !/^(\/(?!\/)\S*|https:\/\/\S+)$/.test(target)) throw badRequest("target: Use a path like '/explore' or an https link");
  if ((b.layout ?? 'split') === 'image' && !b.imageUrl) throw badRequest('imageUrl: A full-picture banner needs a picture');
  if (b.startsAt && b.endsAt && b.endsAt <= b.startsAt) throw badRequest('endsAt: The end must be after the start');
}

function normalise(b: BannerInput) {
  const out: BannerInput = { ...b };
  if (out.action === 'none') out.target = '';
  if (out.action === 'coupon' && out.target) out.target = out.target.toUpperCase();
  if (out.action === 'service' || out.action === 'category') out.target = out.target?.toLowerCase();
  return out;
}

router.get('/banners', async (_req, res) => {
  res.json({ banners: await Banner.find().sort({ sortOrder: 1, createdAt: 1 }) });
});

router.post('/banners', async (req, res) => {
  const body = normalise(parse(bannerFields, req.body));
  checkBanner(body);
  if (body.sortOrder === undefined) {
    const last = await Banner.findOne().sort({ sortOrder: -1 });
    body.sortOrder = (last?.sortOrder ?? -1) + 1;
  }
  res.status(201).json({ banner: await Banner.create(body) });
});

router.post('/banners/reorder', async (req, res) => {
  const { ids } = parse(z.object({ ids: z.array(objectId).min(1).max(200) }), req.body);
  await Banner.bulkWrite(ids.map((id, i) => ({ updateOne: { filter: { _id: id }, update: { $set: { sortOrder: i } } } })));
  res.json({ ok: true });
});

router.patch('/banners/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw notFound('Banner');
  const banner = await Banner.findById(req.params.id);
  if (!banner) throw notFound('Banner');
  const body = parse(bannerFields.partial(), req.body);
  const merged = normalise({
    title: banner.title,
    imageUrl: banner.imageUrl,
    layout: banner.layout,
    action: banner.action,
    target: banner.target,
    startsAt: banner.startsAt,
    endsAt: banner.endsAt,
    ...body,
  });
  checkBanner(merged);
  banner.set({ ...body, ...(body.action !== undefined || body.target !== undefined ? { target: merged.target } : {}) });
  await banner.save();
  res.json({ banner });
});

router.delete('/banners/:id', async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw notFound('Banner');
  const banner = await Banner.findByIdAndDelete(req.params.id);
  if (!banner) throw notFound('Banner');
  res.json({ ok: true });
});

export default router;
