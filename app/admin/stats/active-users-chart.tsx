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

const VIEWS: Record<
  View,
  {
    name: string;
    span: string;
    caption: string;
    label: (d: Date) => string;
    showValues: boolean;
    labelEvery: number;
  }
> = {
  daily: {
    name: "Daily",
    span: "Last 30 days",
    caption: "People who used Haruspex while signed in that UTC day.",
    label: (d) => dayFmt.format(d),
    showValues: false,
    labelEvery: 7,
  },
  weekly: {
    name: "Weekly",
    span: "Last 26 weeks",
    caption:
      "Distinct people active each week, Monday to Sunday, UTC. Someone in every day counts once.",
    label: (d) => dayFmt.format(d),
    showValues: false,
    labelEvery: 4,
  },
  monthly: {
    name: "Monthly",
    span: "Last 12 months",
    caption: "Distinct people active each calendar month, UTC.",
    label: (d) => monthFmt.format(d),
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

  return (
    <>
      <div className="chart-head">
        <div className="riso-seg" role="group" aria-label="Chart period">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <button
              type="button"
              key={v}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {VIEWS[v].name}
            </button>
          ))}
        </div>
        <span className="aside">{spec.span}</span>
      </div>
      <BarChart
        points={series[view]}
        label={spec.label}
        liveLast
        showValues={spec.showValues}
        labelEvery={spec.labelEvery}
      />
      <p className="caption">
        {spec.caption} Hover a bar for its count. Impersonation is not counted.
        The red bar is still counting. Recorded only from the day this shipped.
      </p>
    </>
  );
}
