import { config } from '../config';

const MINUTE = 60_000;
const offsetMs = () => config.tzOffsetMinutes * MINUTE;

/** Local calendar date (YYYY-MM-DD) for an instant. */
export function localDate(at: Date = new Date()): string {
  return new Date(at.getTime() + offsetMs()).toISOString().slice(0, 10);
}

/** Converts a local date + HH:mm into the UTC instant it represents. */
export function slotInstant(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - offsetMs());
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function isRealDate(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** All slot start times in a day, e.g. ["08:00", "09:00", ...]. */
export function slotTimes(): string[] {
  const { startHour, endHour, stepMinutes } = config.slots;
  const times: string[] = [];
  for (let m = startHour * 60; m < endHour * 60; m += stepMinutes) {
    times.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return times;
}

export function addMinutes(at: Date, minutes: number) {
  return new Date(at.getTime() + minutes * MINUTE);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayLabel(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return { weekday: WEEKDAYS[t.getUTCDay()], day: d, month: MONTHS[m - 1] };
}
