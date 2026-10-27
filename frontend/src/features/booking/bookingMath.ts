import { formatVenueDateTime } from "../../components/format";
import type { AvailableCourt, Promotion, ScheduleClosure } from "../venues/venueApi";

export function promoDiscount(price: number, promo: Promotion | null) {
  if (!promo) return 0;
  const amount = promo.discountType === "percent" ? Math.round(price * promo.discountValue) / 100 : promo.discountValue;
  return Math.min(price, Math.max(0, amount));
}

export function pointsQuote(requested: number, balance: number, rate: number, price: number) {
  const safeRate = rate < 1 ? 100 : rate;
  const points = Math.min(Math.max(0, Math.floor(requested)), Math.max(balance, 0), price <= 0 ? 0 : Math.floor(price * safeRate));
  const value = Math.floor((points * 100) / safeRate) / 100;
  const cash = Math.round((price - (value <= 0 ? 0 : value)) * 100) / 100;
  return { points: value <= 0 ? 0 : points, value: value <= 0 ? 0 : value, cash };
}

export function venueInstant(date: string, time: string, timeZone: string) {
  if (!date || !time) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) return null;
  let utc = Date.UTC(year, month - 1, day, hour, minute);
  const target = utc;
  for (let pass = 0; pass < 3; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "Australia/Melbourne",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(utc));
    const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const shown = Date.UTC(pick("year"), pick("month") - 1, pick("day"), pick("hour") % 24, pick("minute"));
    utc += target - shown;
  }
  return utc;
}

export function startsWithin24Hours(date: string, time: string, timeZone: string) {
  const utc = venueInstant(date, time, timeZone);
  if (utc === null) return false;
  const untilStart = utc - Date.now();
  return untilStart > 0 && untilStart <= 24 * 60 * 60 * 1000;
}

function overlaps(start: number, end: number, otherStart: string, otherEnd: string) {
  const from = new Date(otherStart).getTime();
  const to = new Date(otherEnd).getTime();
  return Number.isFinite(from) && Number.isFinite(to) && start < to && end > from;
}

export function unavailableReason(courts: AvailableCourt[], closures: ScheduleClosure[], courtIds: string[], date: string, start: string, end: string, timeZone: string) {
  const startMs = venueInstant(date, start, timeZone);
  const endMs = venueInstant(date, end, timeZone);
  if (startMs === null || endMs === null) return null;
  if (endMs <= startMs) return "The end time needs to be later than the start time.";
  if (endMs - startMs < 30 * 60 * 1000) return "Choose at least 30 minutes between the start and the end.";
  if (startMs <= Date.now()) return "That time has already started. Choose a later time.";
  const chosen = courts.filter((court) => courtIds.includes(court.id));
  const booked = chosen.flatMap((court) => court.bookings.filter((booking) => overlaps(startMs, endMs, booking.startTime, booking.endTime)).map((booking) => ({ court, booking })));
  if (booked.length > 0) {
    const first = booked[0];
    const from = formatVenueDateTime(first.booking.startTime, timeZone);
    const to = formatVenueDateTime(first.booking.endTime, timeZone);
    const extra = booked.length > 1 ? ` ${booked.length - 1} other selected ${booked.length === 2 ? "court is" : "courts are"} busy then too.` : "";
    if (first.booking.status === "pending") {
      return `${first.court.courtName} is already in a booking from ${from} to ${to}, and the payment is not finished.${extra} Complete the payment or delete it in My bookings.`;
    }
    return `${first.court.courtName} is already booked from ${from} to ${to}.${extra} Choose another time or another court.`;
  }
  const closed = closures.find((closure) => (closure.courtId === null || courtIds.includes(closure.courtId)) && overlaps(startMs, endMs, closure.startTime, closure.endTime));
  if (closed) {
    const name = closed.courtId ? chosen.find((court) => court.id === closed.courtId)?.courtName ?? "That court" : "This venue";
    return `${name} is closed from ${formatVenueDateTime(closed.startTime, timeZone)} to ${formatVenueDateTime(closed.endTime, timeZone)}. Choose another time.`;
  }
  return null;
}

export function courtBusyLabel(court: AvailableCourt, closures: ScheduleClosure[], date: string, start: string, end: string, timeZone: string) {
  const startMs = venueInstant(date, start, timeZone);
  const endMs = venueInstant(date, end, timeZone);
  if (startMs === null || endMs === null || endMs <= startMs) return null;
  const booking = court.bookings.find((item) => overlaps(startMs, endMs, item.startTime, item.endTime));
  if (booking) return booking.status === "pending" ? "Held" : "Booked";
  const closed = closures.some((closure) => (closure.courtId === null || closure.courtId === court.id) && overlaps(startMs, endMs, closure.startTime, closure.endTime));
  return closed ? "Closed" : null;
}

export function shownHoldError(message: string | undefined) {
  if (!message || message === "The request could not be completed.") {
    return "That date and time is not available for the courts you chose. It may already be booked or closed. Choose another time.";
  }
  return message;
}

export function sessionAmount(start: string, end: string, rate: number) {
  if (!start || !end || rate <= 0) return null;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const minutes = endHour * 60 + endMinute - (startHour * 60 + startMinute);
  if (!Number.isFinite(minutes) || minutes < 30) return null;
  return Math.round((rate * minutes) / 60 * 100) / 100;
}
