import {
  ArrowDownIcon,
  ArrowUpIcon,
  BroadcastIcon,
  CheckCircleIcon,
  InfoIcon,
  WarningIcon,
  XCircleIcon,
  ArrowsLeftRightIcon,
} from "@phosphor-icons/react";
import type { DecodeResult, Severity } from "@/lib/engine/types";
import { SEVERITY_TEXT } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Chip({
  children,
  className,
  tone = "neutral",
  title,
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "neutral" | "brand" | "critical" | "warning" | "mono";
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium",
        tone === "neutral" && "border-border bg-raised text-muted-foreground",
        tone === "brand" && "border-brand-3/25 bg-brand-3/[0.08] text-brand-2",
        tone === "critical" && "border-critical/25 bg-critical/[0.07] text-critical",
        tone === "warning" && "border-warning/30 bg-warning/[0.08] text-warning",
        tone === "mono" && "border-border bg-raised font-mono text-[11px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  const cls = cn("shrink-0", SEVERITY_TEXT[severity], className);
  if (severity === "critical") return <XCircleIcon weight="fill" className={cls} aria-label="Failure" />;
  if (severity === "warning") return <WarningIcon weight="fill" className={cls} aria-label="Warning" />;
  if (severity === "ok") return <CheckCircleIcon weight="fill" className={cls} aria-label="OK" />;
  return <InfoIcon weight="fill" className={cls} aria-label="Note" />;
}

export function DirectionGlyph({ result, className }: { result: DecodeResult; className?: string }) {
  const ch = result.protocol?.channel ?? "";
  const cls = cn("size-3.5 shrink-0", className);
  if (["BCCH-BCH", "BCCH-DL-SCH", "PCCH", "MCCH"].includes(ch)) return <BroadcastIcon className={cls} aria-label="Broadcast" />;
  if (result.direction === "UL") return <ArrowUpIcon weight="bold" className={cls} aria-label="Uplink" />;
  if (result.direction === "DL") return <ArrowDownIcon weight="bold" className={cls} aria-label="Downlink" />;
  return <ArrowsLeftRightIcon className={cls} aria-label="Direction not known" />;
}

export function SectionTitle({ children, aside, className }: { children: React.ReactNode; aside?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h3 className="text-[13px] font-semibold text-foreground">{children}</h3>
      {aside}
    </div>
  );
}

export function MsgRef({ i, onOpen }: { i: number; onOpen: (i: number) => void }) {
  return (
    <button
      onClick={() => onOpen(i)}
      className="press inline-flex h-5 items-center rounded-md border border-border bg-raised px-1.5 font-mono text-[11px] text-link transition-colors duration-150 hover:border-brand-3/40 hover:bg-brand-3/[0.08]"
      aria-label={`Open message ${i + 1}`}
    >
      #{i + 1}
    </button>
  );
}
