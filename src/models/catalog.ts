import mongoose from './base';
import { HydratedDocument, Schema, Types } from 'mongoose';

/* ---------------- City ---------------- */
export interface ICity {
  name: string;
  slug: string;
  state: string;
  isActive: boolean;
  sortOrder: number;
}

const citySchema = new Schema<ICity>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    state: { type: String, default: '', trim: true },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const City = mongoose.model<ICity>('City', citySchema);
export type CityDoc = HydratedDocument<ICity>;

/* ---------------- Category ---------------- */
export interface ICategory {
  name: string;
  slug: string;
  tagline: string;
  description: string;
  icon: string;
  imageUrl: string;
  /** When false the category and all its services are hidden from customers. */
  isActive: boolean;
  sortOrder: number;
}

const categorySchema = new Schema<ICategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    tagline: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    icon: { type: String, default: 'wrench' },
    imageUrl: { type: String, default: '' },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Category = mongoose.model<ICategory>('Category', categorySchema);
export type CategoryDoc = HydratedDocument<ICategory>;

/* ---------------- Service ---------------- */
export const SERVICE_STATUSES = ['active', 'unavailable', 'hidden'] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export interface IService {
  category: Types.ObjectId;
  name: string;
  slug: string;
  group: string;
  shortDescription: string;
  description: string;
  inclusions: string[];
  exclusions: string[];
  price: number;
  mrp: number;
  durationMinutes: number;
  rating: number;
  ratingCount: number;
  /** active = shown & bookable, unavailable = shown but not bookable, hidden = not shown. */
  status: ServiceStatus;
  unavailableReason: string;
  /** Cities this service is offered in. Empty = every active city. */
  cities: Types.ObjectId[];
  isPopular: boolean;
  sortOrder: number;
  imageUrl: string;
}

const serviceSchema = new Schema<IService>(
  {
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    group: { type: String, default: 'General', trim: true },
    shortDescription: { type: String, default: '', trim: true },
    description: { type: String, default: '', trim: true },
    inclusions: { type: [String], default: [] },
    exclusions: { type: [String], default: [] },
    price: { type: Number, required: true, min: 0 },
    mrp: { type: Number, default: 0, min: 0 },
    durationMinutes: { type: Number, required: true, min: 10 },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: SERVICE_STATUSES, default: 'active', index: true },
    unavailableReason: { type: String, default: '', trim: true },
    cities: { type: [{ type: Schema.Types.ObjectId, ref: 'City' }], default: [] },
    isPopular: { type: Boolean, default: false },
    sortOrder: { type: Number, default: 0 },
    imageUrl: { type: String, default: '' },
  },
  { timestamps: true },
);

export const Service = mongoose.model<IService>('Service', serviceSchema);
export type ServiceDoc = HydratedDocument<IService>;
