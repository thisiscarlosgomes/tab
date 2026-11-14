import { Temporal } from "@js-temporal/polyfill";
import { fail } from "../model";
import { z } from "zod";
import { slotInput } from "./model";
export function resolveSlot(slot: z.infer<typeof slotInput>, timeZone: string) {
  try {
    // Require a named zone; an offset alone cannot preserve local scheduling rules.
    new Intl.DateTimeFormat("en", { timeZone }).format();
    const start = Temporal.PlainDateTime.from(slot.localStart).toZonedDateTime(
      timeZone,
      { disambiguation: "reject" },
    );
    const end = Temporal.PlainDateTime.from(slot.localEnd).toZonedDateTime(
      timeZone,
      { disambiguation: "reject" },
    );
    if (Temporal.ZonedDateTime.compare(end, start) <= 0)
      fail(400, "End must be after start");
    return {
      ...slot,
      startAt: start.toInstant().toString(),
      endAt: end.toInstant().toString(),
    };
  } catch {
    return fail(
      400,
      "Choose valid start/end times and a named time zone. Ambiguous or skipped daylight-saving times need another time.",
    );
  }
}
function escapeIcs(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
function stamp(value: string) {
  return new Date(value)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}
// RFC 5545 lines are folded at 75 octets, without splitting UTF-8 characters.
function fold(line: string) {
  const lines: string[] = [];
  let part = "";
  let bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75) {
      lines.push(part);
      part = " ";
      bytes = 1;
    }
    part += char;
    bytes += size;
  }
  lines.push(part);
  return lines.join("\r\n");
}
export function calendarFile(plan: import("./model").PlanView) {
  if (!plan.terms || !["confirmed", "completed"].includes(plan.state))
    fail(409, "Finalize the plan before exporting");
  return (
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Tab//Plans//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${plan.id}@tab`,
      `SEQUENCE:${plan.termsVersion}`,
      `DTSTAMP:${stamp(plan.updatedAt)}`,
      `DTSTART:${stamp(plan.terms.startAt)}`,
      `DTEND:${stamp(plan.terms.endAt)}`,
      `SUMMARY:${escapeIcs(plan.title)}`,
      `LOCATION:${escapeIcs(plan.terms.location)}`,
      "DESCRIPTION:Group plan only. Venue reservation is not verified. Check Tab for updates.",
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .map(fold)
      .join("\r\n") + "\r\n"
  );
}
