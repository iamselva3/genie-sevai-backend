import { isValidObjectId, Types } from 'mongoose';
import { config } from '../config';
import { Booking, Category, CategoryDoc, CityDoc, Coupon, CouponDoc, ICoupon, Service, ServiceDoc } from '../models';
import { AppError, badRequest } from '../utils/errors';
import { availabilityOf, findCityBySlug } from './catalog';

export type CouponRule = Pick<ICoupon, 'type' | 'value' | 'maxDiscount' | 'minOrder'>;

/** Discount a coupon gives on a subtotal (never more than the subtotal). */
export function couponDiscount(coupon: CouponRule, subtotal: number): number {
  if (subtotal < coupon.minOrder) return 0;
  let discount = coupon.type === 'percent' ? Math.floor((subtotal * coupon.value) / 100) : coupon.value;
  if (coupon.type === 'percent' && coupon.maxDiscount > 0) discount = Math.min(discount, coupon.maxDiscount);
  return Math.max(0, Math.min(discount, subtotal));
}

/** Visit fee and final total for a subtotal and discount. */
export function computeTotals(subtotal: number, discount: number) {
  const visitFee = subtotal >= config.pricing.freeVisitAbove ? 0 : config.pricing.visitFee;
  return { visitFee, total: Math.max(0, subtotal - discount + visitFee) };
}

/** Validates a coupon for a subtotal (and customer when known). Throws a 400 explaining why it can't be used. */
export async function resolveCoupon(code: string, subtotal: number, customerId?: Types.ObjectId | null): Promise<CouponDoc> {
  const coupon = await Coupon.findOne({ code: code.trim().toUpperCase() });
  const now = new Date();
  if (!coupon || !coupon.isActive) throw badRequest('This coupon is not valid', 'COUPON_INVALID');
  if ((coupon.validFrom && coupon.validFrom > now) || (coupon.validTo && coupon.validTo < now)) {
    throw badRequest('This coupon has expired', 'COUPON_EXPIRED');
  }
  if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) {
    throw badRequest('This coupon has been fully redeemed', 'COUPON_EXHAUSTED');
  }
  if (subtotal < coupon.minOrder) {
    throw badRequest(`Add ₹${coupon.minOrder - subtotal} more to use ${coupon.code}`, 'COUPON_MIN_ORDER');
  }
  if (customerId && coupon.perCustomerLimit > 0) {
    const used = await Booking.countDocuments({
      customer: customerId,
      'pricing.couponCode': coupon.code,
      status: { $ne: 'cancelled' },
    });
    if (used >= coupon.perCustomerLimit) throw badRequest('You have already used this coupon', 'COUPON_USED');
  }
  return coupon;
}

export interface QuoteInput {
  items: { serviceId: string; qty: number }[];
  couponCode?: string | null;
  city?: string | null;
  customerId?: Types.ObjectId | null;
  /** When true an unusable coupon is an error (placing a booking); otherwise it is reported in couponError. */
  strictCoupon?: boolean;
}

export interface QuoteLine {
  service: ServiceDoc;
  name: string;
  price: number;
  mrp: number;
  qty: number;
  lineTotal: number;
  durationMinutes: number;
}

export interface Quote {
  category: CategoryDoc;
  city: CityDoc | null;
  lines: QuoteLine[];
  subtotal: number;
  discount: number;
  visitFee: number;
  total: number;
  savings: number;
  durationMinutes: number;
  coupon: CouponDoc | null;
  couponError: string | null;
}

export async function buildQuote(input: QuoteInput): Promise<Quote> {
  if (!input.items.length) throw badRequest('Your cart is empty', 'CART_EMPTY');

  // Merge duplicate lines
  const merged = new Map<string, number>();
  for (const item of input.items) {
    if (!isValidObjectId(item.serviceId)) throw badRequest('One of the services no longer exists', 'SERVICE_NOT_FOUND');
    merged.set(item.serviceId, (merged.get(item.serviceId) || 0) + item.qty);
  }
  if (merged.size > config.booking.maxItems) {
    throw badRequest(`You can book up to ${config.booking.maxItems} services at once`, 'CART_TOO_LARGE');
  }

  const city = input.city ? await findCityBySlug(input.city) : null;
  if (input.city && !city) throw badRequest('We do not serve this city yet', 'CITY_UNAVAILABLE');

  const services = await Service.find({ _id: { $in: [...merged.keys()] } });
  if (services.length !== merged.size || services.some((s) => s.status === 'hidden')) {
    throw badRequest('One of the services no longer exists', 'SERVICE_NOT_FOUND');
  }
  const categoryId = services[0].category;
  if (services.some((s) => !s.category.equals(categoryId))) {
    throw badRequest('Book services from one category at a time', 'MIXED_CATEGORIES');
  }
  const category = await Category.findById(categoryId);
  if (!category || !category.isActive) throw badRequest('This category is not available right now', 'CATEGORY_UNAVAILABLE');

  const lines: QuoteLine[] = [];
  for (const [id, qty] of merged) {
    const service = services.find((s) => String(s._id) === id)!;
    const availability = availabilityOf(service, city);
    if (!availability.bookable) {
      throw new AppError(400, `${service.name}: ${availability.reason}`, 'SERVICE_UNAVAILABLE');
    }
    if (qty > config.booking.maxQty) throw badRequest(`Maximum ${config.booking.maxQty} of ${service.name}`, 'QTY_TOO_LARGE');
    lines.push({
      service,
      name: service.name,
      price: service.price,
      mrp: service.mrp,
      qty,
      lineTotal: service.price * qty,
      durationMinutes: service.durationMinutes,
    });
  }

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const savings = lines.reduce((sum, l) => sum + Math.max(0, (l.mrp || l.price) - l.price) * l.qty, 0);
  const durationMinutes = lines.reduce((sum, l) => sum + l.durationMinutes * l.qty, 0);

  let coupon: CouponDoc | null = null;
  let couponError: string | null = null;
  let discount = 0;
  if (input.couponCode && input.couponCode.trim()) {
    try {
      coupon = await resolveCoupon(input.couponCode, subtotal, input.customerId);
      discount = couponDiscount(coupon, subtotal);
    } catch (err) {
      if (input.strictCoupon || !(err instanceof AppError)) throw err;
      couponError = err.message;
    }
  }

  const { visitFee, total } = computeTotals(subtotal, discount);
  return { category, city, lines, subtotal, discount, visitFee, total, savings, durationMinutes, coupon, couponError };
}

export function presentQuote(q: Quote) {
  return {
    category: { id: String(q.category._id), slug: q.category.slug, name: q.category.name },
    city: q.city ? { id: String(q.city._id), slug: q.city.slug, name: q.city.name } : null,
    lines: q.lines.map((l) => ({
      serviceId: String(l.service._id),
      slug: l.service.slug,
      name: l.name,
      price: l.price,
      mrp: l.mrp,
      qty: l.qty,
      lineTotal: l.lineTotal,
      durationMinutes: l.durationMinutes,
    })),
    subtotal: q.subtotal,
    discount: q.discount,
    visitFee: q.visitFee,
    total: q.total,
    savings: q.savings + q.discount,
    durationMinutes: q.durationMinutes,
    freeVisitAbove: config.pricing.freeVisitAbove,
    coupon: q.coupon ? { code: q.coupon.code, description: q.coupon.description } : null,
    couponError: q.couponError,
  };
}
