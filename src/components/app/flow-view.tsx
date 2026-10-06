"use client";

import { CellTowerIcon, DeviceMobileIcon, HardDrivesIcon } from "@phosphor-icons/react";
import type { FlowEvent, Session } from "@/lib/engine/types";
import { SeverityIcon } from "./bits";
import { cn } from "@/lib/utils";

function laneIcon(lane: string) {
  if (lane === "UE") return DeviceMobileIcon;
  if (["MME", "AMF", "MSC / SGSN", "Network"].includes(lane)) return HardDrivesIcon;
  return CellTowerIcon;
}

const LANE_ROLE: Record<string, string> = {
  UE: "Device",
  eNB: "LTE RAN",
  gNB: "NR RAN",
  RNC: "WCDMA RAN",
  MME: "EPC core",
  AMF: "5G core",
  "MSC / SGSN": "2G / 3G core",
  "Peer RAN": "Neighbour",
  "gNB-DU": "Distributed unit",
  "gNB-CU": "Central unit",
  Network: "Network",
};

export function FlowView({ session, selected, onOpen }: { session: Session; selected: number; onOpen: (i: number) => void }) {
  const lanes = session.lanes.length ? session.lanes : ["UE", "Network"];
  const n = lanes.length;
  const center = (lane?: string) => {
    const k = Math.max(0, lanes.indexOf(lane ?? ""));
    return ((k + 0.5) / n) * 100;
  };
  const events = session.events;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-muted-foreground">
        Signalling ladder in log order. NAS messages carried inside RRC are drawn dashed between the UE and the core. Select a row to open the
        message.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-border bg-raised scrollbar-thin">
        <div className="min-w-[560px]">
          <div className="sticky top-0 z-10 grid grid-cols-[92px_1fr] border-b border-border bg-white/95 backdrop-blur">
            <div className="px-3 py-3 text-[11.5px] font-medium text-muted-foreground">Time</div>
            <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
              {lanes.map((l) => {
                const Icon = laneIcon(l);
                return (
                  <div key={l} className="flex flex-col items-center gap-1 py-2.5">
                    <span className="grid size-8 place-items-center rounded-[10px] border border-brand-3/20 bg-brand-3/[0.08] text-brand-2">
                      <Icon className="size-4.5" />
                    </span>
                    <span className="text-[12.5px] font-semibold text-foreground">{l}</span>
                    <span className="text-[10.5px] text-muted-foreground">{LANE_ROLE[l] ?? ""}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="relative">
            <div aria-hidden className="pointer-events-none absolute inset-y-0 left-[92px] right-0">
              {lanes.map((l, k) => (
                <span key={l} className="absolute inset-y-0 w-px bg-border" style={{ left: `${((k + 0.5) / n) * 100}%` }} />
              ))}
            </div>
            <ol aria-label="Signalling flow">
              {events.map((e, idx) => (
                <FlowRow
                  key={idx}
                  e={e}
                  active={e.i === selected && e.sub == null}
                  from={center(e.from)}
                  to={center(e.to)}
                  onOpen={onOpen}
                />
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

function FlowRow({ e, active, from, to, onOpen }: { e: FlowEvent; active: boolean; from: number; to: number; onOpen: (i: number) => void }) {
  const left = Math.min(from, to);
  const width = Math.max(Math.abs(to - from), 0.5);
  const rightward = to >= from;
  const tone =
    e.error || e.status === "failure" ? "critical" : e.status === "warning" ? "warning" : e.sub != null ? "nested" : "normal";
  const lineColor =
    tone === "critical" ? "border-critical" : tone === "warning" ? "border-warning" : tone === "nested" ? "border-brand-3/60" : "border-brand-2";
  const headColor =
    tone === "critical" ? "text-critical" : tone === "warning" ? "text-warning" : tone === "nested" ? "text-brand-3/70" : "text-brand-2";

  return (
    <li className="[content-visibility:auto] [contain-intrinsic-size:auto_48px]">
      <button
        onClick={() => onOpen(e.i)}
        className={cn(
          "grid w-full grid-cols-[92px_1fr] text-left transition-colors duration-150",
          active ? "bg-brand-3/[0.08]" : "hover:bg-muted/70",
          e.sub != null && "opacity-90",
        )}
        aria-label={`Message ${e.i + 1}: ${e.title}`}
      >
        <span className="flex h-12 flex-col justify-center px-3">
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{e.ts ?? `#${e.i + 1}`}</span>
          {e.ts ? <span className="font-mono text-[10px] text-muted-foreground/70">#{e.i + 1}</span> : null}
        </span>
        <span className="relative block h-12">
          {e.error ? (
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[12px] font-medium text-critical">
              Decode failed
            </span>
          ) : (
            <>
              <span
                className="absolute top-[7px] flex justify-center px-2"
                style={{ left: `${left}%`, width: `${Math.max(width, 18)}%`, marginLeft: width < 18 ? `${(width - 18) / 2}%` : 0 }}
              >
                <span
                  className={cn(
                    "inline-flex max-w-full items-center gap-1 truncate text-[12px] font-medium",
                    tone === "nested" ? "text-brand-2" : "text-foreground",
                  )}
                >
                  {tone === "critical" ? <SeverityIcon severity="critical" className="size-3.5" /> : null}
                  {tone === "warning" ? <SeverityIcon severity="warning" className="size-3.5" /> : null}
                  <span className="truncate">{e.title}</span>
                  {e.bcast ? <span className="font-normal text-muted-foreground"> (broadcast)</span> : null}
                </span>
              </span>
              <span
                className={cn("absolute top-[31px] border-t-2", lineColor, e.sub != null && "border-dashed", e.bcast && "border-dotted")}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
              <span
                aria-hidden
                className={cn("absolute top-[26px] text-[12px] leading-none", headColor)}
                style={rightward ? { left: `calc(${to}% - 7px)` } : { left: `calc(${to}% - 1px)` }}
              >
                {rightward ? "▶" : "◀"}
              </span>
              {e.via ? (
                <span className="absolute top-[35px] text-[10px] text-muted-foreground" style={{ left: `${left}%`, width: `${width}%`, textAlign: "center" }}>
                  via {e.via}
                </span>
              ) : null}
            </>
          )}
        </span>
      </button>
    </li>
  );
}
