import type { DecodeResult, Finding, Report } from "@/lib/engine/types";
import { protocolShort, fmtMs, SEVERITY_LABEL } from "@/lib/format";

function findingMd(f: Finding): string {
  const lines = [`- **${SEVERITY_LABEL[f.severity]}: ${f.title}**${f.refs?.length ? ` (messages ${f.refs.map((r) => `#${r + 1}`).join(", ")})` : ""}`];
  if (f.detail) lines.push(`  ${f.detail}`);
  if (f.causes?.length) lines.push(`  Likely causes: ${f.causes.join("; ")}`);
  if (f.checks?.length) lines.push(`  Check: ${f.checks.join("; ")}`);
  if (f.ref) lines.push(`  Reference: ${f.ref}`);
  return lines.join("\n");
}

function messageMd(r: DecodeResult, idx: number, ts?: string | null): string {
  const head = `### #${idx + 1}${ts ? ` ${ts}` : ""} ${r.ok ? r.message?.title : "Decode failed"}`;
  if (!r.ok) return `${head}\n${r.error ?? ""}`;
  const out = [head, `*${protocolShort(r)}${r.direction ? `, ${r.direction}` : ""}, ${r.bytes} bytes*`, "", r.summary ?? ""];
  if (r.highlights.length) {
    out.push("", ...r.highlights.map((h) => `- ${h.label}: ${h.value}${h.hint ? ` (${h.hint})` : ""}`));
  }
  if (r.findings.length) out.push("", ...r.findings.map(findingMd));
  for (const e of r.embedded) {
    if (e.result.ok) out.push("", `Embedded ${e.result.message?.title}: ${e.result.summary ?? ""}`);
  }
  return out.join("\n");
}

/** Markdown RCA report for tickets and chat. */
export function reportToMarkdown(report: Report): string {
  const s = report.session;
  const out: string[] = ["# Skyworth 3GPP Decoder report", ""];
  if (s && report.messages.length > 1) {
    const verdict = s.verdict === "failure" ? "Failures found" : s.verdict === "warning" ? "Warnings found" : "No problems found";
    out.push(`**Verdict:** ${verdict}`, "");
    out.push(
      `Messages: ${s.kpis.decoded}/${s.kpis.messages} decoded. Procedures: ${s.kpis.procedures.success ?? 0} completed, ` +
        `${s.kpis.procedures.failure ?? 0} failed, ${s.kpis.procedures["no-answer"] ?? 0} without answer. ` +
        `Duration: ${fmtMs(s.kpis.durationMs)}.`,
      "",
    );
    if (s.narrative.root) {
      out.push("## Root cause", "", `**${s.narrative.root.title}**`, "");
      if (s.narrative.root.detail) out.push(s.narrative.root.detail, "");
      if (s.narrative.root.causes.length) out.push("Likely causes:", ...s.narrative.root.causes.map((c) => `- ${c}`), "");
      if (s.narrative.root.checks.length) out.push("What to check:", ...s.narrative.root.checks.map((c) => `- ${c}`), "");
    }
    if (s.narrative.steps.length) {
      out.push("## Sequence", "", ...s.narrative.steps.map((st) => `- #${st.i + 1} ${st.text}`), "");
    }
    if (s.findings.length) out.push("## Findings", "", ...s.findings.map(findingMd), "");
  }
  out.push("## Messages", "");
  report.messages.forEach((m) => out.push(messageMd(m.result, m.index, m.timestamp), ""));
  return out.join("\n");
}
