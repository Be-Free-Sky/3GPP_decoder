import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CircleNotchIcon,
  FolderOpenIcon,
  InfoIcon,
  MinusCircleIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { fleetOverview, logFacts, logVerdict, type FleetLog, type Tone } from "@/lib/fleet";
import { sizeText } from "@/lib/capture";
import { cn } from "@/lib/utils";

const EASE = [0.23, 1, 0.32, 1] as const;

const BAR: Record<Tone, string> = {
  bad: "linear-gradient(90deg,#c21d3a,#e0485f)",
  warn: "linear-gradient(90deg,#c98500,#e8a93b)",
  ok: "linear-gradient(90deg,#12924a,#2fb86a)",
  none: "linear-gradient(90deg,#9aa8b8,#c9d3df)",
  busy: "linear-gradient(90deg,#02457a,#0069c8,#018abe)",
};

const CHIP: Record<Tone, string> = {
  bad: "bg-critical-soft text-critical-ink",
  warn: "bg-warning-soft text-warning-ink",
  ok: "bg-ok-soft text-ok-ink",
  none: "bg-sunken text-ink-2",
  busy: "bg-info-soft text-info-ink",
};

const TOP: Record<Tone, string> = {
  bad: "border-t-critical",
  warn: "border-t-warning",
  ok: "border-t-ok",
  none: "border-t-line-3",
  busy: "border-t-blue",
};

function ToneIcon({ tone, className }: { tone: Tone; className?: string }) {
  if (tone === "bad") return <XCircleIcon weight="bold" className={className} />;
  if (tone === "warn") return <WarningIcon weight="bold" className={className} />;
  if (tone === "ok") return <CheckCircleIcon weight="bold" className={className} />;
  if (tone === "busy") return <CircleNotchIcon weight="bold" className={cn(className, "animate-spin motion-reduce:animate-none")} />;
  return <MinusCircleIcon weight="bold" className={className} />;
}

function LogCard({ log, index, total, onOpen }: { log: FleetLog; index: number; total: number; onOpen: (i: number) => void }) {
  const v = logVerdict(log);
  const facts = logFacts(log);
  const issue = v.tone === "bad" || v.tone === "warn";
  return (
    <article
      data-log={log.name}
      data-tone={v.tone}
      className={cn("flex w-full flex-col gap-2.5 rounded-[18px] border border-t-4 border-border bg-panel px-[18px] pb-4 pt-4 shadow-lift", TOP[v.tone])}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className="grad grid size-[30px] shrink-0 place-items-center rounded-[9px] text-white">
          <FolderOpenIcon weight="bold" className="size-[17px]" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="break-all font-mono text-[14.5px] font-bold leading-snug text-foreground">{log.name}</h3>
          <p className="text-[12.5px] text-muted-foreground">
            Log {index + 1} of {total}
            {facts.length ? ` · ${facts.join(" · ")}` : ` · ${log.fileCount} files, ${sizeText(log.size)}`}
          </p>
        </div>
        <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12.5px] font-bold", CHIP[v.tone])}>
          <ToneIcon tone={v.tone} className="size-3.5" />
          {v.word}
        </span>
      </div>
      <p className={cn("text-[15px] font-semibold leading-snug [overflow-wrap:anywhere]", v.tone === "busy" ? "text-ink-2" : "text-foreground")}>{v.head}</p>
      {v.detail ? <p className="text-[14px] leading-relaxed text-ink-2">{v.detail}</p> : null}
      {v.todo && issue ? (
        <p className="rounded-[10px] border border-[rgb(12_163_12/0.2)] bg-ok-soft px-3 py-2 text-[14px] leading-relaxed text-foreground">
          <b className="text-ok-ink">What to do:</b> {v.todo}
        </p>
      ) : null}
      {log.status === "failed" && log.info?.files?.length ? (
        <details className="rounded-[10px] bg-sunken px-3 py-2 text-[13px] text-ink-2">
          <summary className="cursor-pointer font-semibold text-foreground">The {log.info.files.length} files in this folder</summary>
          <ul className="mt-1.5 grid gap-0.5">
            {log.info.files.map((f) => (
              <li key={f.path} className="break-all">
                <span className="font-mono text-[12px] text-foreground">{f.name}</span> · {f.label}
                {f.role === "skipped" ? ` · ${f.reason}` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {log.report ? (
        <button
          onClick={() => onOpen(index)}
          className={cn(
            "press mt-auto inline-flex h-[38px] items-center gap-2 self-start rounded-[11px] px-4 text-[13.5px] font-semibold",
            issue
              ? "btn-primary"
              : "border border-line-2 bg-white/70 text-foreground transition-[background-color,border-color] duration-150 hover:border-line-3 hover:bg-hover-2",
          )}
        >
          Open this log <ArrowRightIcon weight="bold" className="size-4" />
        </button>
      ) : null}
    </article>
  );
}

export function FleetView({ logs, onOpen }: { logs: FleetLog[]; onOpen: (i: number) => void }) {
  const reduce = useReducedMotion();
  const o = fleetOverview(logs);
  const done = logs.filter((l) => l.status === "done" || l.status === "failed").length;
  const enter = (i: number) =>
    reduce
      ? {}
      : { initial: { opacity: 0, transform: "translateY(8px)" }, animate: { opacity: 1, transform: "translateY(0px)" }, transition: { duration: 0.28, delay: i * 0.04, ease: EASE } };
  return (
    <div className="flex flex-col gap-4">
      <motion.section
        {...enter(0)}
        data-fleet-tone={o.tone}
        className="relative overflow-hidden rounded-[22px] border border-border bg-panel px-[clamp(18px,3vw,36px)] pb-6 pt-7 shadow-soft"
      >
        <span aria-hidden className="absolute inset-x-0 top-0 h-1.5" style={{ background: BAR[o.tone] }} />
        <div className={cn("inline-flex items-center gap-2 rounded-full px-3.5 py-[5px] text-[13.5px] font-bold", CHIP[o.tone])}>
          <ToneIcon tone={o.tone} className="size-4" />
          {o.kick}
        </div>
        <h2 className="mt-3.5 max-w-[70ch] text-[clamp(21px,2.6vw,30px)] font-bold leading-[1.3] tracking-[-0.015em] text-foreground [overflow-wrap:anywhere]">{o.head}</h2>
        {o.detail ? <p className="mt-2 max-w-[80ch] text-[16px] leading-relaxed text-ink-2">{o.detail}</p> : null}
        {o.tone === "busy" ? (
          <div className="mt-4 h-2 max-w-[520px] overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuemin={0} aria-valuemax={logs.length} aria-valuenow={done}>
            <div className="h-full rounded-full bg-blue transition-[width] duration-300 ease-(--ease-out)" style={{ width: `${(done / logs.length) * 100}%` }} />
          </div>
        ) : null}
        {o.issues.length ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-semibold text-ink-2">Open:</span>
            {o.issues.map((x) => (
              <button
                key={x.index}
                onClick={() => logs[x.index].report && onOpen(x.index)}
                className={cn("press inline-flex items-center gap-1.5 rounded-full px-3 py-1 font-mono text-[12.5px] font-bold", CHIP[x.tone])}
              >
                <ToneIcon tone={x.tone} className="size-3.5" />
                {x.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-ink-2">
          <span>
            <b className="text-foreground">{logs.length}</b> logs
          </span>
          {o.counts.bad ? (
            <span className="text-critical-ink">
              <b>{o.counts.bad}</b> with a failure
            </span>
          ) : null}
          {o.counts.warn ? (
            <span className="text-warning-ink">
              <b>{o.counts.warn}</b> worth a look
            </span>
          ) : null}
          {o.counts.ok ? (
            <span className="text-ok-ink">
              <b>{o.counts.ok}</b> all good
            </span>
          ) : null}
          {o.counts.none ? (
            <span>
              <b className="text-foreground">{o.counts.none}</b> not analysed
            </span>
          ) : null}
        </div>
      </motion.section>

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-2">
        {logs.map((l, i) => (
          <motion.div key={`${l.name}-${i}`} {...enter(i + 1)} className="flex">
            <LogCard log={l} index={i} total={logs.length} onOpen={onOpen} />
          </motion.div>
        ))}
      </div>

      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <InfoIcon weight="bold" className="size-[15px]" />
        Each folder ending in _armlog is one log. Open one to see its summary, signalling flow, messages and radio.
      </p>
    </div>
  );
}
