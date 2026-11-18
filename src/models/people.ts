import mongoose from './base';
import { HydratedDocument, Schema, Types } from 'mongoose';

/* ---------------- Customer ---------------- */
export const ADDRESS_LABELS = ['Home', 'Work', 'Other'] as const;

export interface IAddress {
  _id: Types.ObjectId;
  label: (typeof ADDRESS_LABELS)[number];
  line1: string;
  line2: string;
  landmark: string;
  city: string;
  pincode: string;
  isDefault: boolean;
}

const addressSchema = new Schema<IAddress>({
  label: { type: String, enum: ADDRESS_LABELS, default: 'Home' },
  line1: { type: String, required: true, trim: true },
  line2: { type: String, default: '', trim: true },
  landmark: { type: String, default: '', trim: true },
  city: { type: String, required: true, lowercase: true, trim: true },
  pincode: { type: String, required: true, trim: true },
  isDefault: { type: Boolean, default: false },
});

export interface ICustomer {
  /** Google account id; customers sign in with Google. */
  googleId?: string;
  /** Contact number for the professional; asked after the first sign-in and needed to book. */
  phone: string;
  name: string;
  email: string;
  avatarUrl: string;
  addresses: Types.DocumentArray<IAddress>;
  isBlocked: boolean;
  lastLoginAt?: Date;
}

const customerSchema = new Schema<ICustomer>(
  {
    googleId: { type: String, unique: true, sparse: true },
    phone: { type: String, default: '', trim: true },
    name: { type: String, default: '', trim: true },
    email: { type: String, default: '', trim: true, lowercase: true, index: true },
    avatarUrl: { type: String, default: '' },
    addresses: { type: [addressSchema], default: [] },
    isBlocked: { type: Boolean, default: false },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

export const Customer = mongoose.model<ICustomer>('Customer', customerSchema);
export type CustomerDoc = HydratedDocument<ICustomer>;

/* ---------------- Professional (employee) ---------------- */
export const PRO_STATUSES = ['active', 'inactive'] as const;

export interface IProfessional {
  name: string;
  phone: string;
  email: string;
  passwordHash: string;
  city: Types.ObjectId;
  /** Categories this professional is trained for. */
  skills: Types.ObjectId[];
  experienceYears: number;
  bio: string;
  status: (typeof PRO_STATUSES)[number];
  rating: number;
  ratingCount: number;
  jobsCompleted: number;
  lastLoginAt?: Date;
}

const professionalSchema = new Schema<IProfessional>(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true, trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    passwordHash: { type: String, required: true },
    city: { type: Schema.Types.ObjectId, ref: 'City', required: true, index: true },
    skills: { type: [{ type: Schema.Types.ObjectId, ref: 'Category' }], default: [], index: true },
    experienceYears: { type: Number, default: 0, min: 0 },
    bio: { type: String, default: '', trim: true },
    status: { type: String, enum: PRO_STATUSES, default: 'active', index: true },
    rating: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0 },
    jobsCompleted: { type: Number, default: 0 },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

export const Professional = mongoose.model<IProfessional>('Professional', professionalSchema);
export type ProfessionalDoc = HydratedDocument<IProfessional>;

/* ---------------- Admin / staff user ---------------- */
export const STAFF_ROLES = ['admin', 'manager'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export interface IAdminUser {
  name: string;
  email: string;
  passwordHash: string;
  role: StaffRole;
  isActive: boolean;
  lastLoginAt?: Date;
}

const adminUserSchema = new Schema<IAdminUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: STAFF_ROLES, default: 'manager' },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

export const AdminUser = mongoose.model<IAdminUser>('AdminUser', adminUserSchema);
export type AdminUserDoc = HydratedDocument<IAdminUser>;
