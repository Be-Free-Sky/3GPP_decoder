import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRightIcon,
  CellTowerIcon,
  ChartLineIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  FileHtmlIcon,
  FileTextIcon,
  FlowArrowIcon,
  GlobeHemisphereEastIcon,
  InfoIcon,
  ListChecksIcon,
  PlugsConnectedIcon,
  ShieldCheckIcon,
  WarningIcon,
  XCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import type { Procedure, Report, Severity } from "@/lib/engine/types";
import { buildAreas, buildHeadline, type Area, type AreaStatus } from "@/lib/areas";
import { fmtMs } from "@/lib/format";
import { FindingCard } from "./finding-card";
import { FilesSummary } from "./files-view";
import { CrashSummary } from "./crash-view";
import { cn } from "@/lib/utils";

const EASE = [0.23, 1, 0.32, 1] as const;

const AREA_ICON = {
  radio: CellTowerIcon,
  connection: PlugsConnectedIcon,
  registration: ShieldCheckIcon,
  data: GlobeHemisphereEastIcon,
} as const;

const TOP_BAR: Record<"bad" | "warn" | "ok", string> = {
  bad: "linear-gradient(90deg,#c21d3a,#e0485f)",
  warn: "linear-gradient(90deg,#c98500,#e8a93b)",
  ok: "linear-gradient(90deg,#12924a,#2fb86a)",
};

const SOFT: Record<AreaStatus, string> = {
  bad: "bg-critical-soft text-critical-ink",
  warn: "bg-warning-soft text-warning-ink",
  ok: "bg-ok-soft text-ok-ink",
  none: "bg-info-soft text-info-ink",
};

const TILE_TOP: Record<AreaStatus, string> = {
  bad: "border-t-critical",
  warn: "border-t-warning",
  ok: "border-t-ok",
  none: "border-t-line-3",
};

function StatusIcon({ status, className }: { status: AreaStatus; className?: string }) {
  if (status === "bad") return <XCircleIcon weight="bold" className={className} />;
  if (status === "warn") return <WarningIcon weight="bold" className={className} />;
  if (status === "ok") return <CheckCircleIcon weight="bold" className={className} />;
  return <InfoIcon weight="bold" className={className} />;
}

export function CardHead({
  icon: Icon,
  title,
  sub,
  aside,
}: {
  icon: typeof ClockIcon;
  title: string;
  sub?: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div>
        <h2 className="flex items-center gap-2.5 text-[15.5px] font-bold tracking-[-0.01em] text-foreground">
          <span className="grad grid size-[30px] shrink-0 place-items-center rounded-[9px] text-white">
            <Icon weight="bold" className="size-[17px]" />
          </span>
          {title}
        </h2>
        {sub ? <p className="mt-1 text-[13px] text-muted-foreground">{sub}</p> : null}
      </div>
      {aside}
    </div>
  );
}

function Bars({ n }: { n: number }) {
  return (
    <span className="inline-flex h-[18px] items-end gap-[3px]" aria-label={`${n} of 4 bars`}>
      {[1, 2, 3, 4].map((b) => (
        <i key={b} className={cn("w-1.5 rounded-[2px]", b <= n ? "bg-blue" : "bg-line-2")} style={{ height: 4 + b * 3.5 }} />
      ))}
    </span>
  );
}

function AreaTile({ a, onGo }: { a: Area; onGo: (a: Area) => void }) {
  const Icon = AREA_ICON[a.id];
  return (
    <article className={cn("flex w-full flex-col gap-2.5 rounded-[18px] border border-t-4 border-border bg-panel px-[18px] pb-3.5 pt-4 shadow-lift", TILE_TOP[a.status])}>
      <div className="flex items-center gap-2.5">
        <span className="grad grid size-[30px] shrink-0 place-items-center rounded-[9px] text-white">
          <Icon weight="bold" className="size-[17px]" />
        </span>
        <h3 className="flex-1 text-[16px] font-bold text-foreground">{a.title}</h3>
        <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12.5px] font-bold", SOFT[a.status])}>
          <StatusIcon status={a.status} className="size-3.5" />
          {a.word}
        </span>
      </div>
      {a.bars ? (
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Bars n={a.bars} />
          <span>Serving cell signal</span>
        </div>
      ) : null}
      <p className="text-[15px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{a.say}</p>
      {a.todo && a.status !== "ok" ? (
        <p className="rounded-[10px] bg-sunken px-3 py-2 text-[14px] leading-relaxed text-ink-2">
          <b className="text-foreground">What to do:</b> {a.todo}
        </p>
      ) : null}
      {a.status !== "none" ? (
        <button
          onClick={() => onGo(a)}
          className="mt-auto inline-flex items-center gap-1 self-start text-[13px] font-bold text-link underline underline-offset-[3px] hover:no-underline"
        >
          See the details <ArrowRightIcon weight="bold" className="size-3.5" />
        </button>
      ) : null}
    </article>
  );
}

const STEP_STYLE: Record<Severity, { cls: string; icon: typeof XIcon }> = {
  critical: { cls: "bg-critical-soft text-critical-ink", icon: XIcon },
  warning: { cls: "bg-warning-soft text-warning-ink", icon: WarningIcon },
  ok: { cls: "bg-ok-soft text-ok-ink", icon: CheckIcon },
  info: { cls: "bg-info-soft text-info-ink", icon: InfoIcon },
};

const PROC_WORD: Record<Procedure["status"], { label: string; cls: string }> = {
  success: { label: "Completed", cls: "bg-ok-soft text-ok-ink" },
  failure: { label: "Failed", cls: "bg-critical-soft text-critical-ink" },
  "no-answer": { label: "No answer in log", cls: "bg-warning-soft text-warning-ink" },
  retried: { label: "Restarted", cls: "bg-warning-soft text-warning-ink" },
  open: { label: "Open", cls: "bg-info-soft text-info-ink" },
};

export function SummaryView({
  report,
  onOpen,
  onTab,
  onCopy,
  onReport,
}: {
  report: Report;
  /** absent in a shared report, which is read-only */
  onCopy?: () => void;
  onReport?: () => void;
  onOpen: (i: number) => void;
  onTab: (t: "flow" | "radio" | "messages" | "crashes" | "files") => void;
}) {
  const s = report.session!;
  const reduce = useReducedMotion();
  const h = buildHeadline(report);
  const areas = buildAreas(report);
  const k = s.kpis;
  const ts = (i: number) => report.messages[i]?.timestamp;
  const issues = s.findings.filter((f) => f.severity === "critical" || f.severity === "warning");
  const notes = s.findings.filter((f) => f.severity === "info" || f.severity === "ok");
  const enter = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, transform: "translateY(8px)" },
          animate: { opacity: 1, transform: "translateY(0px)" },
          transition: { duration: 0.28, delay: i * 0.045, ease: EASE },
        };
  const go = (a: Area) => {
    if (a.target.tab === "messages" && a.target.index != null) onOpen(a.target.index);
    else onTab(a.target.tab);
  };
  const meta = [
    k.durationMs != null ? (
      <span key="d">
        log of <b className="text-foreground">{fmtMs(k.durationMs)}</b>
      </span>
    ) : null,
    <span key="m">
      <b className="text-foreground">{k.messages}</b> {k.messages === 1 ? "message" : "messages"}
      {k.failedDecode ? `, ${k.failedDecode} not decoded` : ""}
    </span>,
    k.rats.length ? <span key="r">{k.rats.join(" and ")}</span> : null,
    k.handovers ? <span key="h">{k.handovers === 1 ? "1 handover" : `${k.handovers} handovers`}</span> : null,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-4">
      <motion.section {...enter(0)} data-verdict={h.overall} className="relative overflow-hidden rounded-[22px] border border-border bg-panel px-[clamp(18px,3vw,36px)] pb-6 pt-7 shadow-soft">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1.5" style={{ background: TOP_BAR[h.overall] }} />
        <div className={cn("inline-flex items-center gap-2 rounded-full px-3.5 py-[5px] text-[13.5px] font-bold", SOFT[h.overall])}>
          <StatusIcon status={h.overall} className="size-4" />
          {h.kick}
        </div>
        <h2 className="mt-3.5 max-w-[64ch] text-[clamp(21px,2.6vw,30px)] font-bold leading-[1.3] tracking-[-0.015em] text-foreground [overflow-wrap:anywhere]">
          {h.head}
        </h2>
        {h.detail ? <p className="mt-2 max-w-[80ch] text-[16px] leading-relaxed text-ink-2">{h.detail}</p> : null}
        {h.todo ? (
          <div className="mt-4 flex max-w-[78ch] flex-wrap items-baseline gap-x-3 gap-y-1.5 rounded-[14px] border border-[rgb(12_163_12/0.2)] bg-ok-soft px-4 py-3 text-[16px] leading-normal">
            <b className="inline-flex items-center gap-1.5 whitespace-nowrap text-ok-ink">
              <CheckIcon weight="bold" className="size-4" />
              What to do
            </b>
            <span className="text-foreground">{h.todo}</span>
          </div>
        ) : null}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[14px] text-ink-2">
          {meta.map((m, i) => (
            <span key={i} className="inline-flex items-center gap-3">
              {i ? <span aria-hidden className="h-3.5 w-px bg-line-3" /> : null}
              {m}
            </span>
          ))}
          {h.refs.length ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-3.5 w-px bg-line-3" />
              evidence
              {h.refs.slice(0, 4).map((r) => (
                <button key={r} onClick={() => onOpen(r)} className="font-mono text-[12.5px] font-semibold text-link underline underline-offset-2">
                  #{r + 1}
                </button>
              ))}
            </span>
          ) : null}
        </div>
        <div className="no-print mt-[18px] flex flex-wrap gap-2">
          {onCopy ? (
            <button
              onClick={onCopy}
              className="btn-primary press inline-flex h-[38px] items-center gap-2 rounded-[11px] px-4 text-[13.5px] font-semibold"
            >
              <CopyIcon weight="bold" className="size-[18px]" /> Copy the summary
            </button>
          ) : null}
          {onReport ? (
            <>
              <GhostButton icon={FileHtmlIcon} onClick={onReport}>
                HTML report
              </GhostButton>
              <GhostButton icon={FileTextIcon} onClick={() => window.print()}>
                Print or save as PDF
              </GhostButton>
            </>
          ) : null}
          <GhostButton icon={FlowArrowIcon} onClick={() => onTab("flow")}>
            Signalling flow
          </GhostButton>
          {s.radio.points.length || s.radio.modem?.points.length ? (
            <GhostButton icon={ChartLineIcon} onClick={() => onTab("radio")}>
              Radio quality
            </GhostButton>
          ) : null}
        </div>
      </motion.section>

      {report.capture ? <CrashSummary capture={report.capture} onAll={() => onTab("crashes")} /> : null}

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 min-[1500px]:grid-cols-4">
        {areas.map((a, i) => (
          <motion.div key={a.id} {...enter(i + 1)} className="flex">
            <div className="flex w-full">
              <AreaTile a={a} onGo={go} />
            </div>
          </motion.div>
        ))}
      </div>

      {s.narrative.steps.length ? (
        <motion.section {...enter(5)} className="surface rounded-2xl px-[18px] py-4">
          <CardHead icon={ClockIcon} title="What happened, in order" sub="The procedures and failures that matter, in log order. Select one to open its message." />
          <ol className="grid gap-0.5">
            {s.narrative.steps.map((st, i) => {
              const S = STEP_STYLE[st.severity];
              return (
                <li key={i}>
                  <button
                    onClick={() => onOpen(st.i)}
                    className="grid w-full grid-cols-[96px_26px_minmax(0,1fr)] items-center gap-2.5 rounded-[10px] px-1.5 py-2 text-left text-[15px] leading-snug transition-[background-color,box-shadow] duration-150 hover:bg-accent hover:shadow-[inset_0_0_0_1px_rgb(0_105_200/0.5)]"
                  >
                    <span className="font-mono text-[13px] font-semibold text-ink-2">{ts(st.i) ?? `#${st.i + 1}`}</span>
                    <span className={cn("grid size-6 place-items-center rounded-full", S.cls)}>
                      <S.icon weight="bold" className="size-3.5" />
                    </span>
                    <span className="text-foreground">{st.text}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </motion.section>
      ) : null}

      {issues.length ? (
        <section className="surface rounded-2xl px-[18px] py-4">
          <CardHead icon={ListChecksIcon} title="Findings" sub="Every failure and warning, with likely causes and the checks to run." />
          <div className="flex flex-col gap-2.5">
            {issues.map((f, i) => (
              <FindingCard key={`${f.title}-${i}`} f={f} onOpen={onOpen} defaultOpen={i === 0} />
            ))}
            {notes.length ? (
              <details className="group rounded-xl border border-border bg-sunken/60">
                <summary className="cursor-pointer list-none px-3.5 py-2.5 text-[13.5px] font-semibold text-foreground marker:hidden">
                  {notes.length} informational {notes.length === 1 ? "note" : "notes"}
                  <span className="ml-1 font-normal text-muted-foreground group-open:hidden">(show)</span>
                </summary>
                <div className="flex flex-col gap-2 p-2 pt-0">
                  {notes.map((f, i) => (
                    <FindingCard key={`${f.title}-n${i}`} f={f} onOpen={onOpen} />
                  ))}
                </div>
              </details>
            ) : null}
          </div>
        </section>
      ) : null}

      {s.procedures.length ? (
        <section className="surface rounded-2xl px-[18px] py-4">
          <CardHead icon={CheckCircleIcon} title="Procedures" sub="Each 3GPP procedure the log starts, and how it ended." />
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[560px] text-left text-[14px]">
              <thead>
                <tr className="text-[12.5px] text-muted-foreground">
                  <th className="px-2 pb-2 font-semibold">Procedure</th>
                  <th className="px-2 pb-2 font-semibold">Result</th>
                  <th className="px-2 pb-2 font-semibold">Duration</th>
                  <th className="px-2 pb-2 font-semibold">Messages</th>
                </tr>
              </thead>
              <tbody>
                {s.procedures.map((p, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2 py-2.5 font-semibold text-foreground">{p.name}</td>
                    <td className="px-2 py-2.5">
                      <span className={cn("rounded-full px-2.5 py-[3px] text-[12.5px] font-bold", PROC_WORD[p.status].cls)}>{PROC_WORD[p.status].label}</span>
                    </td>
                    <td className="px-2 py-2.5 font-mono text-[13px] text-ink-2">{p.durationMs != null ? fmtMs(p.durationMs) : "n/a"}</td>
                    <td className="px-2 py-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {p.steps.slice(0, 6).map((x) => (
                          <button
                            key={x}
                            onClick={() => onOpen(x)}
                            className="font-mono text-[12.5px] font-semibold text-link underline underline-offset-2 hover:no-underline"
                          >
                            #{x + 1}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {report.capture?.files?.length ? <FilesSummary capture={report.capture} onAll={() => onTab("files")} /> : null}

      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <InfoIcon weight="bold" className="size-[15px]" />
        Written from the log itself by Skyworth 3GPP Decoder, on this computer. Nothing was sent anywhere.
      </p>
    </div>
  );
}

export function GhostButton({
  icon: Icon,
  onClick,
  children,
}: {
  icon: typeof ClockIcon;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="press inline-flex h-[38px] items-center gap-2 whitespace-nowrap rounded-[11px] border border-line-2 bg-white/70 px-4 text-[13.5px] font-semibold text-foreground transition-[background-color,border-color] duration-150 hover:border-line-3 hover:bg-accent"
    >
      <Icon weight="bold" className="size-[18px]" />
      {children}
    </button>
  );
}
