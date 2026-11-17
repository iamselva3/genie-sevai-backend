import { generateCode, generatePin, TRANSITIONS } from '../src/services/bookingFlow';
import { availabilityOf } from '../src/services/catalog';
import { computeTotals, couponDiscount } from '../src/services/pricing';
import { addDays, dayLabel, isRealDate, localDate, slotInstant, slotTimes } from '../src/utils/time';
import { Types } from 'mongoose';

describe('couponDiscount', () => {
  it('gives a flat discount once the minimum order is met', () => {
    expect(couponDiscount({ type: 'flat', value: 100, maxDiscount: 0, minOrder: 499 }, 499)).toBe(100);
    expect(couponDiscount({ type: 'flat', value: 100, maxDiscount: 0, minOrder: 499 }, 498)).toBe(0);
  });

  it('caps percent discounts at maxDiscount', () => {
    expect(couponDiscount({ type: 'percent', value: 20, maxDiscount: 300, minOrder: 0 }, 1000)).toBe(200);
    expect(couponDiscount({ type: 'percent', value: 20, maxDiscount: 300, minOrder: 0 }, 5000)).toBe(300);
  });

  it('never discounts more than the subtotal', () => {
    expect(couponDiscount({ type: 'flat', value: 500, maxDiscount: 0, minOrder: 0 }, 200)).toBe(200);
  });
});

describe('computeTotals', () => {
  it('adds the visit fee below the free-visit threshold', () => {
    expect(computeTotals(129, 0)).toEqual({ visitFee: 79, total: 208 });
  });
  it('waives the visit fee at or above the threshold', () => {
    expect(computeTotals(499, 100)).toEqual({ visitFee: 0, total: 399 });
  });
});

describe('time helpers (IST)', () => {
  it('converts a local slot to the right UTC instant', () => {
    expect(slotInstant('2026-01-15', '10:00').toISOString()).toBe('2026-01-15T04:30:00.000Z');
  });
  it('computes the local date across the UTC midnight boundary', () => {
    expect(localDate(new Date('2026-01-15T20:00:00Z'))).toBe('2026-01-16');
  });
  it('adds days across month ends', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('validates calendar dates', () => {
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2028-02-29')).toBe(true);
  });
  it('lists hourly slots from 08:00 to 19:00', () => {
    const times = slotTimes();
    expect(times[0]).toBe('08:00');
    expect(times[times.length - 1]).toBe('19:00');
    expect(times).toHaveLength(12);
  });
  it('labels days', () => {
    expect(dayLabel('2026-11-17')).toEqual({ weekday: 'Tue', day: 17, month: 'Nov' });
  });
});

describe('booking helpers', () => {
  it('generates readable booking codes and 4-digit PINs', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateCode()).toMatch(/^GS[A-HJ-NP-Z2-9]{6}$/);
      expect(generatePin()).toMatch(/^\d{4}$/);
    }
  });
  it('only allows forward transitions and terminal end states', () => {
    expect(TRANSITIONS.completed).toEqual([]);
    expect(TRANSITIONS.cancelled).toEqual([]);
    expect(TRANSITIONS.in_progress).toEqual(['completed']);
    expect(TRANSITIONS.pending).not.toContain('completed');
  });
});

describe('availabilityOf', () => {
  const chennai = { _id: new Types.ObjectId(), name: 'Chennai' } as never;
  it('blocks unavailable services with their reason', () => {
    expect(availabilityOf({ status: 'unavailable', unavailableReason: 'Back soon', cities: [] })).toEqual({ bookable: false, reason: 'Back soon' });
  });
  it('blocks services not offered in the chosen city', () => {
    const result = availabilityOf({ status: 'active', unavailableReason: '', cities: [new Types.ObjectId()] }, chennai);
    expect(result.bookable).toBe(false);
    expect(result.reason).toBe('Not available in Chennai yet');
  });
  it('allows active services everywhere when no cities are set', () => {
    expect(availabilityOf({ status: 'active', unavailableReason: '', cities: [] }, chennai).bookable).toBe(true);
  });
});
