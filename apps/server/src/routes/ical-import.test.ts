import { describe, it, expect } from "vite-plus/test";
import { parseIcalEvents, expandEventDates } from "./jumpdays.ts";

describe("parseIcalEvents", () => {
  it("parses a single all-day event", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260412
DTEND;VALUE=DATE:20260415
SUMMARY:Jump Weekend
END:VEVENT
END:VCALENDAR`;

    const events = parseIcalEvents(ical);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      dtstart: "2026-04-12",
      dtend: "2026-04-15",
      summary: "Jump Weekend",
    });
  });

  it("parses datetime DTSTART (strips time portion)", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART:20260315T100000Z
DTEND:20260315T180000Z
SUMMARY:Morning session
END:VEVENT
END:VCALENDAR`;

    const events = parseIcalEvents(ical);
    expect(events).toHaveLength(1);
    expect(events[0]!.dtstart).toBe("2026-03-15");
  });

  it("parses multiple events", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260501
DTEND;VALUE=DATE:20260504
SUMMARY:Event A
END:VEVENT
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260510
DTEND;VALUE=DATE:20260512
SUMMARY:Event B
END:VEVENT
END:VCALENDAR`;

    const events = parseIcalEvents(ical);
    expect(events).toHaveLength(2);
    expect(events[0]!.summary).toBe("Event A");
    expect(events[1]!.summary).toBe("Event B");
  });

  it("handles folded lines (RFC 5545 continuation)", () => {
    const ical =
      "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20260601\r\nDTEND;VALUE=DATE:20260602\r\nSUMMARY:Long\r\n  summary text\r\nEND:VEVENT\r\nEND:VCALENDAR";

    const events = parseIcalEvents(ical);
    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toBe("Long summary text");
  });

  it("handles event without DTEND", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260601
SUMMARY:Single day
END:VEVENT
END:VCALENDAR`;

    const events = parseIcalEvents(ical);
    expect(events).toHaveLength(1);
    expect(events[0]!.dtend).toBeNull();
  });

  it("handles event without SUMMARY", () => {
    const ical = `BEGIN:VCALENDAR
BEGIN:VEVENT
DTSTART;VALUE=DATE:20260601
DTEND;VALUE=DATE:20260602
END:VEVENT
END:VCALENDAR`;

    const events = parseIcalEvents(ical);
    expect(events).toHaveLength(1);
    expect(events[0]!.summary).toBeNull();
  });
});

describe("expandEventDates", () => {
  it("expands a multi-day event into individual dates", () => {
    const dates = expandEventDates([
      { dtstart: "2026-04-03", dtend: "2026-04-07", summary: "Weekend" },
    ]);
    expect(dates).toEqual([
      { date: "2026-04-03", summary: "Weekend" },
      { date: "2026-04-04", summary: "Weekend" },
      { date: "2026-04-05", summary: "Weekend" },
      { date: "2026-04-06", summary: "Weekend" },
    ]);
  });

  it("handles single-day event (no dtend)", () => {
    const dates = expandEventDates([{ dtstart: "2026-06-15", dtend: null, summary: "One day" }]);
    expect(dates).toEqual([{ date: "2026-06-15", summary: "One day" }]);
  });

  it("handles single-day event (dtend equals dtstart)", () => {
    const dates = expandEventDates([
      { dtstart: "2026-06-15", dtend: "2026-06-15", summary: "Same day" },
    ]);
    expect(dates).toEqual([{ date: "2026-06-15", summary: "Same day" }]);
  });

  it("expands a long event (10 days)", () => {
    const dates = expandEventDates([
      { dtstart: "2026-07-31", dtend: "2026-08-10", summary: "Summer camp" },
    ]);
    expect(dates).toHaveLength(10);
    expect(dates[0]!.date).toBe("2026-07-31");
    expect(dates[9]!.date).toBe("2026-08-09");
  });

  it("deduplicates overlapping events", () => {
    const dates = expandEventDates([
      { dtstart: "2026-04-03", dtend: "2026-04-06", summary: "Event A" },
      { dtstart: "2026-04-05", dtend: "2026-04-08", summary: "Event B" },
    ]);
    const allDates = dates.map((d) => d.date);
    expect(allDates).toEqual([
      "2026-04-03",
      "2026-04-04",
      "2026-04-05",
      "2026-04-06",
      "2026-04-07",
    ]);
    // First occurrence wins
    expect(dates.find((d) => d.date === "2026-04-05")!.summary).toBe("Event A");
  });

  it("handles month boundary correctly", () => {
    const dates = expandEventDates([
      { dtstart: "2026-03-30", dtend: "2026-04-02", summary: "Cross month" },
    ]);
    expect(dates.map((d) => d.date)).toEqual(["2026-03-30", "2026-03-31", "2026-04-01"]);
  });

  it("handles year boundary correctly", () => {
    const dates = expandEventDates([
      { dtstart: "2025-12-30", dtend: "2026-01-02", summary: "New Year" },
    ]);
    expect(dates.map((d) => d.date)).toEqual(["2025-12-30", "2025-12-31", "2026-01-01"]);
  });

  it("preserves correct dates regardless of server timezone", () => {
    // This is the key test - dates must not shift due to timezone
    const dates = expandEventDates([
      { dtstart: "2026-04-10", dtend: "2026-04-13", summary: "Test" },
    ]);
    expect(dates.map((d) => d.date)).toEqual(["2026-04-10", "2026-04-11", "2026-04-12"]);
  });
});
