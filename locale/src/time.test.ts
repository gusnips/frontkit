import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  canonicalTimeZone,
  dayKey,
  daysBetween,
  formatDayKey,
  monthKey,
  parseDayKey,
  periodAt,
  startOfDay,
  wallClock,
  zonedInstant,
} from "./time.ts";

const SP = "America/Sao_Paulo";
const NY = "America/New_York";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// Zones with every kind of clock change: spring and autumn on both hemispheres, a skipped midnight
// (Havana, Santiago), a half-hour shift (Lord Howe), and three with none this year — a half-hour
// offset (Kolkata), and two that stopped changing (São Paulo in 2019, Apia in 2021).
const ZONES = [
  SP,
  NY,
  "Europe/Madrid",
  "America/Havana",
  "America/Santiago",
  "Australia/Lord_Howe",
  "Pacific/Apia",
  "Asia/Kolkata",
  "UTC",
];

const walls = new Map<string, Intl.DateTimeFormat>();

/** The zone's wall clock at an instant, read by a formatter this module does not build, as UTC ms.
 *  Swedish writes a date as `2026-09-23 09:00:00`, which is one character away from ISO. */
function wallOf(ms: number, timeZone: string): number {
  let format = walls.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    walls.set(timeZone, format);
  }
  return Date.parse(`${format.format(ms).replace(" ", "T")}Z`);
}

/**
 * What `zonedInstant` must answer, found by walking every minute of the 30 hours either side of
 * the wall time. No offsets, no brackets: the instants that read as the wall time, and if there are
 * none, the jump the wall time fell into.
 */
function scanned(day: string, time: string, timeZone: string): number {
  const wall = Date.parse(`${day}T${time}:00Z`);
  let previous = wallOf(wall - 15 * HOUR - MINUTE, timeZone);
  for (let at = wall - 15 * HOUR; at <= wall + 15 * HOUR; at += MINUTE) {
    const now = wallOf(at, timeZone);
    // The earliest instant that reads as the wall time: an overlap's first pass.
    if (now === wall) return at;
    // The clocks jumped over it: the wall time plus the length of the jump.
    if (previous < wall && now > wall && now - previous > MINUTE)
      return at + (wall - previous - MINUTE);
    previous = now;
  }
  throw new Error(`no answer for ${day} ${time} in ${timeZone}`);
}

/** Every day in a year on which a zone's offset changes, found by comparing noons. */
function changeDays(year: number, timeZone: string): string[] {
  const days: string[] = [];
  let day = `${year}-01-01`;
  let offset = wallOf(Date.parse(`${day}T12:00:00Z`), timeZone) - Date.parse(`${day}T12:00:00Z`);
  while (day.startsWith(String(year))) {
    const next = addDays(day, 1);
    const noon = Date.parse(`${next}T12:00:00Z`);
    const nextOffset = wallOf(noon, timeZone) - noon;
    if (nextOffset !== offset) days.push(day, next);
    offset = nextOffset;
    day = next;
  }
  return days;
}

describe("the runner", () => {
  // `formatDayKey`'s bug only shows west of UTC: a key parsed as UTC midnight and shown in the
  // runner's zone is the day before there, and the right day on a machine at UTC. The package's
  // test script pins São Paulo; this refuses to pass a suite that could not have failed.
  it("is not at UTC, so a day read in the wrong zone would show", () => {
    expect(new Date(0).getTimezoneOffset(), "run through `bun run test`, which sets TZ").not.toBe(
      0,
    );
  });
});

describe("canonicalTimeZone", () => {
  it("answers the runtime's spelling of a zone it can render", () => {
    expect(canonicalTimeZone(SP)).toBe(SP);
    expect(canonicalTimeZone("america/sao_paulo")).toBe(SP);
    expect(canonicalTimeZone("UTC")).toBe("UTC");
  });

  it("refuses a name nothing can render", () => {
    expect(canonicalTimeZone("Mars/Olympus_Mons")).toBeNull();
    expect(canonicalTimeZone("")).toBeNull();
  });

  it("refuses a bare offset, which Intl would take", () => {
    // A fixed shift has no rules, so whoever stored it is an hour off for half of every year the
    // day their region changes its clocks.
    for (const offset of ["-03:00", "+0530", "+5", " -03:00 "]) {
      expect(canonicalTimeZone(offset), offset).toBeNull();
    }
  });
});

describe("parseDayKey", () => {
  it("takes a real date in YYYY-MM-DD form and refuses the rest", () => {
    expect(parseDayKey("2026-09-23")).toBe("2026-09-23");
    expect(parseDayKey("2024-02-29")).toBe("2024-02-29");
    expect(parseDayKey("2026-02-29")).toBeNull();
    expect(parseDayKey("2026-02-30")).toBeNull();
    expect(parseDayKey("2026-9-1")).toBeNull();
    expect(parseDayKey("2026-09-23T00:00:00Z")).toBeNull();
    expect(parseDayKey("")).toBeNull();
  });

  it("is the check the other functions run, and they throw where it refuses", () => {
    expect(() => addDays("2026-02-30", 1)).toThrow(RangeError);
    expect(() => addMonths("2026-13-01", 1)).toThrow(RangeError);
    expect(() => monthKey("2026-09")).toThrow(RangeError);
    expect(() => startOfDay("tomorrow", SP)).toThrow(RangeError);
  });
});

describe("dayKey and wallClock", () => {
  it("reads the day in the zone asked for, not in UTC and not in the runner's", () => {
    // 02:30 UTC on the 24th is still the 23rd in São Paulo: the "active today reads 0 from 21:00"
    // bug is this, read the other way.
    const lateEvening = Date.parse("2026-09-24T02:30:00Z");
    expect(dayKey(lateEvening, SP)).toBe("2026-09-23");
    expect(dayKey(lateEvening, "UTC")).toBe("2026-09-24");
    expect(dayKey(lateEvening, "Asia/Tokyo")).toBe("2026-09-24");
  });

  it("gives midnight as hour 0 and the weekday of the zone's day", () => {
    expect(wallClock(Date.parse("2026-09-23T03:00:00Z"), SP)).toEqual({
      day: "2026-09-23",
      hour: 0,
      minute: 0,
      second: 0,
      weekday: 3,
    });
    // Sunday in São Paulo while it is already Monday in UTC.
    expect(wallClock(new Date("2026-09-28T01:15:30.999Z"), SP)).toEqual({
      day: "2026-09-27",
      hour: 22,
      minute: 15,
      second: 30,
      weekday: 0,
    });
  });

  it("throws for a zone the runtime does not know", () => {
    expect(() => dayKey(0, "Mars/Olympus_Mons")).toThrow(RangeError);
  });
});

describe("zonedInstant", () => {
  it("names the instant a wall time is in a zone", () => {
    expect(zonedInstant("2026-09-23", "09:00", SP).toISOString()).toBe("2026-09-23T12:00:00.000Z");
    expect(zonedInstant("2026-09-23", "23:59:59", SP).toISOString()).toBe(
      "2026-09-24T02:59:59.000Z",
    );
    expect(zonedInstant("2026-09-23", "05:30", "Asia/Kolkata").toISOString()).toBe(
      "2026-09-23T00:00:00.000Z",
    );
  });

  it("moves a skipped time forward by the gap", () => {
    // 02:30 never happens on these days; Temporal's "compatible" reads it as 03:30.
    expect(zonedInstant("2026-03-08", "02:30", NY).toISOString()).toBe("2026-03-08T07:30:00.000Z");
    expect(zonedInstant("2026-03-29", "02:30", "Europe/Madrid").toISOString()).toBe(
      "2026-03-29T01:30:00.000Z",
    );
  });

  it("takes the first of a time that happens twice", () => {
    expect(zonedInstant("2026-11-01", "01:30", NY).toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(zonedInstant("2026-10-25", "02:30", "Europe/Madrid").toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });

  it("refuses a time it cannot read", () => {
    expect(() => zonedInstant("2026-09-23", "9:00", SP)).toThrow(RangeError);
    expect(() => zonedInstant("2026-09-23", "09:00 PM", SP)).toThrow(RangeError);
  });

  // The cases above are ones somebody thought of. This one asks the clock itself: every day on
  // which a zone changes its offset, at the hours a change happens, against a minute-by-minute
  // walk that knows nothing about offsets.
  it("agrees with a minute-by-minute walk on every clock change in 2026", () => {
    let checked = 0;
    for (const zone of ZONES) {
      for (const day of changeDays(2026, zone)) {
        for (const time of [
          "00:00",
          "00:30",
          "01:00",
          "01:30",
          "02:00",
          "02:30",
          "03:00",
          "12:00",
        ]) {
          const expected = new Date(scanned(day, time, zone)).toISOString();
          expect(zonedInstant(day, time, zone).toISOString(), `${day} ${time} ${zone}`).toBe(
            expected,
          );
          checked++;
        }
      }
    }
    // Five of the nine zones change their clocks in 2026, twice each, and each change is two days.
    // A walk that found no change days would pass by checking nothing.
    expect(checked).toBe(5 * 2 * 2 * 8);
  });
});

describe("startOfDay", () => {
  it("is midnight on an ordinary day", () => {
    expect(startOfDay("2026-09-23", SP).toISOString()).toBe("2026-09-23T03:00:00.000Z");
  });

  it("is 01:00 on a day whose midnight was skipped", () => {
    // São Paulo's last spring-forward, Havana's and Santiago's this year. A two-pass offset guess
    // answers 23:00 of the day before for each of these.
    expect(startOfDay("2018-11-04", SP).toISOString()).toBe("2018-11-04T03:00:00.000Z");
    expect(startOfDay("2026-03-08", "America/Havana").toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
    expect(startOfDay("2026-09-06", "America/Santiago").toISOString()).toBe(
      "2026-09-06T04:00:00.000Z",
    );
  });

  it("lands on the next day for a date the zone never had", () => {
    // Apia crossed the date line in 2011 and skipped the 30th whole, which is a 24-hour gap.
    expect(startOfDay("2011-12-30", "Pacific/Apia").toISOString()).toBe("2011-12-30T10:00:00.000Z");
    expect(dayKey(startOfDay("2011-12-30", "Pacific/Apia"), "Pacific/Apia")).toBe("2011-12-31");
  });

  it("is the first instant of the day, and the one before it is the day before", () => {
    for (const zone of ZONES) {
      for (const day of [...changeDays(2026, zone), "2026-01-01", "2026-06-30"]) {
        const start = startOfDay(day, zone).getTime();
        expect(dayKey(start, zone), `${day} ${zone}`).toBe(day);
        expect(dayKey(start - 1, zone), `${day} ${zone}`).toBe(addDays(day, -1));
      }
    }
  });
});

describe("day arithmetic", () => {
  it("steps the date, not 24 hours", () => {
    expect(addDays("2026-09-23", 1)).toBe("2026-09-24");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-12-31", 1)).toBe("2025-01-01");
    // New York's 23-hour day: a day key has no hours, so nothing to lose.
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("clamps a month step to the end of a shorter month", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
    expect(addMonths("2024-02-29", 12)).toBe("2025-02-28");
    expect(addMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonths("2026-05-31", 13)).toBe("2027-06-30");
  });

  it("counts whole days across a clock change", () => {
    expect(daysBetween("2026-09-23", "2026-09-30")).toBe(7);
    expect(daysBetween("2026-09-30", "2026-09-23")).toBe(-7);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2024-01-01", "2025-01-01")).toBe(366);
  });

  it("compares as text, so overdue is a string comparison", () => {
    // The invoice bug: due on the 23rd, shown overdue from noon on the 23rd. Day keys sort as
    // dates, so the check is one comparison with no hour in it.
    const dueDay = "2026-09-23";
    expect(dayKey(Date.parse("2026-09-23T15:00:00Z"), SP) > dueDay).toBe(false);
    expect(dayKey(Date.parse("2026-09-24T02:59:59Z"), SP) > dueDay).toBe(false);
    expect(dayKey(Date.parse("2026-09-24T03:00:00Z"), SP) > dueDay).toBe(true);
    expect(monthKey(dueDay)).toBe("2026-09");
  });
});

describe("periodAt", () => {
  it("keys the day and month in the zone, with the instants they clear", () => {
    // 01:00 UTC on October 1st is still September 30th in São Paulo.
    expect(periodAt(Date.parse("2026-10-01T01:00:00Z"), SP)).toEqual({
      day: "2026-09-30",
      month: "2026-09",
      dayStartsAt: new Date("2026-09-30T03:00:00Z"),
      nextDayAt: new Date("2026-10-01T03:00:00Z"),
      monthStartsAt: new Date("2026-09-01T03:00:00Z"),
      nextMonthAt: new Date("2026-10-01T03:00:00Z"),
    });
  });

  it("rolls the year over", () => {
    const period = periodAt(Date.parse("2026-12-31T12:00:00Z"), "UTC");
    expect(period.nextDayAt).toEqual(new Date("2027-01-01T00:00:00Z"));
    expect(period.nextMonthAt).toEqual(new Date("2027-01-01T00:00:00Z"));
  });
});

describe("formatDayKey", () => {
  it("prints the day the key names, on a runner west of UTC", () => {
    expect(formatDayKey("2026-09-23", "pt-BR")).toBe("23/09/2026");
    expect(formatDayKey("2026-09-23", "en-US")).toBe("9/23/2026");
    expect(formatDayKey("2026-01-01", "pt-BR", { dateStyle: "long" })).toBe("1 de janeiro de 2026");
    // What it replaces, which this runner shows a day early.
    expect(new Date("2026-09-23").toLocaleDateString("pt-BR")).toBe("22/09/2026");
  });
});
