/**
 * Asserts and crashes: find every trace of one in a capture.
 *
 *  - parseAssert(): a modem assert record (UNISOC Logel saves it as .ass). The layout varies by
 *    modem version and tool, so it is read as text (UTF-16 or 8-bit, or the printable strings of
 *    a binary file) and every known field is looked for: where the modem stopped (source file,
 *    line, module), why (expression, message), the task, the exception, registers, call stack,
 *    time and software version. The whole text is kept as well.
 *  - scanText(): crash, assert, exception, watchdog, reset and memory failure lines in any text,
 *    so no file is left unsearched.
 */

import type { AssertRecord, CrashKind } from "@/lib/engine/types";

export type { AssertRecord, CrashKind };

export interface CrashLine {
  file: string;
  kind: CrashKind;
  /** a firm sign of a crash, not just a word in a trace */
  strong: boolean;
  text: string;
  /** byte offset of the line in the file (for the trace view index) */
  offset: number;
  ts?: string | null;
}

// --- text out of any file ---------------------------------------------------------------

/** Text of a file: UTF-16 with or without a BOM, UTF-8 / 8-bit, or a binary's printable strings. */
export function fileText(b: Uint8Array, max = 8 * 1024 * 1024): { text: string; binary: boolean } {
  const head = b.subarray(0, Math.min(b.length, max));
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return { text: new TextDecoder("utf-16le").decode(head.subarray(2)), binary: false };
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) return { text: new TextDecoder("utf-16be").decode(head.subarray(2)), binary: false };
  let zeroOdd = 0;
  let zeroEven = 0;
  let ctrl = 0;
  const n = Math.min(head.length, 4096);
  for (let i = 0; i < n; i++) {
    const c = head[i];
    if (c === 0) {
      if (i % 2) zeroOdd++;
      else zeroEven++;
    }
    else if (c < 9 || (c > 13 && c < 32)) ctrl++;
  }
  if (n > 16 && zeroOdd > n * 0.35 && zeroEven < n * 0.05) return { text: new TextDecoder("utf-16le").decode(head), binary: false };
  if (zeroOdd + zeroEven + ctrl < n * 0.02) return { text: new TextDecoder("utf-8", { fatal: false }).decode(head), binary: false };
  return { text: printableStrings(head), binary: true };
}

/** Printable runs of a binary file, one per line (like the `strings` tool). */
export function printableStrings(b: Uint8Array, min = 5): string {
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i <= b.length; i++) {
    const c = i < b.length ? b[i] : 0;
    const ok = c === 9 || (c >= 32 && c < 127);
    if (ok && start < 0) start = i;
    else if (!ok && start >= 0) {
      if (i - start >= min) out.push(String.fromCharCode(...b.subarray(start, Math.min(i, start + 2000))));
      start = -1;
    }
  }
  return out.join("\n");
}

// --- what counts as a crash --------------------------------------------------------------

const STRONG: { kind: CrashKind; re: RegExp }[] = [
  { kind: "assert", re: /\b(?:SCI_P?ASSERT|ASSERT_INFO|MODEM_ASSERT|CP_ASSERT)\b/ },
  { kind: "assert", re: /\b(?:modem|cp|ps|phy|dsp|l1)\s*assert/i },
  { kind: "assert", re: /\bassert(?:ion)?\s*(?:failed|failure|fail\b|error|happen|occur|info|in\s+file|at\s+file|in\s+\S+\.(?:c|cpp|h)\b|file\s*[:=])/i },
  { kind: "assert", re: /\bassert(?:ion)?\b.{0,80}\bline\s*[:=#]?\s*\d+/i },
  { kind: "exception", re: /\b(?:data|prefetch)\s*abort\b/i },
  { kind: "exception", re: /\bundef(?:ined)?\s*(?:instruction|inst)\b/i },
  { kind: "exception", re: /\b(?:hard|bus|usage|mem(?:ory)?\s*manage)\s*fault\b/i },
  { kind: "exception", re: /\bexception\s*(?:occur|happen|type|vector|caught|raised)/i },
  { kind: "exception", re: /\b(?:SIGSEGV|SIGABRT|SIGBUS|SIGILL)\b|\bsegmentation\s+fault\b/i },
  { kind: "panic", re: /\bkernel\s+panic\b|\bpanic\s*[:!]/i },
  { kind: "watchdog", re: /\bwatch\s*dog\b.{0,30}\b(?:timeout|time\s*out|reset|expir|bark|bite|trigger)|\bwd[tg]\s*(?:timeout|reset|expir)/i },
  { kind: "reset", re: /\b(?:modem|cp)\s*(?:crash|crashed|reset|reboot|restart|dump|exception)\b|\bsilent\s+reset\b|\bsystem\s+reset\s+reason\b/i },
  { kind: "memory", re: /\bstack\s*overflow\b|\bout\s+of\s+memory\b|\bheap\s*(?:corrupt|overflow)\b|\bmemory\s+(?:exhausted|leak\s+detected)\b|\b(?:malloc|alloc(?:ation)?)\s+fail/i },
  { kind: "fatal", re: /\bfatal\s+(?:error|exception|fault)\b/i },
];

/** Plain mentions: a trace that names one of these is worth listing, but it is not proof of a crash. */
const WEAK: { kind: CrashKind; re: RegExp }[] = [
  { kind: "assert", re: /\bassert(?:ion)?\b/i },
  { kind: "exception", re: /\bexception\b|\babort\b(?!_)/i },
  { kind: "panic", re: /\bpanic\b/i },
  { kind: "watchdog", re: /\bwatch\s*dog\b|\bwdt\b/i },
  { kind: "reset", re: /\bcrash(?:ed)?\b|\breboot(?:ed)?\b/i },
  { kind: "fatal", re: /\bfatal\b/i },
];

/** Words worth a closer look; ordinary trace words such as "default" or "reset timer" do not match. */
const SCAN =
  /assert|abort|(?:hard|bus|usage|manage)\s*fault|\bfault\b|exception|panic|watch\s*dog|\bwd[tg]\b|crash|reboot|(?:modem|cp)\s*(?:reset|restart|dump)|silent\s+reset|reset\s+reason|fatal|stack\s*overflow|heap\s*(?:corrupt|overflow)|out\s+of\s+memory|m?alloc(?:ation)?\s+fail|sig(?:segv|abrt|bus|ill)|segmentation\s+fault|undef(?:ined)?\s*inst/i;
const ANY = SCAN;

export function classify(line: string): { kind: CrashKind; strong: boolean } | null {
  if (!ANY.test(line)) return null;
  for (const s of STRONG) if (s.re.test(line)) return { kind: s.kind, strong: true };
  for (const w of WEAK) if (w.re.test(line)) return { kind: w.kind, strong: false };
  return null;
}

/**
 * Crash lines in a text. `sep` is what ends a line: a newline in text files, NUL in Logel's
 * trace view and in binary strings.
 */
export function scanText(text: string, file: string, baseOffset = 0, limit = 5000): CrashLine[] {
  const out: CrashLine[] = [];
  const re = new RegExp(SCAN.source, "gi");
  let last = -1;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let s = m.index;
    while (s > 0 && s > m.index - 400 && !isBreak(text.charCodeAt(s - 1))) s--;
    if (s <= last) continue;
    let e = m.index;
    while (e < text.length && e < m.index + 600 && !isBreak(text.charCodeAt(e))) e++;
    last = e;
    re.lastIndex = e;
    const line = text.slice(s, e).trim();
    if (line.length < 4) continue;
    const c = classify(line);
    if (!c) continue;
    out.push({ file, kind: c.kind, strong: c.strong, text: line.slice(0, 400), offset: baseOffset + s });
    if (out.length >= limit) break;
  }
  return out;
}

function isBreak(c: number) {
  return c === 0 || c === 10 || c === 13;
}

// --- one assert record -------------------------------------------------------------------

const MODULES: [RegExp, string][] = [
  [/nrrc|nr_rrc|rrc_nr|nrrca/i, "NR RRC (5G radio resource control)"],
  [/lrrc|lte_rrc|rrc_lte|lrrca|\berrc/i, "LTE RRC (4G radio resource control)"],
  [/wrrc|\brrc\b/i, "RRC (radio resource control)"],
  [/ngmm|nas5g|5gmm|nr_nas/i, "5G NAS mobility (NGMM)"],
  [/ngsm|5gsm|upm/i, "5G NAS sessions (NGSM / UPM)"],
  [/\bemm|lte_nas|eps_?nas/i, "LTE NAS mobility (EMM)"],
  [/\besm\b|\bsm_/i, "NAS session management"],
  [/\bgmm|\bmm_|\bmm\b|mmctrl|plm/i, "NAS mobility / PLMN selection"],
  [/nr_?mac|nr_?rlc|nr_?pdcp|ndata|uldata|ngrant|\bl2\b|\bmac\b|\brlc\b|\bpdcp\b/i, "Layer 2 (MAC / RLC / PDCP)"],
  [/\bl1\b|phy|dsp|lte_l1|nr_l1|srch|agc|afc|\batc\b/i, "Physical layer (L1 / DSP)"],
  [/ims|sip|volte|vonr/i, "IMS (voice)"],
  [/\bsim\b|usim|uicc/i, "SIM card"],
  [/\batc\b|at_cmd|atcmd|mux/i, "AT command handling"],
  [/\bmem|heap|malloc|\bos_|thread|sched|kernel|rtos|threadx/i, "Operating system / memory"],
];

export function moduleOf(text: string): string | undefined {
  for (const [re, name] of MODULES) if (re.test(text)) return name;
  return undefined;
}

const SRC = String.raw`([A-Za-z]:)?[\w.$\\/-]*?[\w$-]+\.(?:c|cc|cpp|cxx|h|hpp|s|asm)\b`;

function firstMatch(text: string, res: RegExp[]) {
  for (const re of res) {
    const m = re.exec(text);
    if (m) return m;
  }
  return null;
}

const clean = (s?: string) => s?.replace(/\s+/g, " ").replace(/^[\s"':=,-]+|[\s"',;]+$/g, "").slice(0, 400) || undefined;

/** The first capture, over every pattern and every match, that still says something once cleaned
 *  (a heading such as "Assert Information =====" matches but holds nothing). */
function pick(text: string, res: RegExp[]) {
  for (const re of res) {
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
      const v = clean(m[1]);
      if (v && /[\w(]/.test(v)) return v;
    }
  }
  return undefined;
}

export function parseAssert(raw: string, file: string, opts: { fromDump?: boolean } = {}): AssertRecord {
  const text = raw.replace(/\r\n?/g, "\n");
  const flat = text.replace(/\s+/g, " ");
  const rec: AssertRecord = { file, kind: "assert", title: "Modem assert", registers: [], stack: [], raw: text.slice(0, 200000), fromDump: opts.fromDump };

  // where: source file and line
  const pair = firstMatch(flat, [
    new RegExp(String.raw`(${SRC})\s*[,:(]\s*(?:line\s*[:=#]?\s*)?(\d{1,6})`, "i"),
    new RegExp(String.raw`(?:file(?:\s*name)?)\s*[:=]?\s*"?(${SRC})"?.{0,40}?\bline\s*[:=#]?\s*(\d{1,6})`, "i"),
  ]);
  if (pair) {
    rec.source = pair[1].replace(/\\/g, "/");
    rec.line = Number(pair[pair.length - 1]);
  } else {
    const src = new RegExp(SRC, "i").exec(flat);
    if (src) rec.source = src[0].replace(/\\/g, "/");
    const ln = /\bline\s*[:=#]?\s*(\d{1,6})/i.exec(flat);
    if (ln) rec.line = Number(ln[1]);
  }
  if (rec.source) rec.where = `${rec.source.split("/").pop()}${rec.line ? ` line ${rec.line}` : ""}`;

  // why
  rec.expression = pick(text, [
    /\b(?:exp(?:ression)?|condition|cond)\s*[:=](?!=)\s*(.+)/i,
    /\bassert(?:ion)?\s*(?:failed)?\s*[:=]?\s*\(\s*(.+?)\s*\)\s*(?:$|[,;])/im,
    /\bSCI_P?ASSERT\s*\(\s*(.+?)\s*\)/i,
  ]);
  rec.message = pick(text, [
    /\bassert\s*info(?:rmation)?\s*[:=](?!=)\s*(.+)/i,
    /\b(?:assert\s*)?(?:message|msg|reason|description|cause|detail)\s*[:=](?!=)\s*(.+)/i,
    /\binfo\s*[:=](?!=)\s*(.+)/i,
  ]);

  rec.task = pick(text, [/\b(?:current\s*)?(?:task|thread|process)\s*(?:name)?\s*[:=]\s*([\w.\-[\]]+)/i, /\b(?:task|thread)\s*id\s*[:=]\s*((?:0x)?[0-9a-f]+)/i]);

  const exc = /\b(data\s*abort|prefetch\s*abort|undef(?:ined)?\s*(?:instruction|inst)|hard\s*fault|bus\s*fault|usage\s*fault|mem(?:ory)?\s*manage\s*fault|watch\s*dog(?:\s*(?:timeout|reset))?|stack\s*overflow|divide\s*by\s*zero|out\s+of\s+memory|kernel\s+panic|SIGSEGV|SIGABRT|SIGBUS|SIGILL)\b/i.exec(flat);
  if (exc) rec.exception = exc[1].replace(/\s+/g, " ");

  rec.ts =
    /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[ T_]\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,6})?)/.exec(flat)?.[1] ??
    /(?:time|timestamp|tick)\s*[:=]?\s*(\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,6})?)/i.exec(flat)?.[1] ??
    /(?<![\d:])(\d{1,2}:\d{2}:\d{2}\.\d{1,6})(?![\d:])/.exec(flat)?.[1] ??
    null;
  rec.version = pick(text, [/\b(?:sw\s*ver(?:sion)?|software\s*version|version|platform|base\s*version|build)\s*[:=](?!=)\s*([^\n]+)/i]);

  // registers: R0..R15, PC, LR, SP, CPSR ...
  const seen = new Set<string>();
  for (const m of text.matchAll(/\b(R(?:1[0-5]|[0-9])|PC|LR|SP|FP|IP|CPSR|SPSR|PSR|XPSR|MSP|PSP)\s*[:=]\s*((?:0x)?[0-9a-fA-F]{1,8})\b/g)) {
    const name = m[1].toUpperCase();
    if (seen.has(name)) continue;
    seen.add(name);
    rec.registers.push({ name, value: m[2].startsWith("0x") ? m[2] : `0x${m[2]}` });
    if (rec.registers.length >= 24) break;
  }

  // call stack: the lines after a "call stack" / "backtrace" heading, or address + function lines
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /call\s*stack|back\s*trace|stack\s*trace|callstack|stack\s*dump/i.test(l));
  const frame = /(?:#\d+\s*)?(?:0x)?[0-9a-fA-F]{6,8}\b/;
  if (at >= 0) {
    for (const l of lines.slice(at + 1, at + 80)) {
      if (!l.trim()) {
        if (rec.stack.length) break;
        continue;
      }
      if (!frame.test(l) && !/\w+\s*\+\s*0x[0-9a-f]+/i.test(l)) {
        if (rec.stack.length) break;
        continue;
      }
      rec.stack.push(l.trim().slice(0, 200));
    }
  }
  if (!rec.stack.length) {
    for (const l of lines) if (/^\s*(?:#\d+|\[\s*\d+\s*\])?\s*(?:0x)?[0-9a-fA-F]{8}\s+[A-Za-z_]\w{2,}/.test(l)) rec.stack.push(l.trim().slice(0, 200));
    rec.stack = rec.stack.slice(0, 64);
  }

  const kindText = `${rec.exception ?? ""} ${flat.slice(0, 2000)}`;
  if (/watch\s*dog|\bwd[tg]\b/i.test(rec.exception ?? "")) rec.kind = "watchdog";
  else if (/abort|fault|undef|SIG/i.test(rec.exception ?? "")) rec.kind = "exception";
  else if (/panic/i.test(rec.exception ?? "")) rec.kind = "panic";
  else if (/overflow|out of memory/i.test(rec.exception ?? "")) rec.kind = "memory";
  else if (!/assert/i.test(kindText) && rec.exception) rec.kind = "exception";
  rec.module = moduleOf(`${rec.source ?? ""} ${rec.task ?? ""}`) ?? moduleOf(`${rec.expression ?? ""} ${rec.message ?? ""}`);
  const what = rec.kind === "assert" ? "Modem assert" : rec.kind === "watchdog" ? "Modem watchdog reset" : rec.kind === "memory" ? "Modem memory failure" : rec.exception ? `Modem crash: ${rec.exception}` : "Modem crash";
  rec.title = `${what}${rec.module ? ` in ${rec.module.replace(/\s*\(.*\)$/, "")}` : ""}${rec.where ? ` (${rec.where})` : ""}`;
  return rec;
}

/** Does this text look like it holds an assert record at all (for dumps and unknown files)? */
export function looksLikeAssert(text: string) {
  return /\bassert(?:ion)?\b/i.test(text) && (new RegExp(SRC, "i").test(text) || /\bline\s*[:=#]?\s*\d+/i.test(text));
}

/** File names that only exist after a crash. */
export const CRASH_FILE = /\.(?:ass|dmp|mdmp|core|mem)$|assert|crash|panic|tombstone|minidump|memdump|mem_dump|coredump|core_dump|ramdump|ram_dump|cpdump|cp_dump|modem_dump|watchdog|exception|\bdump\b|_dump\b/i;
