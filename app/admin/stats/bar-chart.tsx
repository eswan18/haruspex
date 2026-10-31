/**
 * A row of bars over a UTC time axis, styled by `statsCss` (.bars, .stack,
 * .bar, .n, .lbl). No hooks, so both the server-rendered sheet and the
 * client-side active-users switch can use it.
 */
export function BarChart({
  points,
  label,
  liveLast = false,
  showValues = true,
  labelEvery = 1,
}: {
  points: { start: Date; count: number }[];
  label: (d: Date) => string;
  /** Ink the last bar red: its period is not over. */
  liveLast?: boolean;
  /** Print each count above its bar; too crowded past a dozen or so bars. */
  showValues?: boolean;
  /** Label every nth bar, counted back from the last, which is always labelled. */
  labelEvery?: number;
}) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const last = points.length - 1;
  const grid = {
    gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`,
    gap: points.length > 20 ? "0.1875rem" : "0.375rem",
  };
  return (
    <>
      <div
        className="bars plot"
        style={grid}
        role="img"
        aria-label={points.map((p) => `${label(p.start)}: ${p.count}`).join(", ")}
      >
        {points.map((p, i) => (
          <div
            className="stack"
            key={p.start.toISOString()}
            title={`${label(p.start)}: ${p.count}`}
            aria-hidden="true"
          >
            {showValues && <span className="n">{p.count}</span>}
            <div
              className={liveLast && i === last ? "bar live" : "bar"}
              style={{ height: `${(p.count / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div
        className={labelEvery > 1 ? "bars axis sparse" : "bars axis"}
        style={grid}
        aria-hidden="true"
      >
        {points.map((p, i) => (
          <span className="lbl" key={p.start.toISOString()}>
            {(last - i) % labelEvery === 0 ? label(p.start) : ""}
          </span>
        ))}
      </div>
    </>
  );
}
