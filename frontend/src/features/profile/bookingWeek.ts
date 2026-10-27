import { formatVenueDateTime } from "../../components/format";
import type { CourtWeekCourt } from "./profileApi";

export const holdFilters = [
  { id: "all", label: "All" },
  { id: "pay", label: "Need payment" },
  { id: "repeat", label: "Repeating" },
] as const;

export type HoldFilter = (typeof holdFilters)[number]["id"];

export function formatWeekDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: timeZone || "Australia/Melbourne",
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function weekOfYear(value: string, timeZone: string) {
  const zone = timeZone || "Australia/Melbourne";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
  const calendar = new Date(Date.UTC(Number(part("year")), Number(part("month")) - 1, Number(part("day"))));
  const isoDay = weekday === 0 ? 7 : weekday;
  const thursday = new Date(calendar);
  thursday.setUTCDate(calendar.getUTCDate() + 4 - isoDay);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  const monday = new Date(calendar);
  monday.setUTCDate(calendar.getUTCDate() - (isoDay - 1));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  const day = new Intl.DateTimeFormat("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return { week, year: thursday.getUTCFullYear(), from: day.format(monday), to: day.format(sunday) };
}

export function seriesNeedsPayment(weeks: CourtWeekCourt[][]) {
  return weeks.some((week) => week.some((court) => court.status === "pending"));
}

export function visibleSeries(weeks: CourtWeekCourt[][], filter: HoldFilter) {
  const groups = new Map<string, CourtWeekCourt[][]>();
  for (const week of weeks) {
    const id = week[0].groupId;
    groups.set(id, [...(groups.get(id) ?? []), week]);
  }
  return [...groups.values()].filter((group) => {
    if (filter === "pay") return seriesNeedsPayment(group);
    if (filter === "repeat") return group.some((week) => week[0].repeatHold);
    return true;
  });
}

export function weekSpan(weeks: CourtWeekCourt[][]) {
  const first = weekOfYear(weeks[0][0].startTime, weeks[0][0].timeZone);
  const last = weekOfYear(weeks[weeks.length - 1][0].startTime, weeks[weeks.length - 1][0].timeZone);
  if (weeks.length === 1 || (first.week === last.week && first.year === last.year)) {
    return `Week ${first.week} of ${first.year}`;
  }
  if (first.year === last.year) {
    return `Weeks ${first.week}–${last.week} of ${first.year}`;
  }
  return `Weeks ${first.week} of ${first.year} to ${last.week} of ${last.year}`;
}


export function sameSlot(left: CourtWeekCourt, right: CourtWeekCourt) {
  return Math.abs(new Date(left.startTime).getTime() - new Date(right.startTime).getTime()) < 2000
    && Math.abs(new Date(left.endTime).getTime() - new Date(right.endTime).getTime()) < 2000;
}

export function timeGroups(courts: CourtWeekCourt[]) {
  const groups: CourtWeekCourt[][] = [];
  for (const court of [...courts].sort((left, right) => left.startTime < right.startTime ? -1 : left.startTime > right.startTime ? 1 : left.courtNumber - right.courtNumber)) {
    const group = groups.find((item) => sameSlot(item[0], court));
    if (group) group.push(court);
    else groups.push([court]);
  }
  return groups;
}

export function leadCourt(courts: CourtWeekCourt[]) {
  const pending = courts.filter((court) => court.status === "pending");
  const pool = pending.length > 0 ? pending : courts;
  return [...pool].sort((left, right) => left.startTime < right.startTime ? -1 : 1)[0];
}

export function weekPayNote(courts: CourtWeekCourt[]) {
  if (courts.every((court) => court.status === "confirmed")) return null;
  const lead = leadCourt(courts);
  const due = new Date(new Date(lead.startTime).getTime() - 24 * 60 * 60 * 1000);
  return due.getTime() <= Date.now() ? "Pay now to keep this week." : `Pay before ${formatVenueDateTime(due.toISOString(), lead.timeZone)}.`;
}

export function topUpSource(reason?: string | null) {
  if (!reason?.startsWith("week-topup|")) return null;
  const time = Date.parse(reason.slice("week-topup|".length).split("|")[0]);
  return Number.isNaN(time) ? null : time;
}


