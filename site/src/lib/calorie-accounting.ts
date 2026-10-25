export type CalorieInputs = {
  resting: number;
  active: number;
  workout: number;
};

export const initialCalories: CalorieInputs = {
  resting: 1800,
  active: 700,
  workout: 400,
};

/** A teaching model: workout active energy is contained in daily active energy. */
export function calorieBreakdown(inputs: CalorieInputs) {
  const finite = (value: number) => Number.isFinite(value) ? value : 0;
  const resting = Math.max(0, finite(inputs.resting));
  const active = Math.max(0, finite(inputs.active));
  const workout = Math.min(active, Math.max(0, finite(inputs.workout)));
  return {
    resting,
    active,
    workout,
    otherActive: active - workout,
    total: resting + active,
  };
}
