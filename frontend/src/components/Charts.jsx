// Small hand-rolled charts for the dashboard (no chart library: a bar list and a
// 12-point line chart are a few lines of CSS and SVG). Colours come from the --chart-*
// tokens in styles.css, which have their own dark-mode values. Every chart also shows
// its numbers as text or in a table, so nothing depends on seeing colour.

import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { CATEGORY_LABELS, shortDate } from "../labels.js";

/**
 * Issues by category (from GET /dashboard/stats `byCategory`): one row per category
 * that has issues, the full bar = all issues, the dark part = still active. Each row
 * links to the inbox filtered to that category.
 */
export function CategoryBars({ byCategory }) {
  const rows = byCategory.filter((c) => c.total > 0).sort((a, b) => b.total - a.total || b.active - a.active);
  if (!rows.length) return <p className="muted small">No issues yet, so nothing to break down.</p>;
  const max = Math.max(...rows.map((r) => r.total));
  const empty = byCategory.length - rows.length;
  return (
    <>
      <div className="chart-legend" aria-hidden="true">
        <span className="chart-legend__item">
          <span className="chart-swatch chart-swatch--active" /> Active
        </span>
        <span className="chart-legend__item">
          <span className="chart-swatch chart-swatch--total" /> All time
        </span>
      </div>
      <ul className="bars" aria-label="Issues by category">
        {rows.map((r) => (
          <li key={r.category}>
            <Link to={`/issues?status=&category=${r.category}`} className="bars__row" title={`${CATEGORY_LABELS[r.category]}: ${r.active} active, ${r.total} in total`}>
              <span className="bars__label">{CATEGORY_LABELS[r.category]}</span>
              <span className="bars__track" aria-hidden="true">
                <span className="bars__bar bars__bar--total" style={{ width: `${(r.total / max) * 100}%` }} />
                {r.active > 0 && <span className="bars__bar bars__bar--active" style={{ width: `${(r.active / max) * 100}%` }} />}
              </span>
              <span className="bars__value">
                <strong>{r.active}</strong>
                <span className="muted"> / {r.total}</span>
                <span className="visually-hidden"> active of {r.total} in total</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {empty > 0 && (
        <p className="muted small">
          {empty} other categor{empty === 1 ? "y has" : "ies have"} no issues.
        </p>
      )}
    </>
  );
}

// Round the y-axis top up to a friendly number (1, 2, 5, 10, 20, 50…).
function niceMax(n) {
  if (n <= 4) return Math.max(n, 1);
  const pow = 10 ** Math.floor(Math.log10(n));
  return [1, 2, 5, 10].map((m) => m * pow).find((m) => m >= n);
}

const W = 340;
const H = 150;
const PAD = { top: 12, right: 12, bottom: 22, left: 28 };

/**
 * Issues reported vs closed per week over the last 12 weeks (`weekly`, oldest first).
 * Hover or focus (Tab / arrow keys) a week to read its exact numbers.
 */
export function WeeklyTrend({ weekly }) {
  const titleId = useId();
  const [active, setActive] = useState(null);
  const max = niceMax(Math.max(...weekly.map((w) => Math.max(w.reported, w.closed)), 0));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (weekly.length === 1 ? innerW / 2 : (i * innerW) / (weekly.length - 1));
  const y = (v) => PAD.top + innerH - (v / max) * innerH;
  const line = (key) => weekly.map((w, i) => `${x(i)},${y(w[key])}`).join(" ");
  const totals = weekly.reduce((t, w) => ({ reported: t.reported + w.reported, closed: t.closed + w.closed }), { reported: 0, closed: 0 });
  const colW = innerW / Math.max(weekly.length - 1, 1);
  const current = active === null ? null : weekly[active];

  function onKeyDown(e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = Math.min(weekly.length - 1, Math.max(0, (active ?? weekly.length - 1) + (e.key === "ArrowRight" ? 1 : -1)));
    setActive(next);
  }

  return (
    <div className="trend">
      <div className="chart-legend">
        <span className="chart-legend__item">
          <span className="chart-swatch chart-swatch--reported" aria-hidden="true" /> Reported <strong>{totals.reported}</strong>
        </span>
        <span className="chart-legend__item">
          <span className="chart-swatch chart-swatch--closed" aria-hidden="true" /> Closed <strong>{totals.closed}</strong>
        </span>
      </div>
      <p className="trend__readout small" aria-live="polite">
        {current ? (
          <>
            Week of {shortDate(current.weekStart)}: <strong>{current.reported}</strong> reported, <strong>{current.closed}</strong> closed
          </>
        ) : (
          <span className="muted">Hover or focus the chart to see each week.</span>
        )}
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="trend__svg"
        role="group"
        aria-labelledby={titleId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => active === null && setActive(weekly.length - 1)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
      >
        <title id={titleId}>Issues reported and closed per week, last 12 weeks. Use the arrow keys to move between weeks.</title>
        {[0, max / 2, max].map((v) => (
          <g key={v} className="trend__grid">
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} />
            <text x={PAD.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
              {Number.isInteger(v) ? v : ""}
            </text>
          </g>
        ))}
        {[0, Math.floor((weekly.length - 1) / 2), weekly.length - 1].map((i) => (
          <text key={i} className="trend__axis" x={x(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === weekly.length - 1 ? "end" : "middle"}>
            {shortDate(weekly[i].weekStart)}
          </text>
        ))}
        {active !== null && <line className="trend__crosshair" x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + innerH} />}
        <polyline className="trend__line trend__line--reported" points={line("reported")} />
        <polyline className="trend__line trend__line--closed" points={line("closed")} />
        {weekly.map((w, i) => (
          <g key={w.weekStart}>
            <circle className="trend__dot trend__dot--reported" cx={x(i)} cy={y(w.reported)} r={active === i ? 5 : 3.5} />
            <circle className="trend__dot trend__dot--closed" cx={x(i)} cy={y(w.closed)} r={active === i ? 5 : 3.5} />
            {/* An invisible column per week: a hover target much bigger than the dots. */}
            <rect
              className="trend__hit"
              x={x(i) - colW / 2}
              y={PAD.top}
              width={colW}
              height={innerH}
              onMouseEnter={() => setActive(i)}
            >
              <title>{`Week of ${shortDate(w.weekStart)}: ${w.reported} reported, ${w.closed} closed`}</title>
            </rect>
          </g>
        ))}
      </svg>
      <details className="trend__table">
        <summary className="small">Show the numbers</summary>
        <table className="data-table small">
          <thead>
            <tr>
              <th scope="col">Week of</th>
              <th scope="col">Reported</th>
              <th scope="col">Closed</th>
            </tr>
          </thead>
          <tbody>
            {weekly.map((w) => (
              <tr key={w.weekStart}>
                <th scope="row">{shortDate(w.weekStart)}</th>
                <td>{w.reported}</td>
                <td>{w.closed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
