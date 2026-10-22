import { test } from "node:test";
import assert from "node:assert/strict";
import { currentShiftWindow } from "../src/services/shift-changes.js";

test("plant change windows follow Istanbul boundaries, including midnight and the next date", () => {
  for (const [instant, date, start, end, since] of [
    ["2026-10-21T20:59:59.999Z", "2026-10-21", "16:00", "00:00", "2026-10-21T13:00:00.000Z"],
    ["2026-10-21T21:00:00.000Z", "2026-10-22", "00:00", "08:00", "2026-10-21T21:00:00.000Z"],
    ["2026-10-22T04:59:59.999Z", "2026-10-22", "00:00", "08:00", "2026-10-21T21:00:00.000Z"],
    ["2026-10-22T05:00:00.000Z", "2026-10-22", "08:00", "16:00", "2026-10-22T05:00:00.000Z"],
    ["2026-10-22T13:00:00.000Z", "2026-10-22", "16:00", "00:00", "2026-10-22T13:00:00.000Z"],
    ["2026-12-31T21:00:00.000Z", "2027-01-01", "00:00", "08:00", "2026-12-31T21:00:00.000Z"]
  ]) {
    const window = currentShiftWindow(new Date(instant!));
    assert.equal(window.shiftDate, date); assert.equal(window.scheduledStart, start); assert.equal(window.scheduledEnd, end);
    assert.equal(window.start.toISOString(), since); assert.equal(window.end.getTime() - window.start.getTime(), 8 * 3600_000);
  }
});
