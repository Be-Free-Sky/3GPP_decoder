import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRightIcon,
  BugIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CpuIcon,
  DatabaseIcon,
  FileMagnifyingGlassIcon,
  FloppyDiskIcon,
  HandIcon,
  ListMagnifyingGlassIcon,
  MemoryIcon,
  StackIcon,
  TextAlignLeftIcon,
  UsersThreeIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { AssertRecord, CaptureInfo, CoreAssert, CrashGroup, MemoryUse, MessageEntry } from "@/lib/engine/types";
import { KIND_LABEL, SURE, crashCounts, crashHeadline, crashTone, dumpOnly, messagesBefore } from "@/lib/crashes";
import { sizeText } from "@/lib/capture";
import { CardHead } from "./summary-view";
import { Chip } from "./bits";
import { cn } from "@/lib/utils";

const EASE = [0.23, 1, 0.32, 1] as const;

const TOP: Record<"bad" | "warn" | "ok", string> = {
  bad: "linear-gradient(90deg,#c21d3a,#e0485f)",
  warn: "linear-gradient(90deg,#c98500,#e8a93b)",
  ok: "linear-gradient(90deg,#12924a,#2fb86a)",
};
const SOFT: Record<"bad" | "warn" | "ok", string> = {
  bad: "bg-critical-soft text-critical-ink",
  warn: "bg-warning-soft text-warning-ink",
  ok: "bg-ok-soft text-ok-ink",
};

function Field({ label, children, mono, wide }: { label: string; children: React.ReactNode; mono?: boolean; wide?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-[12px] border border-border bg-panel-2 px-3.5 py-2.5", wide && "sm:col-span-2")}>
      <dt className="text-[12px] font-semibold text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 text-[14px] leading-relaxed text-foreground [overflow-wrap:anywhere]", mono && "font-mono text-[13px] font-semibold")}>{children}</dd>
    </div>
  );
}

function SubHead({ icon: Icon, children, note }: { icon: typeof CpuIcon; children: React.ReactNode; note?: string }) {
  return (
    <h4 className="mb-1.5 flex flex-wrap items-center gap-x-1.5 text-[13px] font-bold text-foreground">
      <Icon weight="bold" className="size-4 text-blue" /> {children}
      {note ? <span className="font-medium text-muted-foreground">{note}</span> : null}
    </h4>
  );
}

/** A part of the record kept folded: it is there, but the card stays readable. */
function Fold({ icon: Icon, title, note, children, open }: { icon: typeof CpuIcon; title: string; note?: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="group mt-2.5 rounded-[12px] border border-border bg-panel-2" open={open}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-1.5 gap-y-0.5 px-3.5 py-2.5 text-[13px] font-bold text-foreground marker:hidden">
        <CaretRightIcon weight="bold" className="size-3 text-muted-foreground transition-transform duration-200 ease-(--ease-out) group-open:rotate-90" />
        <Icon weight="bold" className="size-4 text-blue" />
        {title}
        {note ? <span className="font-medium text-muted-foreground">{note}</span> : null}
      </summary>
      <div className="border-t border-border px-3.5 py-3">{children}</div>
    </details>
  );
}

function Pairs({ items }: { items: { label: string; value: string }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((p) => (
        <div key={p.label} className="flex min-w-0 items-baseline justify-between gap-3 border-b border-dashed border-line-2 py-1 text-[13px]">
          <dt className="shrink-0 text-muted-foreground">{p.label}</dt>
          <dd className="truncate font-mono font-semibold text-foreground" title={p.value}>
            {p.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Registers({ regs }: { regs: { name: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-6">
      {regs.map((r) => (
        <div key={r.name} className="flex items-baseline justify-between gap-2 rounded-[9px] border border-border bg-panel px-2.5 py-1.5 font-mono text-[12.5px]">
          <span className="font-semibold text-muted-foreground">{r.name}</span>
          <span className="font-semibold text-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function SmallTable({ head, rows, right = [] }: { head: string[]; rows: React.ReactNode[][]; right?: number[] }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-border bg-panel scrollbar-thin">
      <table className="w-full min-w-[520px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-border bg-panel-2 text-[12px] text-muted-foreground">
            {head.map((h, i) => (
              <th key={h} className={cn("px-3 py-1.5 font-semibold", right.includes(i) && "text-right")}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="align-top even:bg-[rgb(11_27_52/0.022)]">
              {r.map((c, k) => (
                <td key={k} className={cn("px-3 py-1.5", right.includes(k) && "text-right tabular-nums")}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const mono = (s: React.ReactNode, strong = false) => <span className={cn("font-mono text-[12.5px] [overflow-wrap:anywhere]", strong ? "font-semibold text-foreground" : "text-ink-2")}>{s}</span>;

function usageRows(list: MemoryUse[]) {
  return list.map((u) => [mono(u.site, true), mono(u.count.toLocaleString("en")), mono(sizeText(u.bytes))]);
}

function CoreRows({ cores, owner }: { cores: CoreAssert[]; owner?: string }) {
  return (
    <SmallTable
      head={["Core", "Task", "Where", "Check", "Info", "Time", "Found in"]}
      rows={cores.map((c) => [
        <span key="c" className="inline-flex items-center gap-1.5 whitespace-nowrap font-semibold text-foreground">
          {c.core}
          {owner && c.core === owner ? <span className="rounded-full bg-hover-2 px-1.5 text-[11px] font-bold text-ink-2">first</span> : null}
        </span>,
        mono(c.task ?? ""),
        mono(`${c.file} line ${c.line}`, true),
        mono(c.exp ?? ""),
        mono(c.info ?? ""),
        mono(c.ts ?? "n/a"),
        mono(c.from),
      ])}
    />
  );
}

function EventCard({ e, messages, onOpen }: { e: AssertRecord; messages: MessageEntry[]; onOpen?: (i: number) => void }) {
  const dump = dumpOnly(e);
  const before = messagesBefore(messages, e.ts);
  const tone = e.forced ? "warn" : "bad";
  const mem = e.memory;
  const owner = e.core;
  return (
    <article
      data-crash-event={e.forced ? "forced" : e.kind}
      className={cn(
        "rounded-[18px] border border-border bg-panel px-[18px] pb-4 pt-[18px]",
        tone === "warn" ? "shadow-[inset_0_4px_0_var(--st-warn),var(--lift)]" : "shadow-[inset_0_4px_0_var(--st-bad),var(--lift)]",
      )}
    >
      <div className="flex items-start gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-[11px]", SOFT[tone])}>
          {e.forced ? <HandIcon weight="bold" className="size-5" /> : <BugIcon weight="bold" className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-bold leading-snug tracking-[-0.01em] text-foreground [overflow-wrap:anywhere]">{e.title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Chip tone={tone === "warn" ? "warning" : "critical"}>{dump ? "Memory dump" : e.forced ? "Requested assert" : KIND_LABEL[e.kind]}</Chip>
            {owner ? <Chip>{owner}</Chip> : null}
            {e.number ? <Chip>{`${e.core && /^core/.test(e.core) ? e.core : "core"} assert ${e.number}`}</Chip> : null}
            <Chip tone="mono" title="The file it was read from">
              {e.file}
            </Chip>
            {e.also?.map((a) => (
              <Chip key={a} tone="mono" title="The same record is also here">
                also in {a}
              </Chip>
            ))}
            {e.ts ? <Chip tone="mono">at {e.ts}</Chip> : null}
          </div>
        </div>
      </div>

      {e.forced ? (
        <div className="mt-3.5 flex gap-2.5 rounded-[12px] border border-[rgb(201_133_0/0.25)] bg-warning-soft px-3.5 py-2.5 text-[14px] leading-relaxed text-foreground">
          <WarningIcon weight="fill" className="mt-0.5 size-[18px] shrink-0 text-warning" />
          <p>
            <b>Asked for, not a fault.</b> The assert info says <q className="font-mono text-[13px]">{e.message ?? e.forced}</q>: the modem stopped because it received{" "}
            <b className="font-mono text-[13px]">{e.forced}</b>
            {e.forcedBy?.ts ? ` at ${e.forcedBy.ts}` : ""}
            {e.forcedBy?.channel ? ` on AT channel ${e.forcedBy.channel}` : ""}. This is how a memory dump is taken on purpose, by hand, by a test tool, or by the host when
            the modem stops answering.
            {e.forcedBy?.line ? <span className="mt-1 block font-mono text-[12.5px] text-ink-2 [overflow-wrap:anywhere]">{e.forcedBy.line}</span> : null}
          </p>
        </div>
      ) : null}

      {dump ? (
        <p className="mt-3 text-[14.5px] leading-relaxed text-ink-2">
          The modem writes this file only when it stops (it crashed, or a dump was asked for). It holds no readable assert text; UNISOC&apos;s tools read the cause from
          it, so send it with the .logel.
        </p>
      ) : (
        <dl className="mt-3.5 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {e.source ? (
            <Field label="Where it stopped" mono wide>
              {e.source}
              {e.line ? <span className={tone === "warn" ? "text-warning-ink" : "text-critical-ink"}> line {e.line}</span> : null}
            </Field>
          ) : null}
          {e.module ? <Field label="Modem part">{e.module}</Field> : null}
          {e.task ? (
            <Field label="Task" mono>
              {e.task}
            </Field>
          ) : null}
          {e.expression ? (
            <Field label="Check" mono>
              {e.expression}
            </Field>
          ) : null}
          {e.message ? (
            <Field label="Assert info" wide>
              {e.message}
            </Field>
          ) : null}
          {e.exception ? <Field label="Exception">{e.exception}</Field> : null}
          {e.ts ? (
            <Field label="Time" mono>
              {e.ts}
            </Field>
          ) : null}
          {e.cpuMode ? (
            <Field label="CPU mode" mono>
              {e.cpuMode}
            </Field>
          ) : null}
          {e.version ? (
            <Field label="Software" mono wide>
              {e.version}
              {e.build ? <span className="block text-[12px] font-medium text-muted-foreground">built {e.build}</span> : null}
            </Field>
          ) : null}
        </dl>
      )}

      {e.cores?.length ? (
        <div className="mt-3.5">
          <SubHead icon={UsersThreeIcon} note={e.cores.length > 1 ? "the core that asserted first, and the ones stopped with it" : undefined}>
            Every core at that moment
          </SubHead>
          <CoreRows cores={e.cores} owner={owner} />
        </div>
      ) : null}

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

      {e.thread?.length ? (
        <Fold icon={StackIcon} title="The task that was running" note={e.task ? `(${e.task})` : undefined} open>
          <Pairs items={e.thread} />
        </Fold>
      ) : null}

      {e.registers.length || e.corePcs?.length || e.banked?.length ? (
        <Fold
          icon={CpuIcon}
          title="Registers"
          note={[
            e.registers.length ? `${e.registers.length} before the assert` : null,
            e.banked?.length ? `${e.banked.length} CPU modes` : null,
            e.corePcs?.length ? `PC of ${e.corePcs.length} cores` : null,
          ]
            .filter(Boolean)
            .join(", ")}
          open={!e.thread?.length}
        >
          {e.registers.length ? <Registers regs={e.registers} /> : null}
          {e.corePcs?.length ? (
            <div className="mt-3">
              <h5 className="mb-1 text-[12.5px] font-bold text-ink-2">Program counter of each core</h5>
              <SmallTable head={["Core", "PC (three samples)"]} rows={e.corePcs.map((c) => [mono(c.core, true), mono(c.pc)])} />
            </div>
          ) : null}
          {e.banked?.map((b) => (
            <div key={b.mode} className="mt-3">
              <h5 className="mb-1 text-[12.5px] font-bold text-ink-2">{b.mode} mode</h5>
              <Registers regs={b.registers} />
            </div>
          ))}
        </Fold>
      ) : null}

      {e.stack.length ? (
        <Fold icon={StackIcon} title="Call stack" note={`(${e.stack.length} ${e.stack.length === 1 ? "frame" : "frames"}, innermost first)`} open>
          <ol className="max-h-[300px] overflow-auto rounded-[10px] border border-border bg-panel py-1 scrollbar-thin">
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
        </Fold>
      ) : null}

      {e.dumps?.length ? (
        <Fold icon={FloppyDiskIcon} title="Files the assert saved" note={`(${e.dumps.filter((d) => d.present).length} of ${e.dumps.length} in this log)`}>
          <SmallTable
            head={["File", "What it holds", "Size", "In this log"]}
            right={[2]}
            rows={e.dumps.map((d) => [
              mono(d.file, true),
              <span key="w" className="text-ink-2">
                {d.what}
              </span>,
              mono(d.size ? sizeText(d.size) : ""),
              d.present ? (
                <span key="p" className="inline-flex items-center gap-1 font-semibold text-ok-ink">
                  <CheckCircleIcon weight="fill" className="size-3.5" /> Yes
                </span>
              ) : (
                <span key="p" className="inline-flex items-center gap-1 font-semibold text-warning-ink">
                  <WarningIcon weight="fill" className="size-3.5" /> Missing
                </span>
              ),
            ])}
          />
          {e.regions?.length ? (
            <div className="mt-3">
              <h5 className="mb-1 text-[12.5px] font-bold text-ink-2">Memory regions in the dump</h5>
              <SmallTable head={["Region", "Start", "Length"]} right={[2]} rows={e.regions.map((r) => [mono(r.name, true), mono(r.start), mono(sizeText(parseInt(r.length, 16)))])} />
            </div>
          ) : null}
        </Fold>
      ) : null}

      {mem ? (
        <Fold
          icon={MemoryIcon}
          title="Memory at the assert"
          note={[
            mem.blockPool ? `${mem.blockPool.entries.toLocaleString("en")} block-pool allocations` : null,
            mem.bytePool?.corrupted ? "byte pool damaged" : null,
            mem.cutShort ? "list cut short" : null,
          ]
            .filter(Boolean)
            .join(", ")}
          open={Boolean(mem.bytePool?.corrupted)}
        >
          {mem.bytePool?.corrupted ? (
            <p className="mb-3 flex gap-2 rounded-[10px] bg-warning-soft px-3 py-2 text-[13.5px] text-warning-ink">
              <WarningIcon weight="fill" className="mt-0.5 size-4 shrink-0" />
              While listing the byte pool the modem stopped with &ldquo;{mem.bytePool.corrupted}&rdquo;: a heap corruption is possible.
            </p>
          ) : null}
          {mem.cutShort ? <p className="mb-3 text-[13px] text-muted-foreground">{mem.cutShort}</p> : null}
          {mem.blockPool ? (
            <div>
              <h5 className="mb-1 text-[12.5px] font-bold text-ink-2">
                Block pool: {mem.blockPool.entries.toLocaleString("en")} allocations, {sizeText(mem.blockPool.bytes)}. Most allocations from:
              </h5>
              <SmallTable head={["Allocated at", "Blocks", "Bytes"]} right={[1, 2]} rows={usageRows(mem.blockPool.top)} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {mem.blockPool.byEntity.map((u) => (
                  <Chip key={u.site} tone="mono">
                    {u.site}: {u.count.toLocaleString("en")} ({sizeText(u.bytes)})
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
          {mem.bytePool ? (
            <div className="mt-3">
              <h5 className="mb-1 text-[12.5px] font-bold text-ink-2">
                Byte pool: {mem.bytePool.entries} allocations, {sizeText(mem.bytePool.bytes)}
              </h5>
              <SmallTable head={["Allocated at", "Blocks", "Bytes"]} right={[1, 2]} rows={usageRows(mem.bytePool.top)} />
            </div>
          ) : null}
          {mem.initialized ? (
            <div className="mt-3">
              <h5 className="mb-1 text-[12.5px] font-bold text-ink-2">
                Initialised memory: {mem.initialized.entries.toLocaleString("en")} allocations, {sizeText(mem.initialized.bytes)}
              </h5>
              <SmallTable head={["Allocated at", "Blocks", "Bytes"]} right={[1, 2]} rows={usageRows(mem.initialized.top)} />
            </div>
          ) : null}
        </Fold>
      ) : null}

      {e.history?.length ? (
        <Fold icon={DatabaseIcon} title="Asserts kept in modem memory" note={`(${e.history.length}, from the memory dump: the firmware's list of recent asserts)`}>
          <CoreRows cores={e.history} />
        </Fold>
      ) : null}

      {e.versions?.length || e.sections?.length || e.commands?.length ? (
        <Fold icon={FileMagnifyingGlassIcon} title="Everything else in the record">
          {e.versions?.length ? <Pairs items={[...e.versions, ...(e.build ? [{ label: "Build time", value: e.build }] : [])]} /> : null}
          {e.sections?.length ? (
            <div className="mt-3">
              <h5 className="mb-1 text-[12.5px] font-bold text-ink-2">Sections in the record</h5>
              <div className="flex flex-wrap gap-1.5">
                {e.sections.map((s) => (
                  <Chip key={s} tone="mono">
                    {s}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
          {e.commands?.length ? (
            <p className="mt-3 text-[13px] text-ink-2">
              Typed at the assert console: <span className="font-mono font-semibold text-foreground">{e.commands.join(", ")}</span>
            </p>
          ) : null}
        </Fold>
      ) : null}

      {e.raw ? (
        <Fold icon={TextAlignLeftIcon} title="The whole record, as written">
          <pre className="max-h-[420px] overflow-auto font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2 scrollbar-thin [overflow-wrap:anywhere]">{e.raw}</pre>
        </Fold>
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
                    !g.strong ? "bg-sunken text-ink-2" : g.explained || !SURE.includes(g.kind) ? "bg-warning-soft text-warning-ink" : "bg-critical-soft text-critical-ink",
                  )}
                >
                  {KIND_LABEL[g.kind]}
                </span>
              </td>
              <td className="px-3 py-2 font-mono text-[12.5px] text-foreground [overflow-wrap:anywhere]">
                {g.text}
                {g.explained ? <div className="mt-0.5 font-sans text-[12px] text-muted-foreground">Part of: {g.explained}</div> : null}
              </td>
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
  const enter = (i: number) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, transform: "translateY(8px)" },
          animate: { opacity: 1, transform: "translateY(0px)" },
          transition: { duration: 0.28, delay: i * 0.045, ease: EASE },
        };
  const h = crashHeadline(c);
  const tone = h.tone;
  return (
    <div className="flex flex-col gap-4">
      <motion.section {...enter(0)} data-crash-verdict={tone} className="relative overflow-hidden rounded-[22px] border border-border bg-panel px-[clamp(18px,3vw,36px)] pb-6 pt-7 shadow-soft">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1.5" style={{ background: TOP[tone] }} />
        <div className={cn("inline-flex items-center gap-2 rounded-full px-3.5 py-[5px] text-[13.5px] font-bold", SOFT[tone])}>
          {tone === "bad" ? <XCircleIcon weight="bold" className="size-4" /> : tone === "warn" ? <HandIcon weight="bold" className="size-4" /> : <CheckCircleIcon weight="bold" className="size-4" />}
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
          {(
            [
              ["Assert records", n.records, tone === "bad"],
              ["Crash lines", n.strongLines, tone === "bad"],
              ["Mentions", n.weakLines, false],
              ["Files searched", n.searched, false],
            ] as const
          ).map(([label, v, red]) => (
            <div key={label} className="rounded-[14px] border border-border bg-panel-2 px-3.5 py-2.5">
              <div className="text-[12.5px] font-semibold text-muted-foreground">{label}</div>
              <div className={cn("mt-0.5 font-mono text-[22px] font-bold tabular-nums", red && v > 0 ? "text-critical-ink" : "text-foreground")}>{v}</div>
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
              const hits = n.strong.filter((g) => g.files[f]).length || c.events.filter((e) => e.file === f || e.also?.some((a) => a.startsWith(f))).length;
              return (
                <li
                  key={f}
                  className={cn(
                    "break-all rounded-md border px-2 py-0.5 font-mono text-[12px]",
                    hits ? (tone === "bad" ? "border-transparent bg-critical-soft font-semibold text-critical-ink" : "border-transparent bg-warning-soft font-semibold text-warning-ink") : "border-border bg-panel text-ink-2",
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

/** On the summary page: the assert or crash, before anything else, with a way to its details. */
export function CrashSummary({ capture, onAll }: { capture: CaptureInfo; onAll: () => void }) {
  const c = capture.crashes;
  const tone = crashTone(c);
  if (tone === "ok" || !c) return null;
  const n = crashCounts(c);
  const items = [
    ...c.events.map((e) => ({
      forced: Boolean(e.forced),
      label: e.forced ? "Requested assert" : KIND_LABEL[e.kind],
      title: e.title,
      ts: e.ts ?? null,
      sub: [e.core, e.task && `task ${e.task}`, e.expression, e.message].filter(Boolean).join(" · ") || e.file,
    })),
    ...n.strong
      .filter((g) => !g.explained)
      .slice(0, 3)
      .map((g) => ({ forced: false, label: KIND_LABEL[g.kind], title: g.text, ts: g.first, sub: `${g.count}x in ${Object.keys(g.files).join(", ")}` })),
  ];
  const allForced = tone === "warn" && c.events.length > 0 && c.events.every((e) => e.forced);
  return (
    <section
      data-crash-summary={tone}
      className={cn("surface rounded-2xl px-[18px] py-4", tone === "bad" ? "shadow-[inset_0_3px_0_var(--st-bad),var(--lift)]" : "shadow-[inset_0_3px_0_var(--st-warn),var(--lift)]")}
    >
      <CardHead
        icon={allForced ? HandIcon : BugIcon}
        title={allForced ? "The modem was stopped on request" : tone === "bad" ? "The modem crashed" : "Asserts and resets"}
        sub={
          allForced
            ? `An assert was asked for with ${c.events[0].forced} to save a memory dump. ${n.searched} files searched; no other assert or crash.`
            : `${n.records ? `${n.records} assert ${n.records === 1 ? "record" : "records"}` : "No assert record"}, ${n.strongLines} assert or crash ${n.strongLines === 1 ? "line" : "lines"} in ${n.searched} files searched.`
        }
        aside={
          <button onClick={onAll} className="text-[13px] font-bold text-link underline underline-offset-[3px] hover:no-underline">
            See the asserts
          </button>
        }
      />
      <ul className="divide-y divide-border rounded-[12px] border border-border bg-panel-2">
        {items.map((it, i) => (
          <li key={i} className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 px-3.5 py-3 sm:grid-cols-[22px_minmax(0,1fr)_auto]">
            {it.forced ? <HandIcon weight="fill" className="mt-0.5 size-[18px] text-warning" /> : <BugIcon weight="fill" className="mt-0.5 size-[18px] text-critical" />}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14.5px] font-bold text-foreground [overflow-wrap:anywhere]">{it.title}</span>
                <span className={cn("rounded-full px-2 py-px text-[11.5px] font-bold", it.forced ? "bg-warning-soft text-warning-ink" : "bg-critical-soft text-critical-ink")}>{it.label}</span>
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
