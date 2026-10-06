import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeftIcon,
  CaretLeftIcon,
  CaretRightIcon,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  CodeIcon,
  CopyIcon,
  HashIcon,
  InfoIcon,
  ListChecksIcon,
  StackIcon,
  TableIcon,
  TreeStructureIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type { DecodeResult, Highlight, MessageEntry, Severity } from "@/lib/engine/types";
import { QUALITY_TEXT, copyText, directionLabel, protocolShort, worstSeverity } from "@/lib/format";
import { Chip, DirectionGlyph } from "./bits";
import { FindingCard } from "./finding-card";
import { DecodeTree } from "./decode-tree";
import { HexView } from "./hex-view";
import { protocolLabel } from "./protocol-picker";
import { CardHead } from "./summary-view";
import { cn } from "@/lib/utils";

const LANES: Record<string, [string, string]> = {
  "LTE RRC": ["UE", "eNB"],
  "NB-IoT RRC": ["UE", "eNB"],
  "NR RRC": ["UE", "gNB"],
  "WCDMA RRC": ["UE", "RNC"],
  "EPS NAS": ["UE", "MME"],
  "5GS NAS": ["UE", "AMF"],
};

function peers(r: DecodeResult) {
  const pair = LANES[r.protocol.family ?? ""];
  if (!pair) return null;
  return r.direction === "DL" ? `${pair[1]} to ${pair[0]}` : r.direction === "UL" ? `${pair[0]} to ${pair[1]}` : null;
}

type Tone = "bad" | "warn" | "ok" | "info";

const TONE: Record<Tone, { bar: string; chip: string; icon: typeof XCircleIcon; word: string }> = {
  bad: { bar: "linear-gradient(90deg,#c21d3a,#e0485f)", chip: "bg-critical-soft text-critical-ink", icon: XCircleIcon, word: "Failure in this message" },
  warn: { bar: "linear-gradient(90deg,#c98500,#e8a93b)", chip: "bg-warning-soft text-warning-ink", icon: WarningIcon, word: "Worth a look" },
  ok: { bar: "linear-gradient(90deg,#12924a,#2fb86a)", chip: "bg-ok-soft text-ok-ink", icon: CheckCircleIcon, word: "Decoded" },
  info: { bar: "linear-gradient(90deg,#02457a,#0069c8,#018abe)", chip: "bg-info-soft text-info-ink", icon: InfoIcon, word: "Decoded" },
};

function toneOf(r: DecodeResult, sev: Severity | null): Tone {
  if (!r.ok || sev === "critical") return "bad";
  if (sev === "warning") return "warn";
  if (r.findings.some((f) => f.severity === "ok")) return "ok";
  return "info";
}

function Highlights({ items }: { items: Highlight[] }) {
  if (!items.length) return null;
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-2.5">
      {items.map((h, i) => (
        <div key={`${h.label}-${i}`} className="min-w-0 rounded-[12px] border border-border bg-panel-2 px-3.5 py-2.5">
          <dt className="truncate text-[12.5px] font-medium text-muted-foreground">{h.label}</dt>
          <dd className="mt-0.5 break-words text-[15px] font-bold leading-snug text-foreground">{h.value}</dd>
          {h.hint ? (
            <dd className={cn("mt-0.5 text-[12.5px] leading-snug", h.q ? cn(QUALITY_TEXT[h.q], "font-semibold") : "text-muted-foreground")}>
              {h.hint}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

const DETAIL_TABS = [
  { id: "tree" as const, label: "Decoded fields", icon: TreeStructureIcon },
  { id: "text" as const, label: "Spec notation", icon: CodeIcon },
  { id: "hex" as const, label: "Hex", icon: HashIcon },
];

function DetailTabs({ result, onEmbedded }: { result: DecodeResult; onEmbedded?: (i: number) => void }) {
  const [tab, setTab] = useState<"tree" | "text" | "hex">("tree");
  return (
    <section className="surface rounded-2xl px-[18px] py-4">
      <CardHead
        icon={TableIcon}
        title="Full decode"
        sub="Every field as the 3GPP specification names it."
        aside={
          <div role="tablist" aria-label="Decode views" className="inline-flex gap-0.5 rounded-[10px] border border-border bg-sunken p-[3px]">
            {DETAIL_TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] font-semibold transition-[background-color,color,box-shadow] duration-150",
                  tab === t.id ? "bg-panel text-foreground shadow-[inset_0_0_0_1px_rgb(11_27_52/0.13)]" : "text-ink-2 hover:text-foreground",
                )}
              >
                <t.icon weight="bold" className="size-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        }
      />
      {tab === "tree" && result.tree ? <DecodeTree root={result.tree} onEmbedded={onEmbedded} /> : null}
      {tab === "text" ? (
        <div className="relative">
          <button
            onClick={async () => (await copyText(result.text ?? "")) && toast.success("Copied the spec notation")}
            className="press absolute right-2 top-2 inline-flex h-8 items-center gap-1.5 rounded-[9px] border border-line-2 bg-panel px-2.5 text-[12.5px] font-semibold text-foreground hover:bg-hover-2"
          >
            <CopyIcon weight="bold" className="size-3.5" /> Copy
          </button>
          <pre className="max-h-[560px] overflow-auto rounded-[12px] border border-border bg-panel-2 p-3.5 font-mono text-[12.5px] leading-relaxed text-foreground scrollbar-thin">
            {result.text}
          </pre>
        </div>
      ) : null}
      {tab === "hex" ? <HexView hex={result.hex} /> : null}
    </section>
  );
}

function EmbeddedSection({ e, index }: { e: { field: string; result: DecodeResult }; index: number }) {
  const r = e.result;
  return (
    <section id={`emb-${index}`} className="scroll-mt-32 rounded-[14px] border border-border bg-panel-2 p-4 shadow-[inset_3px_0_0_var(--brand-3)]">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-bold text-foreground">{r.ok ? r.message?.title : "Embedded content"}</h3>
        <Chip tone="brand">{r.ok ? protocolShort(r) : protocolLabel(r.protocol.id)}</Chip>
        <Chip tone="mono">{e.field}</Chip>
        {r.ok && r.security ? <Chip>{r.security.label ?? "Security protected"}</Chip> : null}
      </div>
      {!r.ok ? (
        <p className="mt-2 text-[14px] text-ink-2">{r.error}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {r.summary ? <p className="text-[14.5px] leading-relaxed text-ink-2">{r.summary}</p> : null}
          {r.warnings.map((w) => (
            <p key={w} className="flex gap-2 rounded-[10px] bg-warning-soft px-3 py-2 text-[13.5px] text-warning-ink">
              <WarningIcon weight="fill" className="mt-0.5 size-4 shrink-0" />
              {w}
            </p>
          ))}
          {r.findings.map((f, i) => (
            <FindingCard key={i} f={f} defaultOpen={f.severity === "critical"} />
          ))}
          <Highlights items={r.highlights} />
          {r.tree ? <DecodeTree root={r.tree} compact /> : null}
        </div>
      )}
    </section>
  );
}

const NAV =
  "press grid size-[38px] place-items-center rounded-[11px] border border-line-2 bg-white/70 text-foreground transition-[background-color,border-color] duration-150 hover:border-line-3 hover:bg-hover-2 disabled:pointer-events-none disabled:opacity-40";

export function MessageView({
  entry,
  total,
  onPrev,
  onNext,
  onOpen,
  onRetry,
}: {
  entry: MessageEntry;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onOpen: (i: number) => void;
  /** back to the home page, to choose the protocol by hand */
  onRetry: () => void;
}) {
  const r = entry.result;
  const reduce = useReducedMotion();
  const sev = worstSeverity(r);
  const tone = toneOf(r, sev);
  const T = TONE[tone];
  const det = r.detection;
  const detText = det?.mode === "manual" ? "Protocol chosen by hand" : det?.mode === "hint" ? "Protocol from the log header" : det ? `Auto-detected, ${det.confidence} confidence` : null;
  const todo = r.findings.find((f) => (f.severity === "critical" || f.severity === "warning") && f.checks?.length)?.checks?.[0];
  const scrollToEmbedded = (i: number) =>
    document.getElementById(`emb-${i}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });

  return (
    <motion.div
      key={entry.index}
      initial={reduce ? false : { opacity: 0, transform: "translateY(4px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      id="message-view"
      className="flex min-w-0 scroll-mt-[128px] flex-col gap-4"
    >
      <section className="relative overflow-hidden rounded-[22px] border border-border bg-panel px-[clamp(18px,2.6vw,30px)] pb-5 pt-6 shadow-soft">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1.5" style={{ background: T.bar }} />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold", T.chip)}>
            <T.icon weight="bold" className="size-4" />
            {r.ok ? T.word : "Could not decode"}
          </span>
          <span className="font-mono text-[12.5px] font-medium tabular-nums text-muted-foreground">
            Message {entry.index + 1} of {total}
          </span>
          {entry.timestamp ? (
            <span className="inline-flex items-center gap-1 font-mono text-[12.5px] tabular-nums text-muted-foreground">
              <ClockIcon weight="bold" className="size-3.5" /> {entry.timestamp}
            </span>
          ) : null}
          {total > 1 ? (
            <div className="ml-auto flex gap-1.5">
              <button className={NAV} onClick={onPrev} disabled={entry.index === 0} aria-label="Previous message" title="Previous message (k)">
                <CaretLeftIcon weight="bold" className="size-4" />
              </button>
              <button className={NAV} onClick={onNext} disabled={entry.index >= total - 1} aria-label="Next message" title="Next message (j)">
                <CaretRightIcon weight="bold" className="size-4" />
              </button>
            </div>
          ) : null}
        </div>
        <h2 className="mt-3 text-[clamp(21px,2.4vw,28px)] font-bold leading-[1.25] tracking-[-0.015em] text-foreground [overflow-wrap:anywhere]">
          {r.ok ? r.message?.title : "Could not decode this message"}
        </h2>
        {r.ok ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Chip tone="brand">{protocolShort(r)}</Chip>
            <Chip>
              <DirectionGlyph result={r} />
              {peers(r) ? `${directionLabel(r)}, ${peers(r)}` : directionLabel(r)}
            </Chip>
            <Chip>{r.bytes} bytes</Chip>
            {r.security ? <Chip>{r.security.label ?? "Security protected"}</Chip> : null}
            {detText ? <Chip>{detText}</Chip> : null}
          </div>
        ) : null}
        {r.ok ? (
          r.summary ? (
            <p className="mt-3 max-w-[85ch] text-[16px] leading-relaxed text-ink-2">{r.summary}</p>
          ) : null
        ) : (
          <>
            <p className="mt-2 max-w-[85ch] text-[16px] leading-relaxed text-ink-2">{r.error}</p>
            <div className="mt-4 flex max-w-[78ch] flex-wrap items-baseline gap-x-3 gap-y-1.5 rounded-[14px] border border-[rgb(12_163_12/0.2)] bg-ok-soft px-4 py-3 text-[15px] leading-normal">
              <b className="inline-flex items-center gap-1.5 whitespace-nowrap text-ok-ink">
                <CheckIcon weight="bold" className="size-4" />
                What to do
              </b>
              <span className="text-foreground">
                Check that the whole message was copied. Logel shows the channel next to each message (for example UL-DCCH): choose that protocol and
                channel on the home page, then decode again.
              </span>
            </div>
            <button
              onClick={onRetry}
              className="press mt-4 inline-flex h-[38px] items-center gap-2 rounded-[11px] border border-line-2 bg-white/70 px-4 text-[13.5px] font-semibold text-foreground hover:border-line-3 hover:bg-hover-2"
            >
              <ArrowLeftIcon weight="bold" className="size-4" /> Choose the protocol
            </button>
          </>
        )}
        {r.ok && todo ? (
          <div className="mt-4 flex max-w-[78ch] flex-wrap items-baseline gap-x-3 gap-y-1.5 rounded-[14px] border border-[rgb(12_163_12/0.2)] bg-ok-soft px-4 py-3 text-[15px] leading-normal">
            <b className="inline-flex items-center gap-1.5 whitespace-nowrap text-ok-ink">
              <CheckIcon weight="bold" className="size-4" />
              What to do
            </b>
            <span className="text-foreground">{todo}</span>
          </div>
        ) : null}
        {r.warnings.length ? (
          <div className="mt-3 flex flex-col gap-1.5">
            {r.warnings.map((w) => (
              <p key={w} className="flex max-w-[85ch] gap-2 rounded-[10px] bg-warning-soft px-3 py-2 text-[13.5px] leading-relaxed text-warning-ink">
                <WarningIcon weight="fill" className="mt-0.5 size-4 shrink-0" />
                {w}
              </p>
            ))}
          </div>
        ) : null}
        {entry.header ? (
          <p className="mt-3 truncate border-t border-border pt-2.5 font-mono text-[12px] text-muted-foreground" title={entry.header}>
            {entry.header}
          </p>
        ) : null}
      </section>

      {r.findings.length ? (
        <section className="surface rounded-2xl px-[18px] py-4">
          <CardHead icon={ListChecksIcon} title="Analysis" sub="What this message means for the call, with likely causes and checks." />
          <div className="flex flex-col gap-2.5">
            {r.findings.map((f, i) => (
              <FindingCard key={i} f={f} defaultOpen={f.severity === "critical"} onOpen={onOpen} />
            ))}
          </div>
        </section>
      ) : null}

      {r.ok && r.highlights.length ? (
        <section className="surface rounded-2xl px-[18px] py-4">
          <CardHead icon={InfoIcon} title="Key fields" sub="The values that matter for troubleshooting, with units and a quality hint." />
          <Highlights items={r.highlights} />
        </section>
      ) : null}

      {r.embedded.length ? (
        <section className="surface rounded-2xl px-[18px] py-4">
          <CardHead icon={StackIcon} title="Carried inside this message" sub="Containers decoded in place: NAS inside RRC, NR cell groups inside LTE, UE capabilities." />
          <div className="flex flex-col gap-3">
            {r.embedded.map((e, i) => (
              <EmbeddedSection key={i} e={e} index={i} />
            ))}
          </div>
        </section>
      ) : null}

      {r.ok ? (
        <DetailTabs result={r} onEmbedded={scrollToEmbedded} />
      ) : (
        <section className="surface rounded-2xl px-[18px] py-4">
          <CardHead icon={HashIcon} title="Bytes" sub="The message as pasted." />
          <HexView hex={r.hex} />
        </section>
      )}
    </motion.div>
  );
}
