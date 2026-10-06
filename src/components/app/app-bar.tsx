import { motion, useReducedMotion } from "motion/react";
import { CopyIcon, DownloadSimpleIcon, HouseIcon } from "@phosphor-icons/react";
import { BrandLockup, DecoderMark } from "./brand";
import { cn } from "@/lib/utils";

export interface TabDef<T extends string> {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string; weight?: "bold" | "fill" | "regular" }>;
  /** small count after the label */
  n?: number;
  /** the count is a problem count */
  alert?: boolean;
}

const GHOST =
  "press inline-flex h-[38px] items-center justify-center gap-2 whitespace-nowrap rounded-[11px] border border-line-2 bg-white/70 px-3 text-[13.5px] font-semibold text-foreground transition-[background-color,border-color] duration-150 hover:border-line-3 hover:bg-hover-2 sm:px-[15px]";

/** The results header, as in Skyworth Log Prism: brand and log name, actions, then the view tabs. */
export function AppBar<T extends string>({
  title,
  chip,
  meta,
  tabs,
  tab,
  onTab,
  onHome,
  onCopy,
  onJson,
}: {
  title: string;
  chip?: string;
  meta: React.ReactNode;
  tabs: TabDef<T>[];
  tab: T;
  onTab: (t: T) => void;
  onHome: () => void;
  onCopy?: () => void;
  onJson?: () => void;
}) {
  const reduce = useReducedMotion();
  return (
    <header className="no-print sticky top-0 z-30">
      <div className="glass-bar flex items-center justify-between gap-3.5 border-b border-border px-[clamp(12px,2.4vw,24px)] py-2.5 shadow-[inset_0_-1px_0_rgb(255_255_255/0.6)]">
        <div className="flex min-w-0 items-center gap-3.5">
          <button
            onClick={onHome}
            className="press -m-1 shrink-0 rounded-[10px] p-1 transition-colors duration-150 hover:bg-hover"
            aria-label="Skyworth 3GPP Decoder, go to the home page"
          >
            <span className="hidden lg:block">
              <BrandLockup size="sm" />
            </span>
            <DecoderMark className="size-7 lg:hidden" />
          </button>
          <span aria-hidden className="hidden h-8 w-px bg-line-2 lg:block" />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2.5">
              <h1 className="truncate text-[17px] font-extrabold tracking-[-0.015em] text-foreground sm:text-[19px]">{title}</h1>
              {chip ? (
                <span className="hidden shrink-0 items-center rounded-full border border-accent-ring bg-accent px-2 py-0.5 text-[11.5px] font-bold text-link sm:inline-flex">
                  {chip}
                </span>
              ) : null}
            </div>
            <div className="truncate text-[12px] text-muted-foreground">{meta}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={onHome} className={GHOST} aria-label="Home">
            <HouseIcon weight="bold" className="size-[18px]" />
            <span className="hidden sm:inline">Home</span>
          </button>
          {onJson ? (
            <button onClick={onJson} className={cn(GHOST, "hidden md:inline-flex")} title="Save the full decode as JSON">
              <DownloadSimpleIcon weight="bold" className="size-[18px]" />
              JSON
            </button>
          ) : null}
          {onCopy ? (
            <button
              onClick={onCopy}
              className="btn-primary press inline-flex h-[38px] items-center gap-2 whitespace-nowrap rounded-[11px] px-3 text-[13.5px] font-semibold sm:px-[15px]"
              title="Copy the report as Markdown, for a ticket or an email"
            >
              <CopyIcon weight="bold" className="size-[18px]" />
              <span className="hidden sm:inline">Copy report</span>
            </button>
          ) : null}
        </div>
      </div>
      <nav
        role="tablist"
        aria-label="Result views"
        className="glass-bar flex gap-1 overflow-x-auto border-b border-border bg-[rgb(252_253_254/0.46)] px-[clamp(12px,2.4vw,24px)] scrollbar-thin"
      >
        {tabs.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              onClick={() => onTab(t.id)}
              className={cn(
                "relative inline-flex shrink-0 items-center gap-2 px-3 pb-[11px] pt-3 text-[13.5px] font-bold transition-colors duration-150 sm:px-3.5",
                active ? "text-foreground" : "text-ink-2 hover:text-foreground",
              )}
            >
              <t.icon weight={active ? "fill" : "bold"} className={cn("size-[18px]", active && "text-blue")} />
              {t.label}
              {t.n != null ? (
                <span
                  className={cn(
                    "rounded-full px-[7px] py-px font-mono text-[11px] font-semibold tabular-nums",
                    t.alert ? "bg-critical-soft text-critical-ink" : "bg-hover-2 text-ink-2",
                  )}
                >
                  {t.n}
                </span>
              ) : null}
              {active ? (
                <motion.span
                  layoutId="app-tab"
                  transition={reduce ? { duration: 0 } : { type: "spring", duration: 0.3, bounce: 0.1 }}
                  className="grad absolute inset-x-2.5 -bottom-px h-0.5 rounded-full"
                />
              ) : null}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
