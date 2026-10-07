import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRightIcon,
  BugIcon,
  CheckCircleIcon,
  CpuIcon,
  FileMagnifyingGlassIcon,
  ListMagnifyingGlassIcon,
  StackIcon,
  TextAlignLeftIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { crashFound, type AssertRecord, type CaptureInfo, type CrashGroup, type MessageEntry } from "@/lib/engine/types";
import { KIND_LABEL, SURE, crashCounts, crashHeadline, dumpOnly, messagesBefore } from "@/lib/crashes";
import { CardHead } from "./summary-view";
import { Chip } from "./bits";
import { cn } from "@/lib/utils";

const EASE = [0.23, 1, 0.32, 1] as const;

function Field({ label, children, mono, wide }: { label: string; children: React.ReactNode; mono?: boolean; wide?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-[12px] border border-border bg-panel-2 px-3.5 py-2.5", wide && "sm:col-span-2")}>
      <dt className="text-[12px] font-semibold text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-[14px] leading-relaxed text-foreground [overflow-wrap:anywhere]", mono && "font-mono text-[13px] font-semibold")}>{children}</dd>
    </div>
  );
}

function EventCard({ e, messages, onOpen }: { e: AssertRecord; messages: MessageEntry[]; onOpen?: (i: number) => void }) {
  const dump = dumpOnly(e);
  const before = messagesBefore(messages, e.ts);
  return (
    <article data-crash-event={e.kind} className="rounded-[18px] border border-border bg-panel px-[18px] pb-4 pt-[18px] shadow-[inset_0_4px_0_var(--st-bad),var(--lift)]">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-critical-soft text-critical-ink">
          <BugIcon weight="bold" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-bold leading-snug tracking-[-0.01em] text-foreground [overflow-wrap:anywhere]">{e.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip tone="critical">{dump ? "Memory dump" : KIND_LABEL[e.kind]}</Chip>
            <Chip tone="mono" title="The file it was read from">
              {e.file}
            </Chip>
            {e.ts ? <Chip tone="mono">at {e.ts}</Chip> : null}
          </div>
        </div>
      </div>

      {dump ? (
        <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">
          The modem writes this file only when it crashes. It holds no readable assert text; UNISOC&apos;s tools read the cause from it, so send it with the
          .logel.
        </p>
      ) : (
        <dl className="mt-3.5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {e.source ? (
            <Field label="Where it stopped" mono wide>
              {e.source}
              {e.line ? <span className="text-critical-ink"> line {e.line}</span> : null}
            </Field>
          ) : null}
          {e.module ? <Field label="Modem part">{e.module}</Field> : null}
          {e.task ? (
            <Field label="Task" mono>
              {e.task}
            </Field>
          ) : null}
          {e.expression ? (
            <Field label="Check that failed" mono wide>
              {e.expression}
            </Field>
          ) : null}
          {e.message ? (
            <Field label="Message" wide>
              {e.message}
            </Field>
          ) : null}
          {e.exception ? <Field label="Exception">{e.exception}</Field> : null}
          {e.ts ? (
            <Field label="Time" mono>
              {e.ts}
            </Field>
          ) : null}
          {e.version ? (
            <Field label="Software" mono wide>
              {e.version}
            </Field>
          ) : null}
        </dl>
      )}

      {before.length && onOpen ? (
        <div className="mt-3.5">
          <h4 className="mb-1.5 text-[13px] font-bold text-foreground">Just before it in the log</h4>
          <ol className="grid gap-1">
            {before.map((m) => (
              <li key={m.index}>
                <button
                  onClick={() => onOpen(m.index)}
                  className="grid w-full grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left text-[14px] transition-[background-color,box-shadow] duration-150 hover:bg-accent hover:shadow-[inset_0_0_0_1px_rgb(0_105_200/0.5)]"
                >
                  <span className="font-mono text-[12.5px] font-semibold text-ink-2">{m.timestamp}</span>
                  <span className="truncate font-semibold text-foreground">{m.result.ok ? m.result.message?.title : "Could not decode"}</span>
                  <span className="font-mono text-[11.5px] font-semibold text-link">#{m.index + 1}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {e.registers.length ? (
        <div className="mt-3.5">
          <h4 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-foreground">
            <CpuIcon weight="bold" className="size-4 text-blue" /> Registers
          </h4>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-6">
            {e.registers.map((r) => (
              <div key={r.name} className="flex items-baseline justify-between gap-2 rounded-[9px] border border-border bg-panel-2 px-2.5 py-1.5 font-mono text-[12.5px]">
                <span className="font-semibold text-muted-foreground">{r.name}</span>
                <span className="font-semibold text-foreground">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {e.stack.length ? (
        <div className="mt-3.5">
          <h4 className="mb-1.5 flex items-center gap-1.5 text-[13px] font-bold text-foreground">
            <StackIcon weight="bold" className="size-4 text-blue" /> Call stack
            <span className="font-medium text-muted-foreground">({e.stack.length} {e.stack.length === 1 ? "frame" : "frames"}, innermost first)</span>
          </h4>
          <ol className="max-h-[300px] overflow-auto rounded-[12px] border border-border bg-panel-2 py-1 scrollbar-thin">
            {e.stack.map((f, i) => {
              // a record that numbers its own frames (#0, #1 ...) keeps its numbers
              const m = /^(#\d+|\[\s*\d+\s*\])\s*(.*)$/.exec(f);
              return (
                <li key={i} className="grid grid-cols-[34px_minmax(0,1fr)] gap-2 px-3 py-[3px] font-mono text-[12.5px] text-foreground">
                  <span className="text-right text-muted-foreground">{m ? m[1] : i}</span>
                  <span className="[overflow-wrap:anywhere]">{m ? m[2] : f}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}

      {e.raw ? (
        <details className="group mt-3.5 rounded-[12px] border border-border bg-panel-2">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3.5 py-2.5 text-[13px] font-bold text-foreground marker:hidden">
            <TextAlignLeftIcon weight="bold" className="size-4 text-blue" />
            The whole record, as written
            <span className="font-medium text-muted-foreground group-open:hidden">(show)</span>
          </summary>
          <pre className="max-h-[420px] overflow-auto border-t border-border px-3.5 py-2.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2 scrollbar-thin [overflow-wrap:anywhere]">
            {e.raw}
          </pre>
        </details>
      ) : null}
    </article>
  );
}

function GroupRows({ groups }: { groups: CrashGroup[] }) {
  return (
    <div className="overflow-x-auto rounded-[12px] border border-border bg-panel scrollbar-thin">
      <table className="w-full min-w-[720px] text-left text-[13.5px]">
        <thead>
          <tr className="border-b border-border bg-panel-2 text-[12px] text-muted-foreground">
            <th className="px-3.5 py-2 font-semibold">Kind</th>
            <th className="px-3 py-2 font-semibold">Line in the log</th>
            <th className="px-3 py-2 font-semibold">First seen</th>
            <th className="px-3 py-2 text-right font-semibold">Times</th>
            <th className="px-3 py-2 font-semibold">Found in</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={i} data-crash-line={g.strong ? "strong" : "weak"} className="align-top even:bg-[rgb(11_27_52/0.022)]">
              <td className="px-3.5 py-2">
                <span
                  className={cn(
                    "inline-flex whitespace-nowrap rounded-full px-2 py-px text-[12px] font-bold",
                    g.strong ? (SURE.includes(g.kind) ? "bg-critical-soft text-critical-ink" : "bg-warning-soft text-warning-ink") : "bg-sunken text-ink-2",
                  )}
                >
                  {KIND_LABEL[g.kind]}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-[12.5px] text-foreground [overflow-wrap:anywhere]">{g.text}</td>
              <td className="whitespace-nowrap px-3 py-2 font-mono text-[12.5px] text-ink-2">
                {g.first ?? "n/a"}
                {g.last && g.last !== g.first ? <div className="text-muted-foreground">to {g.last}</div> : null}
              </td>
              <td className="px-3 py-2 text-right font-mono text-[12.5px] font-semibold tabular-nums text-foreground">{g.count}</td>
              <td className="px-3 py-2 font-mono text-[12px] text-ink-2">
                {Object.entries(g.files).map(([f, n]) => (
                  <div key={f} className="break-all">
                    {f}
                    {n > 1 ? <span className="text-muted-foreground"> x{n}</span> : null}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Asserts and crashes: every record read field by field, and every matching line in any file. */
export function CrashView({ capture, messages, onOpen }: { capture: CaptureInfo; messages: MessageEntry[]; onOpen?: (i: number) => void }) {
  const c = capture.crashes;
  const reduce = useReducedMotion();
  const n = crashCounts(c);
  const found = crashFound(c);
  const enter = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, transform: "translateY(8px)" },
          animate: { opacity: 1, transform: "translateY(0px)" },
          transition: { duration: 0.28, delay: i * 0.045, ease: EASE },
        };
  const h = crashHeadline(c);
  return (
    <div className="flex flex-col gap-4">
      <motion.section
        {...enter(0)}
        data-crash-verdict={found ? "bad" : "ok"}
        className="relative overflow-hidden rounded-[22px] border border-border bg-panel px-[clamp(18px,3vw,36px)] pb-6 pt-7 shadow-soft"
      >
        <span
          aria-hidden
          className="absolute inset-x-0 top-0 h-1.5"
          style={{ background: found ? "linear-gradient(90deg,#c21d3a,#e0485f)" : "linear-gradient(90deg,#12924a,#2fb86a)" }}
        />
        <div className={cn("inline-flex items-center gap-2 rounded-full px-3.5 py-[5px] text-[13.5px] font-bold", found ? "bg-critical-soft text-critical-ink" : "bg-ok-soft text-ok-ink")}>
          {found ? <XCircleIcon weight="bold" className="size-4" /> : <CheckCircleIcon weight="bold" className="size-4" />}
          {h.kick}
        </div>
        <h2 className="mt-3.5 max-w-[70ch] text-[clamp(20px,2.4vw,28px)] font-bold leading-[1.3] tracking-[-0.015em] text-foreground [overflow-wrap:anywhere]">{h.head}</h2>
        <p className="mt-2 max-w-[86ch] text-[15.5px] leading-relaxed text-ink-2">{h.detail}</p>
        {h.todo ? (
          <div className="mt-4 flex max-w-[80ch] flex-wrap items-baseline gap-x-3 gap-y-1.5 rounded-[14px] border border-[rgb(12_163_12/0.2)] bg-ok-soft px-4 py-3 text-[15.5px] leading-normal">
            <b className="whitespace-nowrap text-ok-ink">What to do</b>
            <span className="text-foreground">{h.todo}</span>
          </div>
        ) : null}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ["Assert records", n.records],
            ["Crash lines", n.strongLines],
            ["Mentions", n.weakLines],
            ["Files searched", n.searched],
          ].map(([label, v]) => (
            <div key={label} className="rounded-[14px] border border-border bg-panel-2 px-3.5 py-2.5">
              <div className="text-[12.5px] font-semibold text-muted-foreground">{label}</div>
              <div className={cn("mt-0.5 font-mono text-[22px] font-bold tabular-nums", (label === "Assert records" || label === "Crash lines") && Number(v) > 0 ? "text-critical-ink" : "text-foreground")}>
                {v}
              </div>
            </div>
          ))}
        </div>
      </motion.section>

      {c?.events.map((e, i) => (
        <motion.div key={`${e.file}-${i}`} {...enter(i + 1)}>
          <EventCard e={e} messages={messages} onOpen={onOpen} />
        </motion.div>
      ))}

      {n.strong.length ? (
        <motion.section {...enter(2)} className="surface rounded-2xl px-[18px] py-4">
          <CardHead
            icon={ListMagnifyingGlassIcon}
            title="Assert and crash lines"
            sub="Every line that shows an assert, exception, watchdog, reset or memory failure, grouped when the same line repeats. Times are the modem's log time."
          />
          <GroupRows groups={n.strong} />
        </motion.section>
      ) : null}

      {n.weak.length ? (
        <section className="surface rounded-2xl px-[18px] py-4">
          <details className="group">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 marker:hidden">
              <span className="grad grid size-[30px] shrink-0 place-items-center rounded-[9px] text-white">
                <TextAlignLeftIcon weight="bold" className="size-[17px]" />
              </span>
              <span className="text-[15.5px] font-bold text-foreground">
                {n.weakLines} {n.weakLines === 1 ? "line mentions" : "lines mention"} an assert or crash in passing
              </span>
              <span className="text-[13px] text-muted-foreground">Trace words, not proof of a crash. Kept so nothing is missed.</span>
              <span className="ml-auto inline-flex items-center gap-1 text-[13px] font-bold text-link">
                <span className="group-open:hidden">Show</span>
                <span className="hidden group-open:inline">Hide</span>
                <ArrowRightIcon weight="bold" className="size-3.5 transition-transform duration-200 group-open:rotate-90" />
              </span>
            </summary>
            <div className="mt-3">
              <GroupRows groups={n.weak} />
            </div>
          </details>
        </section>
      ) : null}

      {c?.searched.length ? (
        <section className="surface rounded-2xl px-[18px] py-4">
          <CardHead icon={FileMagnifyingGlassIcon} title="Files searched" sub="Each file was read in full, however large, and every line was checked." />
          <ul className="flex flex-wrap gap-1.5">
            {c.searched.map((f) => {
              const hits = n.strong.filter((g) => g.files[f]).length || c.events.filter((e) => e.file === f).length;
              return (
                <li
                  key={f}
                  className={cn(
                    "break-all rounded-md border px-2 py-0.5 font-mono text-[12px]",
                    hits ? "border-transparent bg-critical-soft font-semibold text-critical-ink" : "border-border bg-panel text-ink-2",
                  )}
                >
                  {f}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** On the summary page: the crash, before anything else, with a way to its details. */
export function CrashSummary({ capture, onAll }: { capture: CaptureInfo; onAll: () => void }) {
  const c = capture.crashes;
  if (!crashFound(c)) return null;
  const n = crashCounts(c);
  const items = [
    ...c!.events.map((e) => ({ kind: e.kind, title: e.title, ts: e.ts ?? null, sub: [e.task && `task ${e.task}`, e.expression].filter(Boolean).join(": ") || e.file })),
    ...(c!.events.length ? [] : n.strong.slice(0, 3).map((g) => ({ kind: g.kind, title: g.text, ts: g.first, sub: `${g.count}x in ${Object.keys(g.files).join(", ")}` }))),
  ];
  return (
    <section data-crash-summary className="surface rounded-2xl px-[18px] py-4 shadow-[inset_0_3px_0_var(--st-bad),var(--lift)]">
      <CardHead
        icon={BugIcon}
        title="The modem crashed"
        sub={`${n.records ? `${n.records} assert ${n.records === 1 ? "record" : "records"}` : "No assert record"}, ${n.strongLines} assert or crash ${n.strongLines === 1 ? "line" : "lines"} in ${n.searched} files searched.`}
        aside={
          <button onClick={onAll} className="text-[13px] font-bold text-link underline underline-offset-[3px] hover:no-underline">
            See the asserts
          </button>
        }
      />
      <ul className="divide-y divide-border rounded-[12px] border border-border bg-panel-2">
        {items.map((it, i) => (
          <li key={i} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 px-3.5 py-3 sm:grid-cols-[22px_minmax(0,1fr)_auto]">
            <BugIcon weight="fill" className="mt-0.5 size-[18px] text-critical" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14.5px] font-bold text-foreground [overflow-wrap:anywhere]">{it.title}</span>
                <span className="rounded-full bg-critical-soft px-2 py-px text-[11.5px] font-bold text-critical-ink">{KIND_LABEL[it.kind]}</span>
              </div>
              <p className="mt-0.5 font-mono text-[12.5px] text-ink-2 [overflow-wrap:anywhere]">{it.sub}</p>
            </div>
            <span className="col-start-2 font-mono text-[12.5px] text-muted-foreground sm:col-start-3 sm:text-right">{it.ts ?? ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

