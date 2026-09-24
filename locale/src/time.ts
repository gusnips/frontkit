/**
 * What day it is in a zone, when that day starts, and arithmetic on dates that have no time.
 *
 * Every product here bills, caps or reports by DAY, and a day only exists in a zone. The fleet this
 * came from had 25 copies of "what day is it" in 10 repos, 22 of them derived independently, and
 * the bugs are all one mistake made in different places: a day read in the wrong zone. An invoice
 * shown overdue from noon on its due day, because the check compared an instant anchored at noon
 * with now. A compliance report printing every deadline a day early, because a date input was
 * stored as UTC midnight and printed in São Paulo. "Active today" reading 0 every evening from
 * 21:00, because one side wrote the São Paulo day and the other asked for the UTC one.
 *
 * So the zone is always an ARGUMENT, never a default and never the process's. Which zone decides a
 * period is a product decision — the billing zone, the customer's, UTC, or Pacific for a quota a
 * Google API resets at its own midnight — and nothing here guesses it. The host's zone is never
 * read: no box in the fleet pinned `TZ`, so reading it means the answer depends on a machine.
 *
 * Intl only, no dependency. `Temporal` is undefined on node 22, node 26 and bun 1.3 (measured
 * 2026-09-23), and a date library would put a dependency under a package servers, browsers and
 * Workers all import.
 *
 * Two rules the functions below keep, which the copies each got half of:
 * - **A date with no time is a day key, `"YYYY-MM-DD"`, and it is compared as a day key.** "Is it
 *   overdue" is `dayKey(now, zone) > dueDay`, never `new Date(due) < now`: a date parsed to an
 *   instant has to be pinned to SOME hour, and every hour anyone picks is wrong for part of the day.
 * - **A day's start is computed, not assumed to be midnight.** Some zones skip midnight on the day
 *   their clocks go forward (São Paulo did until 2019; Santiago and Havana still do), so the day
 *   starts at 01:00. A two-pass offset guess — the most-copied technique here — lands an hour
 *   early on exactly those days (measured).
 */

/** A calendar date with no time and no zone: `"2026-09-23"`. What a Postgres `date` holds. */
export type DayKey = string;
/** A calendar month: `"2026-09"`. */
export type MonthKey = string;

/** Bare UTC offsets like `-03:00`, `+0530` or `+5`. Intl accepts them; this module does not. */
const UTC_OFFSET = /^[+-]\d{1,2}(:?\d{2})?$/;

/**
 * An IANA zone the runtime can render, in the runtime's spelling — or null.
 *
 * Validated by BUILDING a formatter, not by looking the name up in
 * `Intl.supportedValuesOf("timeZone")`: that list has 418 entries on node and 445 on bun
 * (measured 2026-09-23), so a list-based check accepts a zone on one side of the wire and refuses it on the
 * other. What this answers is the only question that matters — can a time be rendered in it.
 *
 * It normalizes CASE (`america/sao_paulo` → `America/Sao_Paulo`). It does not reliably fold
 * aliases: node turns `Brazil/East` into `America/Sao_Paulo` and bun keeps it as written. Both
 * spellings render the same times, so the cost is two stored spellings of one zone, not a wrong
 * time.
 *
 * A bare offset is refused even though Intl accepts it. `-03:00` is a fixed shift with no rules,
 * so someone who stored one drifts an hour off for half of every year the moment their region
 * changes its clocks — the exact failure a zone preference exists to prevent. Zones only.
 */
export function canonicalTimeZone(raw: string): string | null {
  if (UTC_OFFSET.test(raw.trim())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date in `YYYY-MM-DD` form, or null: `2026-02-30` and `2026-9-1` are refused.
 *  This is the check for an untrusted value; every other function here throws on a malformed key,
 *  because by then it is a bug, not input. */
export function parseDayKey(raw: string): DayKey | null {
  const match = DAY_KEY.exec(raw);
  if (match === null) return null;
  const [, year, month, day] = match;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return new Date(ms).toISOString().slice(0, 10) === raw ? raw : null;
}

function dayMs(day: DayKey): number {
  if (parseDayKey(day) === null) throw new RangeError(`Not a day key: ${JSON.stringify(day)}`);
  return Date.parse(`${day}T00:00:00Z`);
}

function keyOfUtcMs(ms: number): DayKey {
  return new Date(ms).toISOString().slice(0, 10);
}

/** A zone's wall clock at one instant. */
export interface WallClock {
  day: DayKey;
  hour: number;
  minute: number;
  second: number;
  /** 0 is Sunday, as `Date.prototype.getDay`. */
  weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * One formatter per zone. Building an `Intl.DateTimeFormat` costs 14 to 700 times what formatting
 * with one does (measured on node and bun), and a period or a schedule asks for dozens.
 *
 * `hourCycle: "h23"`, never `hour12: false`: the second renders midnight as `24` on some ICU
 * builds. Neither runtime the fleet runs does it today (measured), and `h23` costs nothing.
 *
 * ponytail: the cache is never evicted. It holds one entry per zone actually asked about, which is
 * a few hundred at the very most; a service taking arbitrary zones from the public would want an
 * LRU here.
 */
const wallFormats = new Map<string, Intl.DateTimeFormat>();

function wallFormat(timeZone: string): Intl.DateTimeFormat {
  let format = wallFormats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    wallFormats.set(timeZone, format);
  }
  return format;
}

/** The zone's wall clock at an instant, read back as if it were UTC — so `wall - instant` is the
 *  zone's offset, and `new Date(wall)` has the zone's date and time in its UTC fields. */
function wallAsUtc(at: Date | number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of wallFormat(timeZone).formatToParts(at)) parts[part.type] = Number(part.value);
  const wall = new Date(0);
  wall.setUTCFullYear(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1);
  wall.setUTCHours(parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0, 0);
  return wall.getTime();
}

/** The zone's wall clock at an instant. Throws a `RangeError` for a zone the runtime does not
 *  know — validate stored zones with {@link canonicalTimeZone} where they come in. */
export function wallClock(at: Date | number, timeZone: string): WallClock {
  const wall = new Date(wallAsUtc(at, timeZone));
  return {
    day: keyOfUtcMs(wall.getTime()),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
    second: wall.getUTCSeconds(),
    weekday: wall.getUTCDay() as WallClock["weekday"],
  };
}

/** The calendar day an instant falls on in a zone. */
export function dayKey(at: Date | number, timeZone: string): DayKey {
  return wallClock(at, timeZone).day;
}

/** The zone's offset from UTC at an instant, in milliseconds (São Paulo: −3 h). */
function offsetAt(ms: number, timeZone: string): number {
  // The parts carry whole seconds, so compare against the instant floored to one; otherwise the
  // milliseconds leak into the offset.
  const floored = Math.floor(ms / 1000) * 1000;
  return wallAsUtc(floored, timeZone) - floored;
}

const TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;
const DAY = 86_400_000;

/**
 * The instant a wall time names in a zone: `zonedInstant("2026-09-23", "09:00", "America/Sao_Paulo")`
 * is 12:00 UTC.
 *
 * Where the clocks jump, it answers the way Temporal's `"compatible"` does, which is the one policy
 * a person would pick by hand:
 * - a time the clocks SKIPPED (the spring gap) moves forward by the gap: 02:30 on New York's
 *   spring-forward day is 03:30;
 * - a time that happens TWICE (the autumn overlap) is the first one.
 *
 * How: the offsets a day before and a day after bracket any single transition near the answer, and
 * each gives one candidate. A candidate is right if the zone reads it back as the wall time asked
 * for; both right is an overlap, neither is a gap. Copies that probed the offset twice from one
 * guess were an hour early in a gap west of UTC (measured).
 *
 * ponytail: assumes at most one transition within a day either side, which every zone in current
 * tzdata keeps. A zone that changed its clocks twice in 48 hours would need a scan instead.
 */
export function zonedInstant(day: DayKey, time: string, timeZone: string): Date {
  const clock = TIME.exec(time);
  if (clock === null) throw new RangeError(`Not a wall time: ${JSON.stringify(time)}`);
  const [, hour, minute, second] = clock;
  const wall =
    dayMs(day) + (Number(hour) * 3600 + Number(minute) * 60 + Number(second ?? 0)) * 1000;

  const before = wall - offsetAt(wall - DAY, timeZone);
  const after = wall - offsetAt(wall + DAY, timeZone);
  const fits = (candidate: number): boolean => candidate + offsetAt(candidate, timeZone) === wall;
  const beforeFits = fits(before);
  const afterFits = fits(after);

  if (beforeFits && afterFits) return new Date(Math.min(before, after));
  if (beforeFits) return new Date(before);
  if (afterFits) return new Date(after);
  // A gap: the offset from before the jump, applied to a time after it, lands past the gap.
  return new Date(Math.max(before, after));
}

/** When a day begins in a zone. Usually midnight; 01:00 on a day whose midnight was skipped. */
export function startOfDay(day: DayKey, timeZone: string): Date {
  return zonedInstant(day, "00:00", timeZone);
}

/** A day key `n` days later (or earlier, for a negative `n`). Steps the DATE, never 24 hours:
 *  a day across a clock change is 23 or 25 hours long. */
export function addDays(day: DayKey, n: number): DayKey {
  return keyOfUtcMs(dayMs(day) + n * DAY);
}

/**
 * A day key `n` months later, clamped to the end of a shorter month: Jan 31 + 1 is Feb 28 (29 in a
 * leap year), and Feb 29 + 12 is Feb 28. `Date.prototype.setMonth` overflows instead — Jan 31 + 1
 * becomes Mar 3 — which is how a monthly renewal once fell due in the wrong month.
 */
export function addMonths(day: DayKey, n: number): DayKey {
  dayMs(day);
  const [year, month, date] = day.split("-").map(Number);
  const index = (year ?? 0) * 12 + (month ?? 1) - 1 + n;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return keyOfUtcMs(Date.UTC(targetYear, targetMonth, Math.min(date ?? 1, lastDay)));
}

/** Whole days from `from` to `to`: `daysBetween("2026-09-23", "2026-09-30")` is 7. Negative when
 *  `to` is earlier. */
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((dayMs(to) - dayMs(from)) / DAY);
}

/** The month a day key is in. */
export function monthKey(day: DayKey): MonthKey {
  dayMs(day);
  return day.slice(0, 7);
}

/** The day and month an instant falls in, in one zone, with the instants they start and end. */
export interface Period {
  day: DayKey;
  month: MonthKey;
  dayStartsAt: Date;
  /** When a daily cap clears. */
  nextDayAt: Date;
  monthStartsAt: Date;
  /** When a monthly quota rolls over. */
  nextMonthAt: Date;
}

/**
 * The daily and monthly periods an instant falls in. A counter keys on `day` or `month`; a refusal
 * states `nextDayAt` or `nextMonthAt` as the moment it clears. Both come from one zone, so the key
 * the database stores and the time the client is told can never disagree.
 */
export function periodAt(at: Date | number, timeZone: string): Period {
  const day = dayKey(at, timeZone);
  const month = monthKey(day);
  const firstOfMonth = `${month}-01`;
  return {
    day,
    month,
    dayStartsAt: startOfDay(day, timeZone),
    nextDayAt: startOfDay(addDays(day, 1), timeZone),
    monthStartsAt: startOfDay(firstOfMonth, timeZone),
    nextMonthAt: startOfDay(addMonths(firstOfMonth, 1), timeZone),
  };
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * A day key for a reader: `formatDayKey("2026-09-23", "pt-BR")` is `23/09/2026` on every machine.
 *
 * Rendered in UTC on purpose, because the key has no zone to render in. The obvious version,
 * `new Date("2026-09-23").toLocaleDateString()`, parses the key as UTC midnight and then shows it
 * in the viewer's zone — the day before, for everyone west of UTC. Four repos re-derived this fix
 * after shipping that bug; one had it right in one file and wrong two files away.
 */
export function formatDayKey(
  day: DayKey,
  locale: string,
  options: Omit<Intl.DateTimeFormatOptions, "timeZone"> = {},
): string {
  const cacheKey = `${locale}|${JSON.stringify(options)}`;
  let format = dayFormats.get(cacheKey);
  if (format === undefined) {
    format = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    dayFormats.set(cacheKey, format);
  }
  return format.format(dayMs(day));
}
