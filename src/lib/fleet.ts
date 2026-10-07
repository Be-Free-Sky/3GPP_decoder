/**
 * Several Logel logs at once: analyse each folder and say, for each one and overall,
 * whether an issue was found and where.
 */

import { prepareCapture, type CaptureSource } from "@/lib/capture";
import { engine } from "@/lib/engine/client";
import { crashFound, type CaptureInfo, type Report } from "@/lib/engine/types";
import { buildHeadline } from "@/lib/areas";
import { fmtMs } from "@/lib/format";

export type LogStatus = "waiting" | "reading" | "done" | "failed";

export interface FleetLog {
  name: string;
  status: LogStatus;
  /** what is being read right now */
  phase?: string;
  report?: Report;
  info?: CaptureInfo;
  /** why the log could not be analysed */
  error?: string;
  size: number;
  fileCount: number;
}

export interface LogResult {
  report?: Report;
  info: CaptureInfo;
  error?: string;
}

/** Read one capture (zip, folder or files) and decode it. */
export async function analyseLog(cap: CaptureSource, onStep: (text: string) => void): Promise<LogResult> {
  const prepared = await prepareCapture(cap, onStep);
  const c = prepared.capture;
  const info: CaptureInfo = {
    name: c.name,
    kind: c.kind,
    files: c.files,
    device: c.device,
    ip: c.ip,
    stats: c.stats,
    span: c.span,
    notes: c.notes,
    crashes: c.crashes,
  };
  // an assert or crash is reported even when the log holds no messages beside it
  if (c.records.length || crashFound(c.crashes)) {
    onStep(c.records.length ? `Decoding ${c.records.length} RRC and NAS messages` : "Analysing the assert and crash records");
    const report = await engine.decodeCapture(c);
    return report.messages.length || report.session ? { report, info } : { info, error: "No RRC or NAS messages were found in this log." };
  }
  if (prepared.text) {
    onStep("Decoding the text export");
    const report = await engine.decode(prepared.text, "auto", "auto", {});
    report.capture = info;
    return report.messages.length ? { report, info } : { info, error: "No hex messages were found in the text files." };
  }
  const logel = c.files.find((f) => /\.logel$/i.test(f.name));
  return {
    info,
    error: logel
      ? `${logel.name} holds no RRC or NAS messages this decoder reads.`
      : "No modem log in this folder: Logel saves it as a .logel file, and it is missing here.",
  };
}

export type Tone = "bad" | "warn" | "ok" | "none" | "busy";

export interface LogVerdict {
  tone: Tone;
  word: string;
  head: string;
  detail?: string;
  todo?: string;
}

function firstSentence(s?: string) {
  if (!s) return undefined;
  const m = /^(.+?[.!?])(\s|$)/.exec(s);
  return m ? m[1] : s;
}

/** The message shown against one folder. */
export function logVerdict(l: FleetLog): LogVerdict {
  if (l.status === "waiting") return { tone: "busy", word: "Waiting", head: "Waiting to be read." };
  if (l.status === "reading") return { tone: "busy", word: "Reading", head: `${l.phase ?? "Reading the log"}…` };
  if (l.status === "failed" || !l.report) return { tone: "none", word: "Not analysed", head: l.error ?? "This log could not be analysed." };
  const r = l.report;
  if (!r.session) return { tone: "ok", word: "Decoded", head: `${r.messages.length} ${r.messages.length === 1 ? "message" : "messages"} decoded.` };
  const h = buildHeadline(r);
  return {
    tone: h.overall,
    word: h.overall === "bad" ? "Issue found" : h.overall === "warn" ? "Worth a look" : "All good",
    head: h.head,
    detail: firstSentence(h.detail),
    todo: h.todo,
  };
}

/** Facts for the line under a folder's name. */
export function logFacts(l: FleetLog) {
  const r = l.report;
  const out: string[] = [];
  const span = l.info?.span;
  if (span?.date) out.push(`${span.date}${span.start ? ` ${span.start.slice(0, 8)}` : ""}${span.end ? ` to ${span.end.slice(0, 8)}` : ""}`);
  if (r) {
    out.push(`${r.messages.length} ${r.messages.length === 1 ? "message" : "messages"}`);
    const k = r.session?.kpis;
    if (k?.rats.length) out.push(k.rats.join(" and "));
    if (k?.durationMs) out.push(`${fmtMs(k.durationMs)} of log`);
    const net = r.session?.context.network ?? [];
    const op = net.find((c) => c.label === "Operator")?.value ?? net.find((c) => c.label === "PLMN")?.hint?.split(", ").pop();
    if (op) out.push(op);
  }
  const crashes = l.info?.crashes;
  if (crashFound(crashes)) {
    const forced = crashes!.events.filter((e) => e.forced).length;
    const real = crashes!.events.length - forced || crashes!.groups.filter((g) => g.strong && !g.explained).length;
    if (real) out.push(`${real} ${real === 1 ? "assert or crash" : "asserts or crashes"}`);
    if (forced) out.push(`${forced === 1 ? "assert" : `${forced} asserts`} on request (${crashes!.events.find((e) => e.forced)!.forced})`);
  }
  const files = l.info?.files;
  if (files?.length) {
    const empty = files.filter((f) => f.role === "skipped").length;
    out.push(`${files.length} files read${empty ? ` (${empty} empty)` : ""}`);
  }
  return out;
}

export interface FleetOverview {
  tone: Tone;
  kick: string;
  head: string;
  detail: string;
  /** folders with an issue, worst first */
  issues: { index: number; name: string; tone: Tone }[];
  counts: { bad: number; warn: number; ok: number; none: number; busy: number };
}

const listNames = (names: string[]) => (names.length <= 3 ? names.join(", ") : `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`);

/** The statement at the top: which folders have issues. */
export function fleetOverview(logs: FleetLog[]): FleetOverview {
  const verdicts = logs.map(logVerdict);
  const counts = { bad: 0, warn: 0, ok: 0, none: 0, busy: 0 };
  verdicts.forEach((v) => counts[v.tone]++);
  const issues = verdicts
    .map((v, index) => ({ index, name: logs[index].name, tone: v.tone }))
    .filter((x) => x.tone === "bad" || x.tone === "warn")
    .sort((a, b) => (a.tone === b.tone ? a.index - b.index : a.tone === "bad" ? -1 : 1));
  const n = logs.length;
  const notRead = counts.none ? ` ${counts.none} ${counts.none === 1 ? "folder" : "folders"} could not be analysed.` : "";
  if (counts.busy) {
    const done = n - counts.busy;
    return {
      tone: "busy",
      kick: `Analysing ${Math.min(done + 1, n)} of ${n}`,
      head: issues.length ? `Issues so far in ${listNames(issues.map((x) => x.name))}.` : `Reading ${n} logs, one folder at a time.`,
      detail: `${done} of ${n} logs read.${notRead}`,
      issues,
      counts,
    };
  }
  if (issues.length) {
    return {
      tone: counts.bad ? "bad" : "warn",
      kick: `Issues in ${issues.length} of ${n} logs`,
      head: `Issues found in ${listNames(issues.map((x) => x.name))}.`,
      detail: `${counts.bad ? `${counts.bad} with a failure` : ""}${counts.bad && counts.warn ? ", " : ""}${counts.warn ? `${counts.warn} worth a look` : ""}${
        counts.ok ? `, ${counts.ok} all good` : ""
      }.${notRead}`,
      issues,
      counts,
    };
  }
  if (counts.ok) {
    return {
      tone: "ok",
      kick: "All good",
      head: `No issues in ${counts.ok === n ? `any of the ${n} logs` : `the ${counts.ok} logs that were read`}.`,
      detail: `Every procedure completed in each log that was read.${notRead}`,
      issues,
      counts,
    };
  }
  return { tone: "none", kick: "Nothing analysed", head: "None of the folders holds a modem log this decoder reads.", detail: notRead.trim(), issues, counts };
}
