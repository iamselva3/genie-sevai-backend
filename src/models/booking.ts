import mongoose from './base';
import { HydratedDocument, Schema, Types } from 'mongoose';

export const BOOKING_STATUSES = [
  'pending', // placed, waiting for a professional
  'assigned', // professional assigned by the operations team
  'on_the_way',
  'in_progress', // started after the customer shared their service PIN
  'completed',
  'cancelled',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Statuses in which a professional is committed to the job. */
export const ACTIVE_JOB_STATUSES: BookingStatus[] = ['assigned', 'on_the_way', 'in_progress'];

export const ACTORS = ['customer', 'admin', 'professional', 'system'] as const;
export type Actor = (typeof ACTORS)[number];

export interface IBookingItem {
  service: Types.ObjectId;
  name: string;
  price: number;
  mrp: number;
  qty: number;
  durationMinutes: number;
}

export interface ITimelineEntry {
  status: BookingStatus | 'rescheduled' | 'unassigned';
  at: Date;
  actor: Actor;
  note: string;
}

export interface IBooking {
  code: string;
  customer: Types.ObjectId;
  category: Types.ObjectId;
  categoryName: string;
  city: Types.ObjectId;
  cityName: string;
  items: IBookingItem[];
  address: {
    label: string;
    line1: string;
    line2: string;
    landmark: string;
    city: string;
    pincode: string;
  };
  slot: { date: string; time: string; start: Date; end: Date };
  durationMinutes: number;
  pricing: { subtotal: number; discount: number; visitFee: number; total: number; couponCode: string };
  paymentMethod: 'pay_after_service';
  paymentStatus: 'pending' | 'paid';
  status: BookingStatus;
  professional?: Types.ObjectId | null;
  pin: string;
  timeline: ITimelineEntry[];
  cancellation?: { reason: string; by: Actor; at: Date } | null;
  review?: { rating: number; comment: string; at: Date; hidden: boolean } | null;
  notes: string;
  createdAt: Date;
  updatedAt: Date;
}

const itemSchema = new Schema<IBookingItem>(
  {
    service: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    mrp: { type: Number, default: 0 },
    qty: { type: Number, required: true, min: 1 },
    durationMinutes: { type: Number, required: true },
  },
  { _id: false },
);

const timelineSchema = new Schema<ITimelineEntry>(
  {
    status: { type: String, required: true },
    at: { type: Date, default: () => new Date() },
    actor: { type: String, enum: ACTORS, required: true },
    note: { type: String, default: '' },
  },
  { _id: false },
);

const bookingSchema = new Schema<IBooking>(
  {
    code: { type: String, required: true, unique: true },
    customer: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    categoryName: { type: String, required: true },
    city: { type: Schema.Types.ObjectId, ref: 'City', required: true },
    cityName: { type: String, required: true },
    items: { type: [itemSchema], required: true },
    address: {
      label: String,
      line1: String,
      line2: String,
      landmark: String,
      city: String,
      pincode: String,
    },
    slot: {
      date: { type: String, required: true },
      time: { type: String, required: true },
      start: { type: Date, required: true },
      end: { type: Date, required: true },
    },
    durationMinutes: { type: Number, required: true },
    pricing: {
      subtotal: { type: Number, required: true },
      discount: { type: Number, default: 0 },
      visitFee: { type: Number, default: 0 },
      total: { type: Number, required: true },
      couponCode: { type: String, default: '' },
    },
    paymentMethod: { type: String, enum: ['pay_after_service'], default: 'pay_after_service' },
    paymentStatus: { type: String, enum: ['pending', 'paid'], default: 'pending' },
    status: { type: String, enum: BOOKING_STATUSES, default: 'pending', index: true },
    professional: { type: Schema.Types.ObjectId, ref: 'Professional', default: null },
    pin: { type: String, required: true },
    timeline: { type: [timelineSchema], default: [] },
    cancellation: {
      type: new Schema({ reason: String, by: String, at: Date }, { _id: false }),
      default: null,
    },
    review: {
      type: new Schema(
        { rating: Number, comment: String, at: Date, hidden: { type: Boolean, default: false } },
        { _id: false },
      ),
      default: null,
    },
    notes: { type: String, default: '', trim: true },
  },
  { timestamps: true },
);

bookingSchema.index({ professional: 1, 'slot.start': 1 });
bookingSchema.index({ city: 1, category: 1, 'slot.date': 1, 'slot.time': 1 });
bookingSchema.index({ createdAt: -1 });

export const Booking = mongoose.model<IBooking>('Booking', bookingSchema);
export type BookingDoc = HydratedDocument<IBooking>;
