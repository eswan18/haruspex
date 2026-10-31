/**
 * A row of bars over a UTC time axis, styled by `statsCss` (.bars, .stack,
 * .bar, .n, .lbl). No hooks, so both the server-rendered sheet and the
 * client-side active-users switch can use it.
 *
 * Given `onSelect`, each bar is a button that reports itself on hover, focus
 * or tap, so a chart too dense to print its counts can still be read on a
 * phone, where there is no hover. The caller shows the selected bar's count.
 */
export function BarChart({
  points,
  label,
  liveLast = false,
  showValues = true,
  labelEvery = 1,
  selected,
  onSelect,
}: {
  points: { start: Date; count: number }[];
  label: (d: Date) => string;
  /** Ink the last bar red: its period is not over. */
  liveLast?: boolean;
  /** Print each count above its bar; too crowded past a dozen or so bars. */
  showValues?: boolean;
  /** Label every nth bar, counted back from the last, which is always labelled. */
  labelEvery?: number;
  /** Index of the bar to mark as selected, with `onSelect`. */
  selected?: number;
  onSelect?: (index: number) => void;
}) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const last = points.length - 1;
  const grid = {
    gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`,
    gap: points.length > 20 ? "0.1875rem" : "0.375rem",
  };

  const bar = (p: { start: Date; count: number }, i: number) => (
    <>
      {showValues && <span className="n">{p.count}</span>}
      <div
        className={liveLast && i === last ? "bar live" : "bar"}
        style={{ height: `${(p.count / max) * 100}%` }}
      />
    </>
  );

  return (
    <>
      {onSelect ? (
        <div className="bars plot" style={grid} role="group" aria-label="Bars">
          {points.map((p, i) => (
            <button
              type="button"
              className="stack pick"
              key={p.start.toISOString()}
              aria-pressed={i === selected}
              aria-label={`${label(p.start)}: ${p.count}`}
              onMouseEnter={() => onSelect(i)}
              onFocus={() => onSelect(i)}
              onClick={() => onSelect(i)}
            >
              {bar(p, i)}
            </button>
          ))}
        </div>
      ) : (
        <div
          className="bars plot"
          style={grid}
          role="img"
          aria-label={points.map((p) => `${label(p.start)}: ${p.count}`).join(", ")}
        >
          {points.map((p, i) => (
            <div className="stack" key={p.start.toISOString()} aria-hidden="true">
              {bar(p, i)}
            </div>
          ))}
        </div>
      )}
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
