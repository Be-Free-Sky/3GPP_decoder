import { CellTowerIcon, DeviceMobileIcon, FlowArrowIcon, HardDrivesIcon } from "@phosphor-icons/react";
import type { FlowEvent, Session } from "@/lib/engine/types";
import { SeverityIcon } from "./bits";
import { CardHead } from "./summary-view";
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
    <section className="surface rounded-2xl px-[18px] py-4">
      <CardHead
        icon={FlowArrowIcon}
        title="Signalling flow"
        sub="Every message between the device, the radio network and the core, in log order. Select a row to open it."
        aside={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden className="w-5 border-t-2 border-blue" />
              Message
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden className="w-5 border-t-2 border-dashed border-brand-3" />
              NAS inside RRC
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i aria-hidden className="w-5 border-t-2 border-critical" />
              Failure
            </span>
          </div>
        }
      />
      <div className="overflow-x-auto rounded-[12px] border border-border bg-panel scrollbar-thin">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[92px_1fr] border-b border-border bg-panel-2">
            <div className="flex items-center px-3 py-3 text-[12px] font-semibold text-muted-foreground">Time</div>
            <div className="grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
              {lanes.map((l) => {
                const Icon = laneIcon(l);
                return (
                  <div key={l} className="flex flex-col items-center gap-1 py-2.5">
                    <span className="grad grid size-[30px] place-items-center rounded-[9px] text-white">
                      <Icon weight="bold" className="size-[17px]" />
                    </span>
                    <span className="text-[13px] font-bold text-foreground">{l}</span>
                    <span className="text-[11px] text-muted-foreground">{LANE_ROLE[l] ?? ""}</span>
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
    </section>
  );
}

function FlowRow({ e, active, from, to, onOpen }: { e: FlowEvent; active: boolean; from: number; to: number; onOpen: (i: number) => void }) {
  const left = Math.min(from, to);
  const width = Math.max(Math.abs(to - from), 0.5);
  const rightward = to >= from;
  const tone =
    e.error || e.status === "failure" ? "critical" : e.status === "warning" ? "warning" : e.sub != null ? "nested" : "normal";
  const lineColor =
    tone === "critical" ? "border-critical" : tone === "warning" ? "border-warning" : tone === "nested" ? "border-brand-3" : "border-blue";
  const headColor =
    tone === "critical" ? "text-critical" : tone === "warning" ? "text-warning" : tone === "nested" ? "text-brand-3" : "text-blue";

  return (
    <li className="[content-visibility:auto] [contain-intrinsic-size:auto_48px]">
      <button
        onClick={() => onOpen(e.i)}
        className={cn(
          "grid w-full grid-cols-[92px_1fr] text-left transition-colors duration-150",
          active
            ? "bg-[rgb(0_105_200/0.11)] shadow-[inset_3px_0_0_var(--accent-blue)]"
            : tone === "critical"
              ? "bg-critical-soft/40 hover:bg-critical-soft/70"
              : "hover:bg-hover",
          e.sub != null && "opacity-90",
        )}
        aria-label={`Message ${e.i + 1}: ${e.title}`}
      >
        <span className="flex h-12 flex-col justify-center px-3">
          <span className="font-mono text-[11.5px] font-medium tabular-nums text-ink-2">{e.ts ?? `#${e.i + 1}`}</span>
          {e.ts ? <span className="font-mono text-[10px] text-muted-foreground/70">#{e.i + 1}</span> : null}
        </span>
        <span className="relative block h-12">
          {e.error ? (
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[12.5px] font-semibold text-critical-ink">
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
                    "inline-flex max-w-full items-center gap-1 truncate text-[12.5px] font-semibold",
                    tone === "nested" ? "text-info-ink" : tone === "critical" ? "text-critical-ink" : "text-foreground",
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
