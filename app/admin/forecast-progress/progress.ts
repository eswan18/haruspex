/**
 * One forecaster's progress through a competition: props forecast, out of
 * those that want a forecast. `unforecasted` already leaves voided props out
 * (getUnforecastedProps), so forecasts on voided props are left out here too.
 */
export function userProgress({
  forecasts,
  unforecasted,
}: {
  forecasts: { resolution_voided: boolean | null }[];
  unforecasted: number;
}): { forecasted: number; unforecasted: number; percentComplete: number } {
  const forecasted = forecasts.filter(
    (f) => f.resolution_voided !== true,
  ).length;
  const total = forecasted + unforecasted;
  return {
    forecasted,
    unforecasted,
    percentComplete: total > 0 ? forecasted / total : 0,
  };
}
