import { Types } from 'mongoose';
import { Category, CategoryDoc, City, CityDoc, IService, Service, ServiceDoc } from '../models';

export interface Availability {
  bookable: boolean;
  reason: string;
}

/** Whether a (non-hidden) service can be booked, optionally in a specific city. */
export function availabilityOf(service: Pick<IService, 'status' | 'unavailableReason' | 'cities'>, city?: CityDoc | null): Availability {
  if (service.status === 'unavailable') {
    return { bookable: false, reason: service.unavailableReason || 'Temporarily unavailable' };
  }
  if (service.status === 'hidden') {
    return { bookable: false, reason: 'Not offered' };
  }
  if (city && service.cities.length > 0 && !service.cities.some((id) => id.equals(city._id))) {
    return { bookable: false, reason: `Not available in ${city.name} yet` };
  }
  return { bookable: true, reason: '' };
}

export function presentCategory(category: CategoryDoc, extra: Record<string, unknown> = {}) {
  return {
    id: String(category._id),
    slug: category.slug,
    name: category.name,
    tagline: category.tagline,
    description: category.description,
    icon: category.icon,
    imageUrl: category.imageUrl,
    ...extra,
  };
}

export function presentService(service: ServiceDoc, category: CategoryDoc | null, city?: CityDoc | null) {
  const availability = availabilityOf(service, city);
  return {
    id: String(service._id),
    slug: service.slug,
    name: service.name,
    group: service.group,
    shortDescription: service.shortDescription,
    description: service.description,
    inclusions: service.inclusions,
    exclusions: service.exclusions,
    price: service.price,
    mrp: service.mrp,
    durationMinutes: service.durationMinutes,
    rating: service.rating,
    ratingCount: service.ratingCount,
    isPopular: service.isPopular,
    imageUrl: service.imageUrl,
    category: category ? { id: String(category._id), slug: category.slug, name: category.name, icon: category.icon } : null,
    bookable: availability.bookable,
    unavailableReason: availability.reason,
  };
}

export async function findCityBySlug(slug?: string | null) {
  if (!slug) return null;
  return City.findOne({ slug: slug.toLowerCase(), isActive: true });
}

/** Visible categories with service counts and starting prices (hidden services excluded). */
export async function visibleCategories(city?: CityDoc | null) {
  const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
  const ids = categories.map((c) => c._id);
  const services = await Service.find({ category: { $in: ids }, status: { $ne: 'hidden' } }).select(
    'category price status cities',
  );
  const stats = new Map<string, { count: number; from: number; bookable: number }>();
  for (const s of services) {
    const key = String(s.category);
    const entry = stats.get(key) || { count: 0, from: Number.POSITIVE_INFINITY, bookable: 0 };
    entry.count += 1;
    const avail = availabilityOf(s, city);
    if (avail.bookable) {
      entry.bookable += 1;
      entry.from = Math.min(entry.from, s.price);
    }
    stats.set(key, entry);
  }
  return categories.map((c) => {
    const s = stats.get(String(c._id));
    return presentCategory(c, {
      serviceCount: s?.count ?? 0,
      bookableCount: s?.bookable ?? 0,
      startingPrice: s && Number.isFinite(s.from) ? s.from : null,
    });
  });
}

export function sameId(a: Types.ObjectId | string | null | undefined, b: Types.ObjectId | string | null | undefined) {
  return a != null && b != null && String(a) === String(b);
}
