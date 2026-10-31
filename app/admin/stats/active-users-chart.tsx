"use client";

import { useState } from "react";

import type { AdminStats } from "@/lib/admin-stats";

import { BarChart } from "./bar-chart";

type View = "daily" | "weekly" | "monthly";

const dayFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const monthFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
});
const monthYearFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const VIEWS: Record<
  View,
  {
    name: string;
    span: string;
    caption: string;
    label: (d: Date) => string;
    /** The readout's fuller name for a period than the axis has room for. */
    readout: (d: Date) => string;
    showValues: boolean;
    labelEvery: number;
  }
> = {
  daily: {
    name: "Daily",
    span: "Last 30 days",
    caption: "People who used Haruspex while signed in that UTC day.",
    label: (d) => dayFmt.format(d),
    readout: (d) => dayFmt.format(d),
    showValues: false,
    labelEvery: 7,
  },
  weekly: {
    name: "Weekly",
    span: "Last 26 weeks",
    caption:
      "Distinct people active each week, Monday to Sunday, UTC. Someone in every day counts once.",
    label: (d) => dayFmt.format(d),
    readout: (d) => `Week of ${dayFmt.format(d)}`,
    showValues: false,
    labelEvery: 4,
  },
  monthly: {
    name: "Monthly",
    span: "Last 12 months",
    caption: "Distinct people active each calendar month, UTC.",
    label: (d) => monthFmt.format(d),
    readout: (d) => monthYearFmt.format(d),
    showValues: true,
    labelEvery: 1,
  },
};

/**
 * The active-users chart with its Daily / Weekly / Monthly switch. All three
 * series arrive from the server at once; switching only changes which one is
 * drawn. The switch is the shared .riso-seg bar.
 */
export function ActiveUsersChart({
  series,
}: {
  series: Pick<AdminStats["activeUsers"], "daily" | "weekly" | "monthly">;
}) {
  const [view, setView] = useState<View>("daily");
  const spec = VIEWS[view];
  const points = series[view];
  // Which bar the readout describes: the latest until one is pointed at, and
  // the latest again whenever the view changes.
  const [picked, setPicked] = useState<number | null>(null);
  const index = picked ?? points.length - 1;
  const point = points[index];

  return (
    <>
      <div className="chart-head">
        <div className="riso-seg" role="group" aria-label="Chart period">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <button
              type="button"
              key={v}
              aria-pressed={view === v}
              onClick={() => {
                setView(v);
                setPicked(null);
              }}
            >
              {VIEWS[v].name}
            </button>
          ))}
        </div>
        <span className="aside">{spec.span}</span>
      </div>
      {point && (
        <p className="readout" aria-live="polite">
          <span className="when">{spec.readout(point.start)}</span>
          <span className="count">
            {point.count.toLocaleString("en-US")}{" "}
            {point.count === 1 ? "person" : "people"}
          </span>
          {index === points.length - 1 && (
            <span className="when">so far</span>
          )}
        </p>
      )}
      <BarChart
        points={points}
        label={spec.label}
        liveLast
        showValues={spec.showValues}
        labelEvery={spec.labelEvery}
        selected={index}
        onSelect={setPicked}
      />
      <p className="caption">
        {spec.caption} Point at or tap a bar to read it above. An admin
        impersonating someone counts as themselves. The red bar is still
        counting. Recorded only from the day this shipped.
      </p>
    </>
  );
}
