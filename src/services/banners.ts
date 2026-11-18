import { Banner, BannerDoc, Category, CityDoc, Coupon, Service } from '../models';
import { availabilityOf } from './catalog';

/** Banners customers should see right now (active, inside their schedule, for this city). */
export async function liveBanners(city?: CityDoc | null, now = new Date()) {
  const banners = await Banner.find({
    isActive: true,
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
      city ? { $or: [{ cities: { $size: 0 } }, { cities: city._id }] } : {},
    ],
  }).sort({ sortOrder: 1, createdAt: 1 });

  const presented = await Promise.all(banners.map((b) => presentBanner(b, city, now)));
  return presented.filter((b): b is NonNullable<typeof b> => b !== null);
}

/**
 * Public shape of a banner, with its link resolved.
 * Returns null when the banner points at something customers can't use (hidden service, inactive coupon...).
 */
export async function presentBanner(banner: BannerDoc, city?: CityDoc | null, now = new Date()) {
  const base = {
    id: String(banner._id),
    title: banner.title,
    subtitle: banner.subtitle,
    eyebrow: banner.eyebrow,
    ctaLabel: banner.ctaLabel || 'Book now',
    imageUrl: banner.imageUrl,
    layout: banner.layout,
    background: banner.background,
    textTone: banner.textTone,
    art: banner.art,
    action: banner.action,
    href: null as string | null,
    service: null as null | { slug: string; name: string; price: number; mrp: number },
    couponCode: null as string | null,
  };

  switch (banner.action) {
    case 'service': {
      const service = await Service.findOne({ slug: banner.target }).populate('category');
      const category = service?.category as unknown as { slug: string; isActive: boolean } | null;
      if (!service || !category?.isActive || !availabilityOf(service, city).bookable) return null;
      return {
        ...base,
        href: `/c/${category.slug}?s=${service.slug}`,
        service: { slug: service.slug, name: service.name, price: service.price, mrp: service.mrp },
      };
    }
    case 'category': {
      const category = await Category.findOne({ slug: banner.target, isActive: true });
      return category ? { ...base, href: `/c/${category.slug}` } : null;
    }
    case 'coupon': {
      const coupon = await Coupon.findOne({ code: banner.target.toUpperCase(), isActive: true });
      if (!coupon) return null;
      if ((coupon.validFrom && coupon.validFrom > now) || (coupon.validTo && coupon.validTo <= now)) return null;
      if (coupon.usageLimit > 0 && coupon.usedCount >= coupon.usageLimit) return null;
      return { ...base, couponCode: coupon.code };
    }
    case 'link':
      return { ...base, href: banner.target || null };
    default:
      return base;
  }
}
