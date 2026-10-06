import { useEffect, useMemo, useRef, useState } from "react";
import type { RadioPoint, Session } from "@/lib/engine/types";
import { ChartLineIcon, TableIcon } from "@phosphor-icons/react";
import { MsgRef } from "./bits";
import { CardHead } from "./summary-view";
import { cn } from "@/lib/utils";

type Metric = "rsrp" | "rsrq" | "sinr";

const METRICS: Record<
  Metric,
  { title: string; unit: string; step: number; refs: { y: number; label: string }[]; quality: (v: number) => string }
> = {
  rsrp: {
    title: "Serving RSRP",
    unit: "dBm",
    step: 10,
    refs: [
      { y: -80, label: "Excellent above -80" },
      { y: -100, label: "Fair above -100" },
      { y: -110, label: "Cell edge -110" },
    ],
    quality: (v) => (v >= -80 ? "Excellent" : v >= -90 ? "Good" : v >= -100 ? "Fair" : v >= -110 ? "Poor" : "Very poor"),
  },
  rsrq: {
    title: "Serving RSRQ",
    unit: "dB",
    step: 5,
    refs: [
      { y: -10, label: "Good above -10" },
      { y: -15, label: "Poor below -15" },
    ],
    quality: (v) => (v >= -10 ? "Excellent" : v >= -15 ? "Good" : v >= -20 ? "Fair" : "Poor"),
  },
  sinr: {
    title: "Serving SINR",
    unit: "dB",
    step: 5,
    refs: [
      { y: 13, label: "Good above 13" },
      { y: 0, label: "Poor below 0" },
    ],
    quality: (v) => (v >= 20 ? "Excellent" : v >= 13 ? "Good" : v >= 0 ? "Fair" : "Poor"),
  },
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function MetricChart({ metric, points, onOpen }: { metric: Metric; points: RadioPoint[]; onOpen: (i: number) => void }) {
  const m = METRICS[metric];
  const data = points.filter((p) => typeof p[metric] === "number");
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const H = 176;
  const pad = { l: 46, r: 14, t: 14, b: 26 };
  const iw = width - pad.l - pad.r;
  const ih = H - pad.t - pad.b;

  const { lo, hi, ticks } = useMemo(() => {
    const vals = data.map((d) => d[metric] as number).concat(m.refs.map((r) => r.y));
    const lo = Math.floor((Math.min(...vals) - m.step / 2) / m.step) * m.step;
    let hi = Math.ceil((Math.max(...vals) + m.step / 2) / m.step) * m.step;
    if (hi - lo < m.step * 2) hi = lo + m.step * 2;
    const ticks: number[] = [];
    for (let v = lo; v <= hi; v += m.step) ticks.push(v);
    return { lo, hi, ticks };
  }, [data, metric, m]);

  if (!data.length) return null;
  const x = (k: number) => pad.l + (data.length === 1 ? iw / 2 : (k / (data.length - 1)) * iw);
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * ih;
  const path = data.map((d, k) => `${k ? "L" : "M"}${x(k).toFixed(1)},${y(d[metric] as number).toFixed(1)}`).join(" ");
  const h = hover != null ? data[hover] : null;
  const best = h?.neighbors.length ? [...h.neighbors].sort((a, b) => (b.rsrp ?? -999) - (a.rsrp ?? -999))[0] : null;
  const vals = data.map((d) => d[metric] as number);
  const last = vals[vals.length - 1];

  const pick = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left;
    let best = 0;
    let bd = Infinity;
    data.forEach((_, k) => {
      const d = Math.abs(x(k) - px);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    setHover(best);
  };

  return (
    <figure className="surface rounded-2xl px-[18px] py-4">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="flex items-center gap-2.5 text-[15.5px] font-bold text-foreground">
          <span className="grad grid size-[30px] place-items-center rounded-[9px] text-white">
            <ChartLineIcon weight="bold" className="size-[17px]" />
          </span>
          {m.title} <span className="font-medium text-muted-foreground">({m.unit})</span>
        </span>
        <span className="text-[12.5px] tabular-nums text-ink-2">
          min {Math.min(...vals)}, max {Math.max(...vals)}, last {last} {m.unit}
        </span>
      </figcaption>
      <div ref={wrapRef} className="relative mt-2">
        <svg
          width={width}
          height={H}
          role="img"
          aria-label={`${m.title} over ${data.length} measurement reports`}
          tabIndex={0}
          className="block touch-none outline-none focus-visible:ring-2 focus-visible:ring-[rgb(0_105_200/0.3)]"
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setHover(null)}
          onClick={() => h && onOpen(h.i)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") setHover((v) => Math.min(data.length - 1, (v ?? -1) + 1));
            if (e.key === "ArrowLeft") setHover((v) => Math.max(0, (v ?? 1) - 1));
            if (e.key === "Enter" && h) onOpen(h.i);
          }}
          onBlur={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--hairline)" strokeWidth={1} />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10.5px] tabular-nums">
                {t}
              </text>
            </g>
          ))}
          {m.refs.map((r) =>
            r.y > lo && r.y < hi ? (
              <g key={r.label}>
                <line x1={pad.l} x2={width - pad.r} y1={y(r.y)} y2={y(r.y)} stroke="var(--muted-foreground)" strokeOpacity={0.45} strokeWidth={1} />
                <text x={width - pad.r} y={y(r.y) - 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
                  {r.label}
                </text>
              </g>
            ) : null,
          )}
          {data.length > 1 ? (
            <path d={path} fill="none" stroke="var(--chart-line)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ) : null}
          {h ? <line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={H - pad.b} stroke="var(--accent-blue)" strokeOpacity={0.35} strokeWidth={1} /> : null}
          {data.map((d, k) => (
            <circle
              key={k}
              cx={x(k)}
              cy={y(d[metric] as number)}
              r={hover === k ? 5.5 : 4}
              fill="var(--chart-line)"
              stroke="#ffffff"
              strokeWidth={2}
            />
          ))}
          <text x={pad.l} y={H - 6} className="fill-muted-foreground text-[10.5px] tabular-nums">
            {data[0].ts ?? `#${data[0].i + 1}`}
          </text>
          {data.length > 1 ? (
            <text x={width - pad.r} y={H - 6} textAnchor="end" className="fill-muted-foreground text-[10.5px] tabular-nums">
              {data[data.length - 1].ts ?? `#${data[data.length - 1].i + 1}`}
            </text>
          ) : null}
        </svg>
        {h ? (
          <div
            role="tooltip"
            className="pointer-events-none absolute top-1 z-10 w-52 rounded-[12px] border border-border bg-panel px-3 py-2 text-[12.5px] shadow-soft"
            style={{ left: Math.min(Math.max(x(hover!) + 12, 0), width - 216) }}
          >
            <div className="text-[15px] font-semibold tabular-nums text-foreground">
              {h[metric]} {m.unit}
            </div>
            <div className="text-muted-foreground">
              {m.title}, {m.quality(h[metric] as number)}
            </div>
            <div className="mt-1.5 border-t border-hairline pt-1.5 text-muted-foreground">
              Message #{h.i + 1}
              {h.ts ? `, ${h.ts}` : ""}
              {h.rat ? `, ${h.rat}` : ""}
            </div>
            {best ? (
              <div className="text-muted-foreground">
                Best neighbour {best.rat} PCI {best.pci}
                {typeof best.rsrp === "number" ? ` at ${best.rsrp} dBm` : ""}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </figure>
  );
}

export function RadioView({ session, onOpen }: { session: Session; onOpen: (i: number) => void }) {
  const pts = session.radio.points;
  if (!pts.length) {
    return (
      <div className="surface rounded-2xl p-8 text-center text-[14px] text-muted-foreground">
        No measurement reports in this log. Radio quality appears here when the log contains LTE or NR Measurement Reports.
      </div>
    );
  }
  const metrics = (["rsrp", "rsrq", "sinr"] as Metric[]).filter((k) => pts.some((p) => typeof p[k] === "number"));
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[14px] text-ink-2">
        Serving cell quality from {pts.length} measurement {pts.length === 1 ? "report" : "reports"}, in log order. Hover or use the arrow keys for
        values; select a point to open its message.
      </p>
      {metrics.map((k) => (
        <MetricChart key={k} metric={k} points={pts} onOpen={onOpen} />
      ))}
      <section className="surface rounded-2xl px-[18px] py-4">
        <CardHead icon={TableIcon} title="Measurement reports" sub="Serving cell and the strongest neighbours in each report." />
        <div className="overflow-x-auto rounded-[12px] border border-border bg-panel scrollbar-thin">
          <table className="w-full min-w-[600px] text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-border bg-panel-2 text-[12px] text-muted-foreground">
                <th className="px-3.5 py-2 font-medium">Message</th>
                <th className="px-3 py-2 font-medium">Time</th>
                <th className="px-3 py-2 font-medium">RAT</th>
                <th className="px-3 py-2 text-right font-medium">RSRP</th>
                <th className="px-3 py-2 text-right font-medium">RSRQ</th>
                <th className="px-3 py-2 text-right font-medium">SINR</th>
                <th className="px-3 py-2 font-medium">Neighbours</th>
              </tr>
            </thead>
            <tbody>
              {pts.map((p) => (
                <tr key={p.i} className="even:bg-[rgb(11_27_52/0.022)]">
                  <td className="px-3.5 py-2">
                    <MsgRef i={p.i} onOpen={onOpen} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] tabular-nums text-muted-foreground">{p.ts ?? "n/a"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{p.rat ?? "n/a"}</td>
                  <td className={cn("px-3 py-2 text-right font-mono text-[12px] tabular-nums", (p.rsrp ?? 0) < -110 && "font-semibold text-q-bad")}>
                    {p.rsrp ?? "n/a"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{p.rsrq ?? "n/a"}</td>
                  <td className="px-3 py-2 text-right font-mono text-[12px] tabular-nums">{p.sinr ?? "n/a"}</td>
                  <td className="px-3 py-2 text-[12px] text-muted-foreground">
                    {p.neighbors.length
                      ? p.neighbors
                          .slice(0, 3)
                          .map((n) => `${n.rat} PCI ${n.pci}${n.rsrp != null ? ` ${n.rsrp} dBm` : ""}`)
                          .join(", ")
                      : "none"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
