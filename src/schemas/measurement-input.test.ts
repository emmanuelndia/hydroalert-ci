import assert from "node:assert/strict";
import { test } from "node:test";
import { measurementInputSchema } from "./measurement-input.js";

const valid = { sensorCode: "CAP-COC-01", measuredAt: "2026-11-26T10:00:00Z", waterLevelCm: 42.5 };

test("a valid measurement is parsed and its date converted", () => {
  const parsed = measurementInputSchema.parse({ ...valid, batteryPct: 80 });
  assert.equal(parsed.sensorCode, "CAP-COC-01");
  assert.ok(parsed.measuredAt instanceof Date);
  assert.equal(parsed.measuredAt.toISOString(), "2026-11-26T10:00:00.000Z");
});

test("a measurement needs at least one measured value", () => {
  const { waterLevelCm: _, ...withoutValue } = valid;
  assert.equal(measurementInputSchema.safeParse({ ...withoutValue, batteryPct: 80 }).success, false);
});

test("physical limits and formats are enforced", () => {
  const invalid = [
    { ...valid, waterLevelCm: -1 },
    { ...valid, waterLevelCm: 1001 },
    { ...valid, rainMm: 501 },
    { ...valid, batteryPct: 101 },
    { ...valid, batteryPct: 50.5 },
    { ...valid, measuredAt: "2026-11-26 10:00" },
    { ...valid, measuredAt: "2026-11-26T10:00:00" },
    { ...valid, sensorCode: "" },
    { ...valid, waterLevelCm: "42" },
  ];
  for (const input of invalid) {
    assert.equal(measurementInputSchema.safeParse(input).success, false, JSON.stringify(input));
  }
});
