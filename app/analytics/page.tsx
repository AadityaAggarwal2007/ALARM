"use client";

import { useCallback, useEffect, useState } from "react";
import { dateKey, fmtDuration } from "@/lib/time";
import type { Analytics } from "@/lib/types";

const PRESETS = [
  ["WEEK", "Week"],
  ["MONTH", "Month"],
  ["HALF_YEAR", "6 mo"],
  ["YEAR", "Year"],
] as const;

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function AnalyticsPage() {
  const [preset, setPreset] = useState<string>("WEEK");
  const [data, setData] = useState<Analytics | null>(null);
  const [detail, setDetail] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(
      `/api/analytics?preset=${preset}&anchor=${dateKey()}`
    );
    if (res.ok) setData(await res.json());
  }, [preset]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) {
    return (
      <main className="shell">
        <h1>Analytics</h1>
        <p className="note">Loading…</p>
      </main>
    );
  }

  const { summary, categories, load: dayLoad, metrics, discipline } = data;
  const maxLoad = Math.max(1, ...dayLoad.map((d) => d.ms));
  const maxHeat = Math.max(1, ...data.heatmap.flat());
  const maxCreate = Math.max(1, ...data.creation.map((c) => c.count));
  const maxDist = Math.max(1, ...data.distribution.map((d) => d.count));
  const planTotal =
    Object.values(data.planSource).reduce((a, b) => a + b, 0) || 1;

  return (
    <main className="shell">
      <header className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="sub">
            {data.range.from} → {data.range.to}
          </p>
        </div>
        <a className="icon-btn" href="/settings" aria-label="Settings">
          ⚙
        </a>
      </header>

      <div className="segmented">
        {PRESETS.map(([key, label]) => (
          <button
            key={key}
            aria-pressed={preset === key}
            onClick={() => setPreset(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* --- Discipline: what the integration makes measurable --- */}
      <section>
        <h2 className="sec-title">Discipline</h2>
        {discipline.enforcedCount === 0 ? (
          <div className="card">
            <p className="note">
              No enforced blocks in this period. Switch on Enforce for a block
              and this fills in: whether you started on time, and how hard you
              fought it.
            </p>
          </div>
        ) : (
          <>
            <div className="stat-grid">
              <Stat
                label="Kept"
                value={`${Math.round(discipline.honourRate * 100)}%`}
                note={`${discipline.solvedCount} of ${discipline.enforcedCount}`}
              />
              <Stat
                label="Avg late"
                value={fmtDuration(discipline.avgLatenessMs)}
              />
              <Stat
                label="Worst"
                value={fmtDuration(discipline.worstLatenessMs)}
              />
              <Stat
                label="Ignored"
                value={String(discipline.gaveUpCount)}
                note="rang out"
              />
            </div>
            <div className="card">
              <p className="note">On-time record</p>
              <div className="streak">
                {discipline.byDay.map((d) => (
                  <span
                    key={d.date}
                    className={`streak-cell ${
                      d.total === 0
                        ? "none"
                        : d.onTime === d.total
                          ? "all"
                          : d.onTime > 0
                            ? "some"
                            : "miss"
                    }`}
                    title={`${d.date}: ${d.onTime}/${d.total} on time`}
                  />
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      {/* --- 1. Summary --- */}
      <section>
        <h2 className="sec-title">Summary</h2>
        <div className="stat-grid">
          <Stat label="Scheduled" value={fmtDuration(summary.totalMs)} />
          <Stat label="Blocks" value={String(summary.totalTasks)} />
          <Stat label="Completed" value={String(summary.completed)} />
          <Stat
            label="Completion"
            value={`${Math.round(summary.completionRate * 100)}%`}
          />
        </div>
      </section>

      {/* --- 2. Categories --- */}
      <section>
        <h2 className="sec-title">Categories</h2>
        {categories.length === 0 && <p className="note">No data.</p>}
        {categories.map((c) => (
          <div key={c.id}>
            <button
              className="cat-row"
              onClick={() => setDetail(detail === c.id ? null : c.id)}
            >
              <span className="cat-icon">{c.icon}</span>
              <span className="cat-name">{c.label}</span>
              <span className="cat-bar">
                <span
                  style={{
                    width: `${Math.round(c.share * 100)}%`,
                    background: c.color,
                  }}
                />
              </span>
              <span className="cat-val">{fmtDuration(c.ms)}</span>
            </button>
            {detail === c.id && (
              <CategoryDetail categoryId={c.id} preset={preset} />
            )}
          </div>
        ))}
      </section>

      {/* --- 3. Load --- */}
      <section>
        <h2 className="sec-title">Load</h2>
        <div className="bars">
          {dayLoad.map((d) => (
            <span
              key={d.date}
              className="bar-col"
              title={`${d.date}: ${fmtDuration(d.ms)}`}
            >
              <span
                style={{ height: `${Math.round((d.ms / maxLoad) * 100)}%` }}
              />
            </span>
          ))}
        </div>
      </section>

      {/* --- 4. Creation pattern --- */}
      <section>
        <h2 className="sec-title">When you plan</h2>
        <div className="bars">
          {data.creation.map((c) => (
            <span
              key={c.hour}
              className="bar-col"
              title={`${c.hour}:00 — ${c.count} created`}
            >
              <span
                style={{ height: `${Math.round((c.count / maxCreate) * 100)}%` }}
              />
            </span>
          ))}
        </div>
        <p className="note">Hour of day a block was created.</p>
      </section>

      {/* --- 5. Duration distribution --- */}
      <section>
        <h2 className="sec-title">Block lengths</h2>
        <div className="bars labelled">
          {data.distribution.map((d) => (
            <span key={d.label} className="bar-col" title={`${d.count}`}>
              <span
                style={{ height: `${Math.round((d.count / maxDist) * 100)}%` }}
              />
              <em>{d.label}</em>
            </span>
          ))}
        </div>
      </section>

      {/* --- 6. Plan source --- */}
      <section>
        <h2 className="sec-title">Where blocks come from</h2>
        <div className="card">
          {Object.entries(data.planSource).map(([key, count]) => (
            <div key={key} className="src-row">
              <span className="src-label">
                {key === "MANUAL"
                  ? "Planned by hand"
                  : key === "TEMPLATE"
                    ? "From a repeat"
                    : "From the inbox"}
              </span>
              <span className="cat-bar">
                <span
                  style={{
                    width: `${Math.round((count / planTotal) * 100)}%`,
                    background: "var(--accent)",
                  }}
                />
              </span>
              <span className="cat-val">{count}</span>
            </div>
          ))}
        </div>
      </section>

      {/* --- 7. Key metrics --- */}
      <section>
        <h2 className="sec-title">Key metrics</h2>
        <div className="stat-grid">
          <Stat
            label="Blocks/day"
            value={metrics.avgTasksPerDay.toFixed(1)}
          />
          <Stat label="Hours/day" value={fmtDuration(metrics.avgMsPerDay)} />
          <Stat label="Busiest" value={metrics.busiestDay || "—"} />
          <Stat label="Longest" value={fmtDuration(metrics.longestMs)} />
          <Stat label="Top" value={metrics.topCategory || "—"} />
          <Stat label="Active days" value={String(metrics.activeDays)} />
        </div>
      </section>

      {/* --- 8. Regularity --- */}
      <section>
        <h2 className="sec-title">Regularity</h2>
        <div className="heat-strip">
          {dayLoad.map((d) => (
            <span
              key={d.date}
              className="heat-cell"
              title={`${d.date}: ${fmtDuration(d.ms)}`}
              style={{
                opacity: d.ms === 0 ? 0.08 : 0.25 + (d.ms / maxLoad) * 0.75,
              }}
            />
          ))}
        </div>
      </section>

      {/* --- 9. Weekday x hour --- */}
      <section>
        <h2 className="sec-title">Weekly shape</h2>
        <div className="heatmap">
          <div className="hm-corner" />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="hm-hour">
              {h % 6 === 0 ? h : ""}
            </div>
          ))}
          {data.heatmap.map((row, i) => (
            <Row key={i} label={DOW[i]} row={row} max={maxHeat} />
          ))}
        </div>
      </section>
    </main>
  );
}

function Row({
  label,
  row,
  max,
}: {
  label: string;
  row: number[];
  max: number;
}) {
  return (
    <>
      <div className="hm-dow">{label}</div>
      {row.map((v, h) => (
        <div
          key={h}
          className="hm-cell"
          title={`${label} ${h}:00 — ${v}`}
          style={{ opacity: v === 0 ? 0.06 : 0.2 + (v / max) * 0.8 }}
        />
      ))}
    </>
  );
}

function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

function CategoryDetail({
  categoryId,
  preset,
}: {
  categoryId: number;
  preset: string;
}) {
  const [d, setD] = useState<{
    totalMs: number;
    count: number;
    completed: number;
    avgMs: number;
    subCategories: { name: string; ms: number; count: number }[];
    dayParts: Record<string, number>;
  } | null>(null);

  useEffect(() => {
    fetch(
      `/api/analytics?preset=${preset}&anchor=${dateKey()}&categoryId=${categoryId}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then(setD);
  }, [categoryId, preset]);

  if (!d) return <p className="note">Loading…</p>;

  const partTotal =
    Object.values(d.dayParts).reduce((a, b) => a + b, 0) || 1;

  return (
    <div className="card sub-detail">
      <div className="stat-grid">
        <Stat label="Total" value={fmtDuration(d.totalMs)} />
        <Stat label="Blocks" value={String(d.count)} />
        <Stat label="Average" value={fmtDuration(d.avgMs)} />
        <Stat label="Done" value={String(d.completed)} />
      </div>

      {d.subCategories.length > 0 && (
        <>
          <p className="note">Subcategories</p>
          {d.subCategories.map((s) => (
            <div key={s.name} className="src-row">
              <span className="src-label">{s.name}</span>
              <span className="cat-val">{fmtDuration(s.ms)}</span>
            </div>
          ))}
        </>
      )}

      <p className="note">Time of day</p>
      {Object.entries(d.dayParts).map(([part, ms]) => (
        <div key={part} className="src-row">
          <span className="src-label">{part}</span>
          <span className="cat-bar">
            <span
              style={{
                width: `${Math.round((ms / partTotal) * 100)}%`,
                background: "var(--accent)",
              }}
            />
          </span>
          <span className="cat-val">{fmtDuration(ms)}</span>
        </div>
      ))}
    </div>
  );
}
