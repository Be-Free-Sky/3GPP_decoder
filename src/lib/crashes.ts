/** Shared wording for asserts and crashes: the Asserts tab, the summary card and the HTML report. */

import { crashFound, searchedCount, type CaptureInfo, type CrashKind, type MessageEntry } from "@/lib/engine/types";

export const KIND_LABEL: Record<CrashKind, string> = {
  assert: "Assert",
  exception: "Exception",
  watchdog: "Watchdog",
  reset: "Reset",
  memory: "Memory failure",
  panic: "Panic",
  fatal: "Fatal error",
};

/** Kinds that are a crash for certain; resets, memory and fatal lines can be routine trace text. */
export const SURE: CrashKind[] = ["assert", "exception", "watchdog", "panic"];

/** HH:MM:SS.mmm of a time that may carry a date in front. */
export function clockOf(ts?: string | null) {
  if (!ts) return null;
  return /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,6})$/.exec(ts.trim())?.[1]?.replace(",", ".") ?? ts;
}

/** The messages logged just before a crash: what the modem was handling when it stopped. */
export function messagesBefore(messages: MessageEntry[], ts?: string | null, n = 3) {
  const t = clockOf(ts);
  if (!t) return [];
  return messages.filter((m) => m.timestamp && m.timestamp <= t).slice(-n);
}

export function crashCounts(c: CaptureInfo["crashes"]) {
  const strong = c?.groups.filter((g) => g.strong) ?? [];
  const weak = c?.groups.filter((g) => !g.strong) ?? [];
  return {
    records: c?.events.length ?? 0,
    strong,
    weak,
    strongLines: strong.reduce((n, g) => n + g.count, 0),
    weakLines: weak.reduce((n, g) => n + g.count, 0),
    searched: searchedCount(c),
  };
}

/** A memory dump with no readable assert in it. */
export const dumpOnly = (e: { fromDump?: boolean; where?: string; expression?: string; kind: CrashKind }) =>
  Boolean(e.fromDump && !e.where && !e.expression && e.kind === "reset");

/** The statement at the top of the Asserts page. */
export function crashHeadline(c: CaptureInfo["crashes"]) {
  const n = crashCounts(c);
  const found = crashFound(c);
  const first = c?.events[0];
  const line = n.strong[0];
  const head = first
    ? `${first.title}${first.ts ? ` at ${first.ts}` : ""}.`
    : line
      ? `${KIND_LABEL[line.kind]} ${line.first ? `at ${line.first}` : "in the log"}: ${line.text.slice(0, 140)}`
      : n.searched
        ? `No assert or crash in any of the ${n.searched} files.`
        : "No file in this log was searched for asserts.";
  const detail = [
    `${n.searched} ${n.searched === 1 ? "file" : "files"} searched line by line, the .logel and Logel's decoded traces included`,
    n.records ? `${n.records} assert ${n.records === 1 ? "record" : "records"} read field by field` : null,
    n.strongLines ? `${n.strongLines} assert or crash ${n.strongLines === 1 ? "line" : "lines"} (${n.strong.length} different)` : null,
    n.weakLines ? `${n.weakLines} ${n.weakLines === 1 ? "line mentions" : "lines mention"} one in passing` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const kick = found ? (n.records > 1 ? `${n.records} modem crashes` : "The modem crashed") : "No assert or crash";
  const todo = found
    ? "Send the assert record, the .logel and the modem build to UNISOC: the file and line point them at the cause. Check what the network sent just before it."
    : undefined;
  return { found, kick, head, detail: `${detail}.`, todo, n };
}
