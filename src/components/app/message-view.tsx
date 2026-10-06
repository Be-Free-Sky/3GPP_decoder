import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  CaretLeftIcon,
  CaretRightIcon,
  ClockIcon,
  CodeIcon,
  CopyIcon,
  HashIcon,
  StackIcon,
  TreeStructureIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type { DecodeResult, Highlight, MessageEntry } from "@/lib/engine/types";
import { QUALITY_TEXT, copyText, directionLabel, protocolShort, worstSeverity } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Chip, DirectionGlyph, SectionTitle, SeverityIcon } from "./bits";
import { FindingCard } from "./finding-card";
import { DecodeTree } from "./decode-tree";
import { HexView } from "./hex-view";
import { ProtocolPicker, protocolLabel } from "./protocol-picker";
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

function Highlights({ items }: { items: Highlight[] }) {
  if (!items.length) return null;
  return (
    <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-3">
      {items.map((h, i) => (
        <div key={`${h.label}-${i}`} className="min-w-0 rounded-xl border border-border bg-raised px-3 py-2.5">
          <dt className="truncate text-[11.5px] text-muted-foreground">{h.label}</dt>
          <dd className="mt-0.5 break-words text-[13.5px] font-semibold leading-snug text-foreground">{h.value}</dd>
          {h.hint ? (
            <dd className={cn("mt-0.5 text-[12px] leading-snug", h.q ? cn(QUALITY_TEXT[h.q], "font-medium") : "text-muted-foreground")}>
              {h.hint}
            </dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}

function DetailTabs({ result, onEmbedded }: { result: DecodeResult; onEmbedded?: (i: number) => void }) {
  const [tab, setTab] = useState<"tree" | "text" | "hex">("tree");
  const tabs = [
    { id: "tree" as const, label: "Decoded fields", icon: TreeStructureIcon },
    { id: "text" as const, label: "Spec notation", icon: CodeIcon },
    { id: "hex" as const, label: "Hex", icon: HashIcon },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div role="tablist" aria-label="Message views" className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "relative -mb-px inline-flex h-9 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium transition-colors duration-150",
              tab === t.id ? "border-brand-3 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </div>
      {tab === "tree" && result.tree ? <DecodeTree root={result.tree} onEmbedded={onEmbedded} /> : null}
      {tab === "text" ? (
        <div className="relative">
          <Button
            variant="outline"
            size="sm"
            className="absolute right-2 top-2 bg-raised"
            onClick={async () => (await copyText(result.text ?? "")) && toast.success("Copied spec notation")}
          >
            <CopyIcon /> Copy
          </Button>
          <pre className="max-h-[560px] overflow-auto rounded-xl border border-border bg-raised p-3.5 font-mono text-[12px] leading-relaxed text-foreground scrollbar-thin">
            {result.text}
          </pre>
        </div>
      ) : null}
      {tab === "hex" ? <HexView hex={result.hex} /> : null}
    </div>
  );
}

function EmbeddedSection({ e, index }: { e: { field: string; result: DecodeResult }; index: number }) {
  const r = e.result;
  return (
    <section id={`emb-${index}`} className="scroll-mt-24 rounded-2xl border border-brand-3/20 bg-brand-3/[0.035] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <StackIcon className="size-4 text-brand-3" />
        <h3 className="text-[14px] font-semibold text-foreground">{r.ok ? r.message?.title : "Embedded content"}</h3>
        <Chip tone="brand">{r.ok ? protocolShort(r) : protocolLabel(r.protocol.id)}</Chip>
        <Chip tone="mono">{e.field}</Chip>
        {r.ok && r.security ? <Chip>{r.security.label ?? "Security protected"}</Chip> : null}
      </div>
      {!r.ok ? (
        <p className="mt-2 text-[13px] text-muted-foreground">{r.error}</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {r.summary ? <p className="text-[13.5px] leading-relaxed text-foreground">{r.summary}</p> : null}
          {r.warnings.map((w) => (
            <p key={w} className="flex gap-2 text-[12.5px] text-warning">
              <WarningIcon weight="fill" className="mt-0.5 size-3.5 shrink-0" />
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

export function MessageView({
  entry,
  total,
  onPrev,
  onNext,
  onOverride,
  onOpen,
}: {
  entry: MessageEntry;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onOverride: (index: number, protocol: string) => void;
  onOpen: (i: number) => void;
}) {
  const r = entry.result;
  const reduce = useReducedMotion();
  const sev = worstSeverity(r);
  const det = r.detection;
  const detText =
    det?.mode === "manual"
      ? "Protocol chosen manually"
      : det?.mode === "hint"
        ? "Protocol from log header"
        : det
          ? `Auto-detected, ${det.confidence} confidence`
          : null;
  const scrollToEmbedded = (i: number) =>
    document.getElementById(`emb-${i}`)?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });

  return (
    <motion.div
      key={entry.index}
      initial={reduce ? false : { opacity: 0, transform: "translateY(4px)" }}
      animate={{ opacity: 1, transform: "translateY(0px)" }}
      transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
      className="flex flex-col gap-5"
    >
      <header className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono tabular-nums">
                Message {entry.index + 1} of {total}
              </span>
              {entry.timestamp ? (
                <span className="inline-flex items-center gap-1 font-mono tabular-nums">
                  <ClockIcon className="size-3.5" /> {entry.timestamp}
                </span>
              ) : null}
            </div>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight text-foreground">
              {sev ? <SeverityIcon severity={sev} className="size-5" /> : null}
              <span className="min-w-0">{r.ok ? r.message?.title : "Could not decode this message"}</span>
            </h2>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="outline" size="icon" className="bg-raised" onClick={onPrev} disabled={entry.index === 0} aria-label="Previous message">
              <CaretLeftIcon />
            </Button>
            <Button variant="outline" size="icon" className="bg-raised" onClick={onNext} disabled={entry.index >= total - 1} aria-label="Next message">
              <CaretRightIcon />
            </Button>
          </div>
        </div>
        {r.ok ? (
          <div className="flex flex-wrap items-center gap-1.5">
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
        {entry.header ? (
          <p className="truncate font-mono text-[11.5px] text-muted-foreground" title={entry.header}>
            {entry.header}
          </p>
        ) : null}
      </header>

      {r.ok ? (
        <div className="rounded-2xl border border-brand-3/20 bg-gradient-to-br from-white/90 to-brand-3/[0.05] p-4 shadow-[0_12px_32px_-24px_rgb(2_69_122/0.6)]">
          <div className="text-[11.5px] font-medium text-brand-2">In plain words</div>
          <p className="mt-1 text-[15px] leading-relaxed text-foreground">{r.summary}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-critical/25 bg-critical/[0.05] p-4">
          <p className="text-[14px] font-medium text-foreground">{r.error}</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Check that the full hex was copied, then pick the protocol and channel below. Logel shows the channel (for example UL-DCCH) next to each
            message.
          </p>
        </div>
      )}

      {r.warnings.length ? (
        <div className="flex flex-col gap-1.5">
          {r.warnings.map((w) => (
            <p key={w} className="flex gap-2 text-[12.5px] leading-relaxed text-warning">
              <WarningIcon weight="fill" className="mt-0.5 size-3.5 shrink-0" />
              {w}
            </p>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 rounded-xl border border-border bg-raised p-3 sm:flex-row sm:items-center">
        <span className="text-xs font-medium text-muted-foreground sm:w-24">Decode as</span>
        <ProtocolPicker
          value={det?.mode === "manual" ? r.protocol.id : "auto"}
          onChange={(p) => onOverride(entry.index, p)}
          className="sm:max-w-xs"
        />
        {det?.alternatives?.length ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>Also valid as</span>
            {det.alternatives.slice(0, 3).map((a) => (
              <button
                key={a.id}
                onClick={() => onOverride(entry.index, a.id)}
                className="press rounded-full border border-border bg-white px-2 py-0.5 text-[11.5px] text-link hover:border-brand-3/40"
                title={`Decode as ${a.label}`}
              >
                {a.label.replace(" (container)", "")}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {r.findings.length ? (
        <section className="flex flex-col gap-2">
          <SectionTitle>Analysis</SectionTitle>
          {r.findings.map((f, i) => (
            <FindingCard key={i} f={f} defaultOpen={f.severity === "critical"} onOpen={onOpen} />
          ))}
        </section>
      ) : null}

      {r.ok && r.highlights.length ? (
        <section className="flex flex-col gap-2">
          <SectionTitle>Key fields</SectionTitle>
          <Highlights items={r.highlights} />
        </section>
      ) : null}

      {r.embedded.length ? (
        <section className="flex flex-col gap-3">
          <SectionTitle>Carried inside this message</SectionTitle>
          {r.embedded.map((e, i) => (
            <EmbeddedSection key={i} e={e} index={i} />
          ))}
        </section>
      ) : null}

      {r.ok ? <DetailTabs result={r} onEmbedded={scrollToEmbedded} /> : <HexView hex={r.hex} />}
    </motion.div>
  );
}
