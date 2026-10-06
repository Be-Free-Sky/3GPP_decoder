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
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 pb-3 pt-3.5">
        <h2 id="messages-heading" className="flex items-center gap-2 text-[15px] font-bold text-foreground">
          Messages{" "}
          <span className="rounded-full bg-hover-2 px-[7px] py-px font-mono text-[11px] font-semibold tabular-nums text-ink-2">{messages.length}</span>
        </h2>
        <div role="radiogroup" aria-label="Filter messages" className="flex gap-0.5 rounded-[10px] border border-border bg-sunken p-[3px]">
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
                "h-[26px] rounded-[7px] px-2.5 text-[12.5px] font-semibold tabular-nums transition-[background-color,color,box-shadow] duration-150",
                issuesOnly === o.v ? "bg-panel text-foreground shadow-[inset_0_0_0_1px_rgb(11_27_52/0.13)]" : "text-ink-2 hover:text-foreground",
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
        className="min-h-0 flex-1 overflow-y-auto scrollbar-thin px-2 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[rgb(0_105_200/0.3)]"
      >
        {shown.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">No messages with issues.</p>
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
                "group relative flex cursor-pointer items-center gap-2.5 rounded-[10px] py-2 pl-3 pr-2.5 transition-[background-color,box-shadow] duration-150 [content-visibility:auto] [contain-intrinsic-size:auto_54px]",
                active ? "bg-[rgb(0_105_200/0.11)] shadow-[inset_0_0_0_1px_rgb(0_105_200/0.3)]" : "hover:bg-hover",
              )}
            >
              {sev ? (
                <span
                  aria-hidden
                  className={cn("absolute inset-y-2 left-0.5 w-[3px] rounded-full", sev === "critical" ? "bg-critical" : "bg-warning")}
                />
              ) : null}
              <span className="w-7 shrink-0 text-right font-mono text-[11.5px] tabular-nums text-muted-foreground">{m.index + 1}</span>
              <span
                className={cn(
                  "grid size-[26px] shrink-0 place-items-center rounded-[8px] text-white",
                  r.direction === "UL" ? "bg-[linear-gradient(135deg,#018abe,#0069c8)]" : r.direction === "DL" ? "bg-[linear-gradient(135deg,#0069c8,#02457a)]" : "bg-[linear-gradient(135deg,#56677d,#34475f)]",
                )}
              >
                <DirectionGlyph result={r} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-semibold text-foreground">
                  {r.ok ? r.message?.title : "Could not decode"}
                  {carried ? <span className="font-medium text-link"> · {carried}</span> : null}
                </span>
                <span className="flex items-center gap-1.5 truncate text-[12px] text-muted-foreground">
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
