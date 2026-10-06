import { useEffect, useRef } from "react";
import type { MessageEntry } from "@/lib/engine/types";
import { carriedTitle, protocolShort, worstSeverity } from "@/lib/format";
import { DirectionGlyph, SeverityIcon } from "./bits";
import { cn } from "@/lib/utils";

export function MessageList({
  messages,
  selected,
  onSelect,
  issuesOnly,
  setIssuesOnly,
}: {
  messages: MessageEntry[];
  selected: number;
  onSelect: (i: number) => void;
  issuesOnly: boolean;
  setIssuesOnly: (v: boolean) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const issues = messages.filter((m) => worstSeverity(m.result));
  const shown = issuesOnly ? issues : messages;

  // Keep the selected row visible by scrolling the list only. scrollIntoView would also
  // scroll the overflow-hidden panels and the page around it.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    if (!list || !el) return;
    const lr = list.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.top < lr.top) list.scrollTop -= lr.top - er.top + 4;
    else if (er.bottom > lr.bottom) list.scrollTop += er.bottom - lr.bottom + 4;
  }, [selected]);

  const move = (delta: number) => {
    const pos = shown.findIndex((m) => m.index === selected);
    const next = shown[Math.max(0, Math.min(shown.length - 1, (pos < 0 ? 0 : pos) + delta))];
    if (next) onSelect(next.index);
  };

  return (
    <section aria-labelledby="messages-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-t border-border px-4 pb-2 pt-3">
        <h2 id="messages-heading" className="text-sm font-semibold text-foreground">
          Messages <span className="font-normal tabular-nums text-muted-foreground">{messages.length}</span>
        </h2>
        <div role="radiogroup" aria-label="Filter messages" className="flex gap-0.5 rounded-lg bg-muted p-0.5">
          {[
            { v: false, l: "All" },
            { v: true, l: `Issues ${issues.length}` },
          ].map((o) => (
            <button
              key={String(o.v)}
              role="radio"
              aria-checked={issuesOnly === o.v}
              onClick={() => setIssuesOnly(o.v)}
              className={cn(
                "h-6 rounded-md px-2 text-xs font-medium tabular-nums transition-[background-color,color] duration-150",
                issuesOnly === o.v ? "bg-white text-foreground shadow-[0_1px_2px_rgb(0_27_72/0.12)]" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.l}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={listRef}
        role="listbox"
        aria-label="Decoded messages"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            move(1);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            move(-1);
          }
        }}
        className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2 pb-3 outline-none focus-visible:ring-2 focus-visible:ring-brand-3/30"
      >
        {shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">No messages with issues.</p>
        ) : null}
        {shown.map((m) => {
          const r = m.result;
          const sev = worstSeverity(r);
          const active = m.index === selected;
          const carried = r.ok ? carriedTitle(r) : null;
          return (
            <div
              key={m.index}
              role="option"
              aria-selected={active}
              data-index={m.index}
              onClick={() => onSelect(m.index)}
              className={cn(
                "group relative flex cursor-pointer items-center gap-2.5 rounded-lg py-2 pl-3 pr-2.5 transition-colors duration-150 [content-visibility:auto] [contain-intrinsic-size:auto_52px]",
                active ? "bg-brand-3/[0.1] ring-1 ring-brand-3/25" : "hover:bg-muted",
              )}
            >
              {sev ? (
                <span
                  aria-hidden
                  className={cn("absolute inset-y-2 left-0.5 w-[3px] rounded-full", sev === "critical" ? "bg-critical" : "bg-warning")}
                />
              ) : null}
              <span className="w-7 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{m.index + 1}</span>
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-md",
                  r.direction === "UL" ? "bg-brand-3/[0.12] text-brand-2" : "bg-brand-2/[0.1] text-brand-1",
                )}
              >
                <DirectionGlyph result={r} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-foreground">
                  {r.ok ? r.message?.title : "Could not decode"}
                  {carried ? <span className="font-normal text-brand-2"> · {carried}</span> : null}
                </span>
                <span className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                  {m.timestamp ? <span className="font-mono tabular-nums">{m.timestamp}</span> : null}
                  <span className="truncate">{r.ok ? protocolShort(r) : `${r.bytes} bytes`}</span>
                </span>
              </span>
              {sev ? <SeverityIcon severity={sev} className="size-4" /> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
