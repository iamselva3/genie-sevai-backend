import { Types } from 'mongoose';
import { config } from '../config';
import { Booking, Professional } from '../models';
import { addDays, dayLabel, localDate, slotInstant, slotTimes } from '../utils/time';

interface SlotQuery {
  cityId: Types.ObjectId;
  categoryId: Types.ObjectId;
  excludeBookingId?: Types.ObjectId | null;
  now?: Date;
}

/** Number of active professionals who can take a job in this city + category. */
export function capacityFor(cityId: Types.ObjectId, categoryId: Types.ObjectId) {
  return Professional.countDocuments({ status: 'active', city: cityId, skills: categoryId });
}

async function usedCounts(q: SlotQuery, dates: string[]) {
  const match: Record<string, unknown> = {
    city: q.cityId,
    category: q.categoryId,
    status: { $ne: 'cancelled' },
    'slot.date': { $in: dates },
  };
  if (q.excludeBookingId) match._id = { $ne: q.excludeBookingId };
  const rows = await Booking.aggregate<{ _id: { d: string; t: string }; n: number }>([
    { $match: match },
    { $group: { _id: { d: '$slot.date', t: '$slot.time' }, n: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [`${r._id.d} ${r._id.t}`, r.n]));
}

export async function slotDays(q: SlotQuery & { days?: number }) {
  const now = q.now ?? new Date();
  const today = localDate(now);
  const dates = Array.from({ length: q.days ?? config.slots.daysAhead }, (_, i) => addDays(today, i));
  const [capacity, used] = await Promise.all([capacityFor(q.cityId, q.categoryId), usedCounts(q, dates)]);
  const earliest = now.getTime() + config.slots.leadMinutes * 60_000;

  return {
    capacity,
    days: dates.map((date) => ({
      date,
      ...dayLabel(date),
      slots: slotTimes().map((time) => {
        const tooSoon = slotInstant(date, time).getTime() < earliest;
        const full = (used.get(`${date} ${time}`) || 0) >= capacity;
        return { time, available: !tooSoon && !full };
      }),
    })),
  };
}

export async function checkSlot(q: SlotQuery & { date: string; time: string }) {
  const now = q.now ?? new Date();
  if (!slotTimes().includes(q.time)) return { ok: false, reason: 'Pick one of the listed time slots' };
  const start = slotInstant(q.date, q.time);
  if (start.getTime() < now.getTime() + config.slots.leadMinutes * 60_000) {
    return { ok: false, reason: 'That slot is too soon. Pick a later time.' };
  }
  const lastDay = addDays(localDate(now), config.slots.daysAhead - 1);
  if (q.date > lastDay) return { ok: false, reason: `Slots open ${config.slots.daysAhead} days ahead` };
  const [capacity, used] = await Promise.all([capacityFor(q.cityId, q.categoryId), usedCounts(q, [q.date])]);
  if (capacity === 0) return { ok: false, reason: 'No professionals are available for this service right now' };
  if ((used.get(`${q.date} ${q.time}`) || 0) >= capacity) return { ok: false, reason: 'That slot just filled up. Pick another time.' };
  return { ok: true, reason: '' };
}
