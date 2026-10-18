import { test } from "node:test";
import assert from "node:assert/strict";
import { shiftSchedule } from "../src/services/schedule.js";
test("default schedule uses Istanbul boundaries and a shift-start date", () => {
  assert.deepEqual(shiftSchedule({}, new Date("2026-10-18T21:00:00Z")), { shiftDate: "2026-10-19", scheduledStart: "00:00", scheduledEnd: "08:00" });
  assert.equal(shiftSchedule({}, new Date("2026-10-19T05:00:00Z")).scheduledStart, "08:00");
  assert.deepEqual(shiftSchedule({}, new Date("2026-10-19T13:00:00Z")), { shiftDate: "2026-10-19", scheduledStart: "16:00", scheduledEnd: "00:00" });
});
test("explicit overnight schedule is retained and invalid/partial schedules fail", () => {
  assert.equal(shiftSchedule({ shiftDate: "2026-10-19", scheduledStart: "16:00", scheduledEnd: "00:00" }).scheduledEnd, "00:00");
  for (const input of [{ shiftDate: "2026-02-30", scheduledStart: "08:00", scheduledEnd: "16:00" },
    { shiftDate: "2026-10-19" }, { shiftDate: "2026-10-19", scheduledStart: "24:00", scheduledEnd: "08:00" },
    { shiftDate: "2026-10-19", scheduledStart: "08:00", scheduledEnd: "08:00" }]) assert.throws(() => shiftSchedule(input));
});
