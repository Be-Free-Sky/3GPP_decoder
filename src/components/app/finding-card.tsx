import { useState } from "react";
import { CaretRightIcon, MagnifyingGlassIcon, WrenchIcon } from "@phosphor-icons/react";
import type { Finding, Severity } from "@/lib/engine/types";
import { SEVERITY_INK, SEVERITY_LABEL, SEVERITY_SOFT } from "@/lib/format";
import { Chip, MsgRef, SeverityIcon } from "./bits";
import { cn } from "@/lib/utils";

/** A diagnosis states its verdict with a thin line along its top, in the verdict's colour (Log Prism). */
const TOP_LINE: Record<Severity, string> = {
  critical: "shadow-[inset_0_3px_0_var(--st-bad),var(--lift)]",
  warning: "shadow-[inset_0_3px_0_var(--st-warn),var(--lift)]",
  ok: "shadow-[inset_0_3px_0_var(--st-ok),var(--lift)]",
  info: "shadow-[inset_0_3px_0_var(--accent-blue),var(--lift)]",
};

export function FindingCard({
  f,
  onOpen,
  defaultOpen,
}: {
  f: Finding;
  onOpen?: (i: number) => void;
  defaultOpen?: boolean;
}) {
  const expandable = Boolean(f.causes?.length || f.checks?.length);
  const [open, setOpen] = useState(Boolean(defaultOpen) && expandable);
  return (
    <article className={cn("rounded-[14px] border border-border bg-panel", TOP_LINE[f.severity])}>
      <div className="flex items-start gap-3 px-4 pb-3.5 pt-4">
        <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", SEVERITY_SOFT[f.severity])}>
          <SeverityIcon severity={f.severity} className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-[15px] font-bold leading-snug text-foreground">{f.title}</h4>
            <span className={cn("rounded-full px-2 py-px text-[11.5px] font-bold", SEVERITY_SOFT[f.severity], SEVERITY_INK[f.severity])}>
              {SEVERITY_LABEL[f.severity]}
            </span>
            {f.count && f.count > 1 ? <Chip>x{f.count}</Chip> : null}
          </div>
          {f.detail ? <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{f.detail}</p> : null}
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {f.ref ? <Chip tone="mono">{f.ref}</Chip> : null}
            {f.via ? <Chip>in {f.via}</Chip> : null}
            {onOpen && f.refs?.length ? f.refs.slice(0, 8).map((r) => <MsgRef key={r} i={r} onOpen={onOpen} />) : null}
            {expandable ? (
              <button
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="ml-auto inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[13px] font-bold text-link transition-colors duration-150 hover:bg-accent"
              >
                <CaretRightIcon weight="bold" className={cn("size-3 transition-transform duration-200 ease-(--ease-out)", open && "rotate-90")} />
                {open ? "Hide causes and checks" : "Causes and checks"}
              </button>
            ) : null}
          </div>
          {open ? (
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {f.causes?.length ? (
                <div className="rounded-[12px] border border-border bg-panel-2 px-3.5 py-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-foreground">
                    <MagnifyingGlassIcon weight="bold" className="size-4 text-blue" /> Likely causes
                  </div>
                  <ul className="grid gap-1 text-[13.5px] leading-relaxed text-ink-2">
                    {f.causes.map((c) => (
                      <li key={c} className="flex gap-2">
                        <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-line-3" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {f.checks?.length ? (
                <div className="rounded-[12px] border border-[rgb(12_163_12/0.2)] bg-ok-soft px-3.5 py-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-ok-ink">
                    <WrenchIcon weight="bold" className="size-4" /> What to check
                  </div>
                  <ul className="grid gap-1 text-[13.5px] leading-relaxed text-foreground">
                    {f.checks.map((c) => (
                      <li key={c} className="flex gap-2">
                        <span aria-hidden className="mt-[9px] size-1 shrink-0 rounded-full bg-ok" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}
