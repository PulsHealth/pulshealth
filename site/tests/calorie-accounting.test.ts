import { test } from "node:test";
import assert from "node:assert/strict";
import { calorieBreakdown, initialCalories } from "../src/lib/calorie-accounting";

test("moving energy into the workout share never adds it to the daily total", () => {
  for (const workout of [0, 350, 700]) {
    const result = calorieBreakdown({ resting: 1800, active: 700, workout });
    assert.equal(result.total, 2500);
    assert.equal(result.otherActive + result.workout, 700);
  }
});

test("lowering active energy below a workout caps its share without negative other energy", () => {
  const result = calorieBreakdown({ ...initialCalories, active: 100 });
  assert.equal(result.workout, 100);
  assert.equal(result.otherActive, 0);
  assert.equal(result.total, 1900);
});

test("zero and invalid inputs cannot create negative or nonfinite chart segments", () => {
  for (const input of [
    { resting: 0, active: 0, workout: 400 },
    { resting: -1, active: -1, workout: -1 },
    { resting: NaN, active: Infinity, workout: -Infinity },
  ]) {
    const result = calorieBreakdown(input);
    assert.deepEqual(result, { resting: 0, active: 0, workout: 0, otherActive: 0, total: 0 });
  }
});
