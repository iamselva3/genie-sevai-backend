import mongoose from './base';
import { HydratedDocument, Schema, Types } from 'mongoose';

/* ---------------- Home page banner ---------------- */
export const BANNER_LAYOUTS = ['split', 'image'] as const;
export const BANNER_ACTIONS = ['service', 'category', 'coupon', 'link', 'none'] as const;
export const BANNER_ART = ['', 'bathroom', 'ac', 'gift'] as const;

export interface IBanner {
  /** Headline. For the "image" layout it is the picture's alt text. */
  title: string;
  subtitle: string;
  /** Small label above the title. */
  eyebrow: string;
  ctaLabel: string;
  /** Uploaded picture ('/uploads/...', relative to the API origin) or an absolute https URL. */
  imageUrl: string;
  /** split = solid colour + text + picture on the right; image = the picture fills the banner. */
  layout: (typeof BANNER_LAYOUTS)[number];
  /** Solid background colour, #RRGGBB. */
  background: string;
  /** dark = dark text (for light backgrounds), light = light text (for dark backgrounds). */
  textTone: 'dark' | 'light';
  /** Built-in illustration shown when there is no picture. */
  art: (typeof BANNER_ART)[number];
  action: (typeof BANNER_ACTIONS)[number];
  /** Service slug, category slug, coupon code or link, depending on the action. */
  target: string;
  /** Cities that see the banner. Empty = every city. */
  cities: Types.ObjectId[];
  isActive: boolean;
  sortOrder: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

const bannerSchema = new Schema<IBanner>(
  {
    title: { type: String, required: true, trim: true },
    subtitle: { type: String, default: '', trim: true },
    eyebrow: { type: String, default: '', trim: true },
    ctaLabel: { type: String, default: 'Book now', trim: true },
    imageUrl: { type: String, default: '', trim: true },
    layout: { type: String, enum: BANNER_LAYOUTS, default: 'split' },
    background: { type: String, default: '#F2F2F4', uppercase: true },
    textTone: { type: String, enum: ['dark', 'light'], default: 'dark' },
    art: { type: String, enum: BANNER_ART, default: '' },
    action: { type: String, enum: BANNER_ACTIONS, default: 'none' },
    target: { type: String, default: '', trim: true },
    cities: { type: [Schema.Types.ObjectId], ref: 'City', default: [] },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0 },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Banner = mongoose.model<IBanner>('Banner', bannerSchema);
export type BannerDoc = HydratedDocument<IBanner>;
