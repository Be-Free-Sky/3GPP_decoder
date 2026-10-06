"use client";

import { motion, useReducedMotion } from "motion/react";
import { CheckCircleIcon, MagnifyingGlassIcon, WarningIcon, WrenchIcon, XCircleIcon } from "@phosphor-icons/react";
import type { Procedure, Report } from "@/lib/engine/types";
import { fmtMs } from "@/lib/format";
import { Chip, MsgRef, SectionTitle, SeverityIcon } from "./bits";
import { FindingCard } from "./finding-card";
import { cn } from "@/lib/utils";

const EASE = [0.23, 1, 0.32, 1] as const;

const PROC_STATUS: Record<Procedure["status"], { label: string; tone: "brand" | "critical" | "warning" | "neutral" }> = {
  success: { label: "Completed", tone: "brand" },
  failure: { label: "Failed", tone: "critical" },
  "no-answer": { label: "No answer in log", tone: "warning" },
  retried: { label: "Restarted", tone: "warning" },
  open: { label: "Open", tone: "neutral" },
};

export function OverviewView({ report, onOpen }: { report: Report; onOpen: (i: number) => void }) {
  const s = report.session!;
  const reduce = useReducedMotion();
  const root = s.narrative.root;
  const crit = s.findings.filter((f) => f.severity === "critical");
  const warn = s.findings.filter((f) => f.severity === "warning");
  const notes = s.findings.filter((f) => f.severity === "info" || f.severity === "ok");
  const verdictTitle =
    s.verdict === "failure"
      ? `${crit.length} ${crit.length === 1 ? "failure" : "failures"} found`
      : s.verdict === "warning"
        ? `${warn.length} ${warn.length === 1 ? "warning" : "warnings"}, no failures`
        : "No problems found";
  const VerdictIcon = s.verdict === "failure" ? XCircleIcon : s.verdict === "warning" ? WarningIcon : CheckCircleIcon;

  const k = s.kpis;
  const stats = [
    { label: "Messages decoded", value: `${k.decoded}/${k.messages}` },
    { label: "Procedures completed", value: `${k.procedures.success ?? 0}`, sub: `${k.procedures.failure ?? 0} failed` },
    { label: "Handovers", value: `${k.handovers}`, sub: `${k.reestablishments} re-establishments` },
    { label: "Log duration", value: fmtMs(k.durationMs) },
    { label: "Radio access", value: k.rats.join(" + ") || "n/a" },
  ];

  const enter = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, transform: "translateY(6px)" },
          animate: { opacity: 1, transform: "translateY(0px)" },
          transition: { duration: 0.24, delay: i * 0.05, ease: EASE },
        };

  return (
    <div className="flex flex-col gap-6">
      <motion.section
        {...enter(0)}
        className={cn(
          "relative overflow-hidden rounded-2xl border p-5",
          s.verdict === "failure"
            ? "border-critical/25 bg-gradient-to-br from-white via-white to-critical/[0.06]"
            : s.verdict === "warning"
              ? "border-warning/30 bg-gradient-to-br from-white via-white to-warning/[0.07]"
              : "border-brand-3/25 bg-gradient-to-br from-white via-white to-brand-3/[0.08]",
        )}
      >
        <div aria-hidden className="brand-gradient absolute inset-x-0 top-0 h-[3px]" />
        <div className="flex items-start gap-3">
          <VerdictIcon
            weight="fill"
            className={cn(
              "mt-0.5 size-7 shrink-0",
              s.verdict === "failure" ? "text-critical" : s.verdict === "warning" ? "text-warning" : "text-brand-3",
            )}
          />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight text-foreground">{verdictTitle}</h2>
            <p className="mt-1 max-w-[70ch] text-[14px] leading-relaxed text-muted-foreground">
              {root
                ? `First failure: ${root.title}.`
                : s.verdict === "warning"
                  ? "Procedures completed, but some radio or protocol conditions need attention."
                  : "All procedures in this log completed and no error causes were reported."}
            </p>
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-y-4 border-t border-hairline pt-4 sm:grid-cols-3 xl:grid-cols-5">
          {stats.map((st, i) => (
            <div key={st.label} className={cn("min-w-0 pr-4", i > 0 && "xl:border-l xl:border-hairline xl:pl-4")}>
              <dt className="text-[11.5px] text-muted-foreground">{st.label}</dt>
              <dd className="mt-0.5 text-lg font-semibold tracking-tight text-foreground">{st.value}</dd>
              {st.sub ? <dd className="text-[11.5px] text-muted-foreground">{st.sub}</dd> : null}
            </div>
          ))}
        </dl>
      </motion.section>

      {root ? (
        <motion.section {...enter(1)} className="rounded-2xl border border-border bg-raised p-5">
          <div className="text-[11.5px] font-medium text-critical">Root cause</div>
          <h3 className="mt-1 text-[17px] font-semibold tracking-tight text-foreground">{root.title}</h3>
          {root.detail ? <p className="mt-1.5 max-w-[75ch] text-[13.5px] leading-relaxed text-muted-foreground">{root.detail}</p> : null}
          {root.refs.length ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              Evidence {root.refs.map((r) => <MsgRef key={r} i={r} onOpen={onOpen} />)}
            </div>
          ) : null}
          {root.causes.length || root.checks.length ? (
            <div className="mt-4 grid gap-4 border-t border-hairline pt-4 md:grid-cols-2">
              {root.causes.length ? (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                    <MagnifyingGlassIcon className="size-4 text-brand-3" /> Likely causes
                  </div>
                  <ol className="grid gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
                    {root.causes.map((c, i) => (
                      <li key={c} className="flex gap-2.5">
                        <span className="mt-px grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold tabular-nums text-foreground">
                          {i + 1}
                        </span>
                        {c}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
              {root.checks.length ? (
                <div>
                  <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                    <WrenchIcon className="size-4 text-brand-3" /> What to check
                  </div>
                  <ul className="grid gap-1.5 text-[13px] leading-relaxed text-muted-foreground">
                    {root.checks.map((c) => (
                      <li key={c} className="flex gap-2.5">
                        <span aria-hidden className="mt-[8px] size-1.5 shrink-0 rounded-full bg-brand-3" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}
        </motion.section>
      ) : null}

      <div className="grid gap-6 2xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
        <motion.section {...enter(2)} className="flex min-w-0 flex-col gap-2">
          <SectionTitle aside={<span className="text-xs text-muted-foreground">{s.findings.length} total</span>}>Findings</SectionTitle>
          {s.findings.length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing to report.</p> : null}
          {[...crit, ...warn].map((f, i) => (
            <FindingCard key={`${f.title}-${i}`} f={f} onOpen={onOpen} defaultOpen={i === 0 && !root} />
          ))}
          {notes.length ? (
            <details className="group rounded-xl border border-border bg-raised">
              <summary className="cursor-pointer list-none px-3.5 py-2.5 text-[13px] font-medium text-foreground marker:hidden">
                {notes.length} informational {notes.length === 1 ? "note" : "notes"}
                <span className="ml-1 text-muted-foreground group-open:hidden">(show)</span>
              </summary>
              <div className="flex flex-col gap-2 p-2 pt-0">
                {notes.map((f, i) => (
                  <FindingCard key={`${f.title}-n${i}`} f={f} onOpen={onOpen} />
                ))}
              </div>
            </details>
          ) : null}
        </motion.section>

        <motion.section {...enter(3)} className="flex min-w-0 flex-col gap-2">
          <SectionTitle>What happened</SectionTitle>
          {s.narrative.steps.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No complete procedures were recognised in this log.</p>
          ) : (
            <ol className="relative ml-2 border-l border-border pl-5">
              {s.narrative.steps.map((st, i) => (
                <li key={i} className="relative pb-3.5 last:pb-0">
                  <span className="absolute -left-[29px] top-0.5 grid size-[18px] place-items-center rounded-full bg-background">
                    <SeverityIcon severity={st.severity} className="size-[18px]" />
                  </span>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <MsgRef i={st.i} onOpen={onOpen} />
                    <span className="text-[13px] leading-relaxed text-foreground">{st.text}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </motion.section>
      </div>

      {s.procedures.length ? (
        <motion.section {...enter(4)} className="flex flex-col gap-2">
          <SectionTitle>Procedures</SectionTitle>
          <div className="overflow-x-auto rounded-xl border border-border bg-raised scrollbar-thin">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead>
                <tr className="border-b border-border text-[11.5px] text-muted-foreground">
                  <th className="px-3.5 py-2 font-medium">Procedure</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 font-medium">Duration</th>
                  <th className="px-3 py-2 font-medium">Messages</th>
                </tr>
              </thead>
              <tbody>
                {s.procedures.map((p, i) => {
                  const st = PROC_STATUS[p.status];
                  return (
                    <tr key={i} className="border-b border-hairline last:border-0">
                      <td className="px-3.5 py-2 font-medium text-foreground">{p.name}</td>
                      <td className="px-3 py-2">
                        <Chip tone={st.tone}>{st.label}</Chip>
                      </td>
                      <td className="px-3 py-2 font-mono text-[12px] tabular-nums text-muted-foreground">
                        {p.durationMs != null ? fmtMs(p.durationMs) : "n/a"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {p.steps.slice(0, 6).map((x) => (
                            <MsgRef key={x} i={x} onOpen={onOpen} />
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </motion.section>
      ) : null}
    </div>
  );
}
