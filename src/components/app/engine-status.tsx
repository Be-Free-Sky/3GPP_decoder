import { useSyncExternalStore } from "react";
import { CheckCircleIcon, CircleNotchIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { engine, type EngineState } from "@/lib/engine/client";
import { cn } from "@/lib/utils";

const SERVER_STATE: EngineState = { stage: "idle", label: "Decoder not started", progress: null };

export function useEngineState() {
  return useSyncExternalStore(engine.subscribe, engine.getState, () => SERVER_STATE);
}

export function EngineStatus({ className }: { className?: string }) {
  const s = useEngineState();
  const busy = s.stage !== "ready" && s.stage !== "error";
  const pct = s.progress != null ? Math.round(s.progress * 100) : null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("relative inline-flex min-h-7 flex-wrap items-center justify-center gap-x-2 overflow-hidden px-1 text-[12.5px] font-medium text-muted-foreground", className)}
    >
      {s.stage === "ready" ? (
        <CheckCircleIcon weight="fill" className="size-4 text-ok" />
      ) : s.stage === "error" ? (
        <WarningCircleIcon weight="fill" className="size-4 text-critical" />
      ) : (
        <CircleNotchIcon className="size-4 animate-spin text-blue motion-reduce:animate-none" />
      )}
      <span className="whitespace-nowrap">
        {s.stage === "ready" ? "Decoder ready, offline" : s.label}
        {busy && pct != null ? <span className="tabular-nums"> {pct}%</span> : null}
      </span>
      {s.stage === "error" && s.error ? <span className="basis-full text-center text-critical-ink">{s.error}</span> : null}
      {busy && pct != null ? (
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-0.5 origin-left rounded-full bg-blue transition-transform duration-200 ease-(--ease-out)"
          style={{ transform: `scaleX(${s.progress})` }}
        />
      ) : null}
    </div>
  );
}
