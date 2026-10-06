import type { DecodeResult, Quality, Severity, Status } from "@/lib/engine/types";

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Failure",
  warning: "Warning",
  info: "Note",
  ok: "OK",
};

/** Icon and mark colour for a severity. */
export const SEVERITY_TEXT: Record<Severity, string> = {
  critical: "text-critical",
  warning: "text-warning",
  info: "text-blue",
  ok: "text-ok",
};

/** Text colour that reads on the soft status fill. */
export const SEVERITY_INK: Record<Severity, string> = {
  critical: "text-critical-ink",
  warning: "text-warning-ink",
  info: "text-info-ink",
  ok: "text-ok-ink",
};

/** Soft status fill (chips, call-outs). */
export const SEVERITY_SOFT: Record<Severity, string> = {
  critical: "bg-critical-soft",
  warning: "bg-warning-soft",
  info: "bg-info-soft",
  ok: "bg-ok-soft",
};

/** Left accent + tint used on finding cards. */
export const SEVERITY_SURFACE: Record<Severity, string> = {
  critical: "border-l-critical bg-critical-soft/50",
  warning: "border-l-warning bg-warning-soft/50",
  info: "border-l-blue bg-info-soft/40",
  ok: "border-l-ok bg-ok-soft/50",
};

/** Top border colour of a status tile. */
export const SEVERITY_TOP: Record<Severity, string> = {
  critical: "border-t-critical",
  warning: "border-t-warning",
  info: "border-t-blue",
  ok: "border-t-ok",
};

export const STATUS_SEVERITY: Record<Status, Severity> = { ok: "ok", warning: "warning", failure: "critical" };

export const QUALITY_TEXT: Record<Quality, string> = {
  excellent: "text-q-excellent",
  good: "text-q-good",
  fair: "text-q-fair",
  poor: "text-q-poor",
  bad: "text-q-bad",
};

export const QUALITY_LABEL: Record<Quality, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  bad: "Very poor",
};

export function protocolShort(r: DecodeResult): string {
  const p = r.protocol;
  if (!p?.family) return p?.id ?? "Unknown";
  if (p.layer === "NAS") return r.nas?.proto ? `${p.family} · ${r.nas.proto}` : p.family;
  if (p.layer === "RRC") return `${p.family} · ${p.channel}`;
  return p.family;
}

export function directionLabel(r: DecodeResult): string {
  const ch = r.protocol?.channel ?? "";
  if (["BCCH-BCH", "BCCH-DL-SCH", "PCCH", "MCCH"].includes(ch)) return "Broadcast";
  if (r.direction === "UL") return "Uplink";
  if (r.direction === "DL") return "Downlink";
  return "Direction n/a";
}

export function fmtMs(ms?: number | null): string {
  if (ms == null) return "n/a";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m} min ${s} s`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

export function spacedHex(hex: string): string {
  return hex.replace(/(..)(?!$)/g, "$1 ");
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadFile(name: string, content: string, type = "application/json") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Title of the NAS message carried inside an RRC / AP message (the inner one for NAS transports). */
export function carriedTitle(r: DecodeResult): string | null {
  for (const e of r.embedded ?? []) {
    const sub = e.result;
    if (!sub?.ok || sub.protocol?.layer !== "NAS") continue;
    const inner = (sub.facts?.inner as { title: string }[] | undefined) ?? [];
    if (inner.length && sub.message?.title?.includes("Transport")) return inner[0].title;
    return sub.message?.title ?? null;
  }
  return null;
}

export function worstSeverity(r: DecodeResult): Severity | null {
  if (!r.ok) return "critical";
  if (r.status === "failure") return "critical";
  if (r.status === "warning") return "warning";
  return null;
}
