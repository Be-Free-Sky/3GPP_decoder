import { useState } from "react";
import { CaretRightIcon, MagnifyingGlassIcon, WrenchIcon } from "@phosphor-icons/react";
import type { Finding } from "@/lib/engine/types";
import { SEVERITY_LABEL, SEVERITY_SURFACE } from "@/lib/format";
import { Chip, MsgRef, SeverityIcon } from "./bits";
import { cn } from "@/lib/utils";

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
    <article className={cn("rounded-xl border border-border border-l-[3px] bg-raised", SEVERITY_SURFACE[f.severity])}>
      <div className="flex items-start gap-3 px-3.5 py-3">
        <SeverityIcon severity={f.severity} className="mt-0.5 size-[18px]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h4 className="text-[13.5px] font-semibold leading-snug text-foreground">{f.title}</h4>
            {f.count && f.count > 1 ? <Chip>x{f.count}</Chip> : null}
          </div>
          {f.detail ? <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{f.detail}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="sr-only">{SEVERITY_LABEL[f.severity]}</span>
            {f.ref ? <Chip tone="mono">{f.ref}</Chip> : null}
            {f.via ? <Chip>in {f.via}</Chip> : null}
            {onOpen && f.refs?.length
              ? f.refs.slice(0, 8).map((r) => <MsgRef key={r} i={r} onOpen={onOpen} />)
              : null}
            {expandable ? (
              <button
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="ml-auto inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-link transition-colors duration-150 hover:bg-brand-3/[0.08]"
              >
                <CaretRightIcon
                  weight="bold"
                  className={cn("size-3 transition-transform duration-150 ease-(--ease-out)", open && "rotate-90")}
                />
                {open ? "Hide analysis" : "Causes and checks"}
              </button>
            ) : null}
          </div>
          {open ? (
            <div className="mt-3 grid gap-3 border-t border-hairline pt-3 sm:grid-cols-2">
              {f.causes?.length ? (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <MagnifyingGlassIcon className="size-3.5 text-brand-3" /> Likely causes
                  </div>
                  <ul className="grid gap-1 text-[12.5px] leading-relaxed text-muted-foreground">
                    {f.causes.map((c) => (
                      <li key={c} className="flex gap-2">
                        <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-muted-foreground/60" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {f.checks?.length ? (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <WrenchIcon className="size-3.5 text-brand-3" /> What to check
                  </div>
                  <ul className="grid gap-1 text-[12.5px] leading-relaxed text-muted-foreground">
                    {f.checks.map((c) => (
                      <li key={c} className="flex gap-2">
                        <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-brand-3/70" />
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
