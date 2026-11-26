import assert from "node:assert/strict";
import { test } from "node:test";
import { computeRuleScore } from "../services/risk-evaluation.js";
import { alertLevelFor, displayColor, levelRank, riskLevelFromScore } from "./risk.js";

test("riskLevelFromScore applies the PowerPoint thresholds at every boundary", () => {
  const cases: [number, string][] = [
    [0, "NORMAL"],
    [39, "NORMAL"],
    [40, "VIGILANCE"],
    [64, "VIGILANCE"],
    [65, "DANGER"],
    [84, "DANGER"],
    [85, "EVACUATION"],
    [100, "EVACUATION"],
  ];
  for (const [score, level] of cases) assert.equal(riskLevelFromScore(score), level, `score ${score}`);
});

test("riskLevelFromScore rejects scores outside 0-100 or non-integer", () => {
  for (const score of [-1, 101, 50.5, Number.NaN]) {
    assert.throws(() => riskLevelFromScore(score), RangeError, `score ${score}`);
  }
});

test("alertLevelFor ignores NORMAL and keeps the other levels", () => {
  assert.equal(alertLevelFor("NORMAL"), null);
  assert.equal(alertLevelFor("VIGILANCE"), "VIGILANCE");
  assert.equal(alertLevelFor("DANGER"), "DANGER");
  assert.equal(alertLevelFor("EVACUATION"), "EVACUATION");
});

test("levels are ordered and mapped to display colors", () => {
  assert.ok(levelRank("NORMAL") < levelRank("VIGILANCE"));
  assert.ok(levelRank("VIGILANCE") < levelRank("DANGER"));
  assert.ok(levelRank("DANGER") < levelRank("EVACUATION"));
  assert.deepEqual(
    (["NORMAL", "VIGILANCE", "DANGER", "EVACUATION"] as const).map(displayColor),
    ["vert", "orange", "rouge", "rouge"],
  );
});

test("computeRuleScore follows the provisional formula", () => {
  assert.equal(computeRuleScore({ maxWaterLevelCm: 50, rainLastHourMm: null }, 100), 50);
  assert.equal(computeRuleScore({ maxWaterLevelCm: 50, rainLastHourMm: 10 }, 100), 60);
  // Bonus de pluie plafonne a 15.
  assert.equal(computeRuleScore({ maxWaterLevelCm: 50, rainLastHourMm: 40 }, 100), 65);
  // Score plafonne a 100.
  assert.equal(computeRuleScore({ maxWaterLevelCm: 150, rainLastHourMm: 5 }, 100), 100);
  // Pluie seule.
  assert.equal(computeRuleScore({ maxWaterLevelCm: null, rainLastHourMm: 12 }, 100), 12);
  // Niveau critique configurable.
  assert.equal(computeRuleScore({ maxWaterLevelCm: 40, rainLastHourMm: null }, 80), 50);
});
