import { isBinaryForecast } from "@/lib/binary-forecast";
import type {
  PropOptionSummary,
  PropWithUserForecast,
  VForecast,
  VProp,
} from "@/types/db_types";

/** One forecaster's mark on the prop's scale. Binary props only. */
export interface FieldEntry {
  forecastId: number;
  userId: number;
  userName: string;
  /** 0–1. */
  forecast: number;
  isYou: boolean;
}

/** What the sheet prints about the field as a whole. */
export interface FieldSummary {
  count: number;
  /** Null when nobody has forecasted. */
  average: number | null;
  low: number | null;
  high: number | null;
}

/**
 * Everyone's forecast on one prop, highest first.
 *
 * Choice forecasts carry no single probability, so they cannot be placed on
 * the scale and are dropped; a choice prop reads its options table instead.
 */
export function buildField(
  forecasts: VForecast[],
  currentUserId: number,
): FieldEntry[] {
  return forecasts
    .filter(isBinaryForecast)
    .map((f) => ({
      forecastId: f.forecast_id,
      userId: f.user_id,
      userName: f.user_name,
      forecast: f.forecast,
      isYou: f.user_id === currentUserId,
    }))
    .sort((a, b) => b.forecast - a.forecast);
}

export function summariseField(field: FieldEntry[]): FieldSummary {
  if (field.length === 0) {
    return { count: 0, average: null, low: null, high: null };
  }
  const values = field.map((f) => f.forecast);
  return {
    count: field.length,
    average: values.reduce((a, b) => a + b, 0) / values.length,
    // The field is sorted high to low, so the ends are the extremes.
    low: values[values.length - 1],
    high: values[0],
  };
}

/**
 * The shape both prop routes hand the sheet.
 *
 * The competition route gets these fields from `getPropsWithUserForecasts`,
 * but the standalone route has only the prop and the forecasts on it — so the
 * sheet takes one type and this fills it in from whichever the caller has.
 */
export function toPropWithUserForecast(
  prop: VProp & { options: PropOptionSummary[] },
  forecasts: VForecast[],
  currentUserId: number,
): PropWithUserForecast {
  const own = forecasts.find((f) => f.user_id === currentUserId) ?? null;
  const binary = forecasts.filter(isBinaryForecast);
  return {
    ...prop,
    user_forecast: own && own.forecast !== null ? own.forecast : null,
    user_forecast_id: own?.forecast_id ?? null,
    community_average:
      binary.length > 0
        ? binary.reduce((sum, f) => sum + f.forecast, 0) / binary.length
        : null,
  };
}

/**
 * The line under the scale once the reader can no longer forecast. A void can
 * close a prop before its deadline, so it gets its own words rather than the
 * deadline's. `miss` marks the reader who never forecast a prop that counts.
 */
export function closedNote(prop: {
  resolution_voided: boolean | null;
  user_forecast_id: number | null;
}): { text: string; miss: boolean } {
  if (prop.resolution_voided === true) {
    return {
      text:
        prop.user_forecast_id === null
          ? "This prop was voided, so it takes no forecasts."
          : "This prop was voided, so your forecast is not scored.",
      miss: false,
    };
  }
  return prop.user_forecast_id === null
    ? { text: "You did not forecast this one before the deadline.", miss: true }
    : {
        text: "Forecasting is closed. This is the forecast you submitted.",
        miss: false,
      };
}
