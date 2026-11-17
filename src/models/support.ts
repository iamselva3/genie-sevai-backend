import mongoose from './base';
import { HydratedDocument, Schema, Types } from 'mongoose';

/* ---------------- Coupon ---------------- */
export interface ICoupon {
  code: string;
  description: string;
  type: 'percent' | 'flat';
  value: number;
  /** Cap for percent coupons (0 = no cap). */
  maxDiscount: number;
  minOrder: number;
  isActive: boolean;
  /** Public coupons are listed on the cart page. */
  isPublic: boolean;
  validFrom?: Date | null;
  validTo?: Date | null;
  /** Total redemptions allowed (0 = unlimited). */
  usageLimit: number;
  usedCount: number;
  /** Redemptions per customer (0 = unlimited). */
  perCustomerLimit: number;
}

const couponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: '', trim: true },
    type: { type: String, enum: ['percent', 'flat'], required: true },
    value: { type: Number, required: true, min: 0 },
    maxDiscount: { type: Number, default: 0, min: 0 },
    minOrder: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    isPublic: { type: Boolean, default: true },
    validFrom: { type: Date, default: null },
    validTo: { type: Date, default: null },
    usageLimit: { type: Number, default: 0, min: 0 },
    usedCount: { type: Number, default: 0, min: 0 },
    perCustomerLimit: { type: Number, default: 1, min: 0 },
  },
  { timestamps: true },
);

export const Coupon = mongoose.model<ICoupon>('Coupon', couponSchema);
export type CouponDoc = HydratedDocument<ICoupon>;

/* ---------------- Enquiry (help desk) ---------------- */
export interface IEnquiry {
  name: string;
  phone: string;
  email: string;
  topic: string;
  message: string;
  bookingCode: string;
  customer?: Types.ObjectId | null;
  status: 'open' | 'resolved';
}

const enquirySchema = new Schema<IEnquiry>(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    topic: { type: String, default: 'General', trim: true },
    message: { type: String, required: true, trim: true },
    bookingCode: { type: String, default: '', trim: true, uppercase: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
    status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
  },
  { timestamps: true },
);

export const Enquiry = mongoose.model<IEnquiry>('Enquiry', enquirySchema);

/* ---------------- Professional application ---------------- */
export const APPLICATION_STATUSES = ['new', 'contacted', 'approved', 'rejected'] as const;

export interface IProApplication {
  name: string;
  phone: string;
  city: string;
  skills: string[];
  experienceYears: number;
  message: string;
  status: (typeof APPLICATION_STATUSES)[number];
}

const proApplicationSchema = new Schema<IProApplication>(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    skills: { type: [String], default: [] },
    experienceYears: { type: Number, default: 0, min: 0 },
    message: { type: String, default: '', trim: true },
    status: { type: String, enum: APPLICATION_STATUSES, default: 'new', index: true },
  },
  { timestamps: true },
);

export const ProApplication = mongoose.model<IProApplication>('ProApplication', proApplicationSchema);
export type ProApplicationDoc = HydratedDocument<IProApplication>;
