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

import type { AssertMemory, AssertRecord, CoreAssert, CrashKind } from "@/lib/engine/types";

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
  { kind: "assert", re: /\bassert(?:ion)?\b|AT\+SPATASSERT/i },
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
    const line = printable(text.slice(s, e)).trim();
    if (line.length < 4) continue;
    const c = classify(line);
    if (!c) continue;
    out.push({ file, kind: c.kind, strong: c.strong, text: line.slice(0, 400), offset: baseOffset + s });
    if (out.length >= limit) break;
  }
  return out;
}

/** Control characters (binary bytes around a trace) out of a line. */
function printable(s: string) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c === 9 || (c >= 32 && c !== 127) ? s[i] : "";
  }
  return out;
}

function isBreak(c: number) {
  return c === 0 || c === 10 || c === 13;
}

// --- one assert record -------------------------------------------------------------------

/** The part of the modem a source file or task belongs to, from the words in its name. */
const MODULES: [RegExp, string][] = [
  [/ (?:nrrc\w*|nrsib|nrrca|nr rrc|rrc nr) /, "NR RRC (5G radio resource control)"],
  [/ (?:lrrc\w*|errc|lte rrc|rrc lte) /, "LTE RRC (4G radio resource control)"],
  [/ (?:wrrc\w*|rrc|rrdm|rrtm) /, "RRC (radio resource control)"],
  [/ (?:ngmm|5gmm|nas5g|nr nas) /, "5G NAS mobility (NGMM)"],
  [/ (?:ngsm|5gsm|upm) /, "5G NAS sessions (NGSM / UPM)"],
  [/ (?:emm|eps nas|lte nas) /, "LTE NAS mobility (EMM)"],
  [/ (?:esm|sm) /, "NAS session management"],
  [/ (?:gmm|mm|mmctrl|plmn|mn) /, "NAS mobility / PLMN selection"],
  [/ (?:atc|at cmd|atcmd|mux|sio) /, "AT command handling"],
  [/ (?:nrmac|nrrlc|nrpdcp|mac|rlc|pdcp|l2|ndata|uldata|ngrant) /, "Layer 2 (MAC / RLC / PDCP)"],
  [/ (?:l1|phy|nrphy|v3phy|nr phy|v3 phy|dsp|srch|agc|afc|nrcp|layer1) /, "Physical layer (L1 / DSP)"],
  [/ (?:ims|sip|volte|vonr) /, "IMS (voice)"],
  [/ (?:sim|usim|uicc|simlock) /, "SIM card"],
  [/ (?:threadx|os|osa|kal|mem|heap|malloc|sched|kernel|rtos|smp|tx) /, "Operating system / memory"],
];

export function moduleOf(text: string): string | undefined {
  const words = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  for (const [re, name] of MODULES) if (re.test(words)) return name;
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

/** A printf template ("psAssert %s") is firmware text, not something that happened. */
export const isTemplate = (s: string) => /%[-+ #0]*\d*(?:\.\d+)?[hlLzjt]*[sdiuxXcpfeEgG]/.test(s);

/** Commands that make the modem assert on request, to save a memory dump. */
const FORCED = /\b(AT\+SPATASSERT|AT\+SPDUMP\w*|AT\+ARMLOG\w*ASSERT\w*)\b|assert(?:ed)?\s+by\s+(AT\+\w+|user|host|tool|command)/i;

/** "Modem Assert: T_P_ATC PS CP assert in file atc_basic_cmd.c line 26348 exp=FALSE info=[Assert by AT+SPATASSERT]" */
export function parseCoreAssert(line: string, from: string, ts?: string | null): CoreAssert | null {
  if (isTemplate(line)) return null;
  const m = /Modem Assert:\s*(.*?)\s*assert in file\s+(\S+)\s+line\s+(\d+)(?:\s+exp=(.*?))?(?:\s+info=\[(.*?)\])?\s*$/i.exec(line);
  if (!m) return null;
  const who = m[1].trim().split(/\s+/).filter(Boolean);
  const task = who.length > 1 && /_|^T\w/.test(who[0]) ? who.shift() : undefined;
  return {
    core: who.join(" ") || "Modem",
    task,
    file: m[2],
    line: Number(m[3]),
    exp: m[4]?.trim() || undefined,
    info: m[5]?.trim() || undefined,
    ts: ts ?? null,
    from,
  };
}

const REG = /\b(R(?:1[0-5]|[0-9])|PC|LR|SP|FP|IP|CPSR|SPSR|PSR|XPSR|MSP|PSP)\s*[:=]\s*((?:0x)?[0-9a-fA-F]{1,8})\b/gi;

function registersIn(text: string, limit = 24) {
  const out: { name: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(REG)) {
    const name = m[1].toUpperCase();
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, value: m[2].toLowerCase().startsWith("0x") ? `0x${m[2].slice(2)}` : `0x${m[2]}` });
    if (out.length >= limit) break;
  }
  return out;
}

const hexSize = (s?: string) => (s ? (/^0x/i.test(s) ? parseInt(s, 16) : Number(s)) : undefined);
const baseName = (p: string) => p.trim().split(/[\\/]/).pop() ?? p.trim();

/** Allocation lists: "No. Size Entity_ID FileName (Line N)(addr 0x..)", summed per place and per entity. */
function allocations(lines: string[]) {
  const sites = new Map<string, { count: number; bytes: number }>();
  const entities = new Map<string, { count: number; bytes: number }>();
  let entries = 0;
  let bytes = 0;
  for (const l of lines) {
    const m = /^\s*\d+\s+(\d+)\s+(\S+)\s+(.*?)\s*\(\s*Line\s*(\d+)\s*\)/i.exec(l);
    if (!m) continue;
    const size = Number(m[1]);
    const entity = m[2];
    // "nrsib.c_0x95D" or "3  File code: 529" or "threadx_os.c"
    const where = m[3].replace(/^\d+\s+/, "").replace(/(\.\w+)_0x[0-9a-f]+$/i, "$1").replace(/\s+/g, " ").trim() || "unknown";
    const site = `${where} line ${m[4]}`;
    entries++;
    bytes += size;
    const s = sites.get(site) ?? { count: 0, bytes: 0 };
    s.count++;
    s.bytes += size;
    sites.set(site, s);
    const e = entities.get(entity) ?? { count: 0, bytes: 0 };
    e.count++;
    e.bytes += size;
    entities.set(entity, e);
  }
  const top = (m: Map<string, { count: number; bytes: number }>, n: number) =>
    [...m].map(([site, v]) => ({ site, ...v })).sort((a, b) => b.count - a.count || b.bytes - a.bytes).slice(0, n);
  return { entries, bytes, top: top(sites, 10), byEntity: top(entities, 8) };
}

/**
 * A UNISOC modem assert record, as Logel saves it in <log>.ass and as the modem prints it on its
 * assert console (also inside the .logel):
 *
 *   ====core0 assert 1====            Current Version: Platform / Project / BASE / HW Version, build time
 *   File:  atc_basic_cmd.c            Line:  26348            PASSERT(FALSE)
 *    > Assert by AT+SPATASSERT        Current thread info: ID, Name, Queue ...
 *   NRCP CORE0 PC=(...) ...           Current status is SVC, below is the registers before assert:
 *   Current / SVC / IRQ / Abort / Undefined / FIQ mode registers
 *   Dump All Memory To One File: regions, "Saving memory data to file: ..._1.mem; size: 0x.."
 *   pool_used_counter info, Allocated memory info (block pool / byte pool / initialized mem)
 */
function parseUnisoc(text: string, rec: AssertRecord): boolean {
  const lines = text.split("\n").map((l) => l.replace(/^\s*>\s?/, "").replace(/\s+$/, ""));
  const fileAt = lines.findIndex((l) => /^\s*File:\s*\S+/.test(l));
  const lineAt = lines.findIndex((l, i) => i > fileAt && /^\s*Line:\s*\d+/.test(l));
  if (fileAt < 0 || lineAt < 0 || lineAt - fileAt > 3) return false;

  rec.source = /File:\s*(\S+)/.exec(lines[fileAt])![1].replace(/\\/g, "/");
  rec.line = Number(/Line:\s*(\d+)/.exec(lines[lineAt])![1]);
  rec.where = `${baseName(rec.source)} line ${rec.line}`;
  const next = lines.slice(lineAt + 1).filter((l) => l.trim());
  const isHeading = (l: string) => /^(Current |Print |=+|NRCP|PSCP|V3PHY|Region name|Assert Debug Menu)/i.test(l.trim());
  if (next[0] && !isHeading(next[0])) rec.expression = clean(next[0]);
  if (next[1] && !isHeading(next[1])) rec.message = clean(next[1]);

  const head = /core\s*(\d+)\s+assert\s+(\d+)/i.exec(text);
  if (head) {
    rec.core = `core${head[1]}`;
    rec.number = Number(head[2]);
  }
  const versions: { label: string; value: string }[] = [];
  for (const l of lines) {
    const m = /^\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)\s+Version:\s*(\S.*)$/.exec(l);
    if (m && !versions.some((v) => v.label === m[1].trim())) versions.push({ label: m[1].replace(/\s+/g, " ").trim(), value: m[2].trim() });
    if (versions.length >= 6) break;
  }
  if (versions.length) {
    rec.versions = versions;
    rec.version = versions.find((v) => /base/i.test(v.label))?.value ?? versions[0].value;
  }
  const build = lines.find((l) => /^\s*\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}:\d{2}\s*$/.test(l));
  if (build) rec.build = build.trim();

  // the running task
  const th = lines.findIndex((l) => /^\s*Current thread info:/i.test(l));
  if (th >= 0) {
    const thread: { label: string; value: string }[] = [];
    for (const l of lines.slice(th + 1, th + 40)) {
      const m = /^\s*([A-Za-z][\w ]*?):\s+(\S.*)$/.exec(l);
      if (m) thread.push({ label: m[1].replace(/_/g, " "), value: m[2].trim() });
      else if (thread.length && l.trim() && !/^\s*$/.test(l)) break;
    }
    if (thread.length) {
      rec.thread = thread;
      rec.task = thread.find((t) => /^name$/i.test(t.label))?.value;
    }
  }

  rec.corePcs = [];
  for (const l of lines) {
    const m = /^\s*(.+?)\s+PC=\(([^)]*)\)/.exec(l);
    if (m && !rec.corePcs.some((c) => c.core === m[1])) rec.corePcs.push({ core: m[1].trim(), pc: m[2].replace(/\s+/g, " ") });
  }
  rec.cpuMode = /Current status is (\w+)/i.exec(text)?.[1];

  // registers before the assert, then the banked ones of each CPU mode
  const modeAt = lines.map((l, i) => ({ i, m: /^\s*(Current|SVC|IRQ|FIQ|Abort|Undefined|User|System|Monitor|Hyp)\s+mode:\s*$/i.exec(l)?.[1] })).filter((x) => x.m);
  rec.banked = [];
  modeAt.forEach(({ i, m }, k) => {
    const end = modeAt[k + 1]?.i ?? i + 40;
    const regs = registersIn(lines.slice(i + 1, Math.min(end, i + 40)).join("\n"));
    if (!regs.length) return;
    // the record can print itself twice: the first "Current mode" block is the one
    if (/current/i.test(m!)) {
      if (!rec.registers.length) rec.registers = regs;
    } else if (!rec.banked!.some((b) => b.mode === m)) rec.banked!.push({ mode: m!, registers: regs });
  });
  if (!rec.registers.length) rec.registers = registersIn(text);

  // what the assert handler saved
  rec.dumps = [];
  rec.regions = [];
  let section = "";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = /^\s*=+\s*(.+?)\s*=+\s*$/.exec(l)?.[1];
    if (h) section = h;
    const r = /Region name:\s*(.+?),\s*start address=(0x[0-9a-f]+).*?Length=(0x[0-9a-f]+)/i.exec(l);
    if (r && !rec.regions.some((x) => x.name === r[1])) rec.regions.push({ name: r[1].trim(), start: r[2], length: r[3] });
    const s = /Saving memory data to file:\s*(.*)$/i.exec(l);
    if (s) {
      let target = s[1].trim();
      if (!target) target = (lines.slice(i + 1, i + 4).find((x) => x.trim()) ?? "").trim();
      const m = /^(.*?)(?:;\s*size:\s*(0x[0-9a-f]+|\d+))?\s*\.?$/i.exec(target);
      const file = baseName(m?.[1] ?? target);
      // what a file holds follows from the section that saved it
      const what = /G\/W\/T\/L RFIC/i.test(section)
        ? "2G / 3G / TD / LTE radio chip (RFIC) registers"
        : /NR RFIC/i.test(section)
          ? "5G radio chip (RFIC) registers"
          : /Sme/i.test(section) || /\.logel$/i.test(file)
            ? "Logel trace buffer saved with the assert"
            : /Dump All Memory/i.test(section)
              ? "Modem memory: every region listed below"
              : `Saved by the assert (${section || "memory dump"})`;
      if (file && !rec.dumps.some((d) => d.file === file)) rec.dumps.push({ file, size: hexSize(m?.[2]), what });
    }
  }
  const finished = /Memory Dumping Finished:.*?total size=(\d+)/i.exec(text);
  const all = rec.dumps.find((d) => /every region/.test(d.what));
  if (finished && all && !all.size) all.size = Number(finished[1]);

  // memory: the allocation lists, summed, and any sign the lists were damaged
  const sec = (re: RegExp) => {
    const from = lines.findIndex((l) => re.test(l));
    if (from < 0) return null;
    const to = lines.findIndex((l, i) => i > from && /^\s*=+.*=+\s*$/.test(l));
    return lines.slice(from + 1, to < 0 ? undefined : to);
  };
  const memory: AssertMemory = {};
  const block = sec(/Allocated memory info\s*\(in block pool\)/i);
  if (block) memory.blockPool = allocations(block);
  const byte = sec(/Allocated memory info\s*\(in byte pool\)/i);
  if (byte) {
    const a = allocations(byte);
    const bad = byte.find((l) => /corrupt|abnormal termination/i.test(l));
    memory.bytePool = { entries: a.entries, bytes: a.bytes, top: a.top, corrupted: bad?.trim() };
  }
  const init = sec(/Allocated memory info\s*\(in initiali[sz]ed mem\)/i);
  if (init) memory.initialized = allocations(init);
  if (block || byte || init) {
    // the last list printed runs to the end of the record: if it stops mid-list, say so
    const tail = lines.filter((l) => l.trim()).slice(-1)[0] ?? "";
    if (/\(addr\s+0x[0-9a-f]+\s*\)\s*$/i.test(tail) && !/=+/.test(tail)) memory.cutShort = "The record ends in the middle of a memory list: the log stopped while the modem was still printing it.";
    rec.memory = memory;
  }

  rec.sections = [
    ...new Set(
      lines
        .map((l) => /^\s*=+\s*(.+?)\s*=+\s*$/.exec(l)?.[1])
        .filter((x): x is string => Boolean(x))
        .map((x) => x.replace(/\s+/g, " ")),
    ),
  ];
  const menu = /^\s*[0-9a-z]\.\s/;
  rec.commands = [
    ...new Set(
      text
        .split("\n")
        .map((l) => /^\s*>\s*([a-z0-9][\w+=-]*)\s*$/i.exec(l)?.[1])
        .filter((x): x is string => Boolean(x) && !menu.test(`${x}. `)),
    ),
  ].slice(0, 12);

  const forced = FORCED.exec(`${rec.message ?? ""} ${rec.expression ?? ""}`) ?? FORCED.exec(text.slice(0, 4000));
  if (forced) rec.forced = (forced[1] ?? forced[2]).toUpperCase().startsWith("AT+") ? (forced[1] ?? forced[2]).toUpperCase() : forced[2];
  return true;
}

export function parseAssert(raw: string, file: string, opts: { fromDump?: boolean } = {}): AssertRecord {
  const text = raw.replace(/\r\n?/g, "\n").replace(/\r/g, "");
  const flat = text.replace(/\s+/g, " ");
  const rec: AssertRecord = { file, kind: "assert", title: "Modem assert", registers: [], stack: [], raw: text.slice(0, 400000), fromDump: opts.fromDump };

  if (!parseUnisoc(text, rec)) {
    // any other layout: look for each field by its usual names
    const pair = firstMatch(flat, [
      new RegExp(String.raw`(?:file(?:\s*name)?)\s*[:=]?\s*"?(${SRC})"?.{0,40}?\bline\s*[:=#]?\s*(\d{1,6})`, "i"),
      new RegExp(String.raw`(${SRC})\s*[,:(]\s*(?:line\s*[:=#]?\s*)?(\d{1,6})`, "i"),
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
    if (rec.source) rec.where = `${baseName(rec.source)}${rec.line ? ` line ${rec.line}` : ""}`;
    rec.expression = pick(text, [
      /\b(?:exp(?:ression)?|condition|cond)\s*[:=](?!=)\s*(.+)/i,
      /\bassert(?:ion)?\s*(?:failed)?\s*[:=]?\s*\(\s*(.+?)\s*\)\s*(?:$|[,;])/im,
      /\bS?C?I?_?P?ASSERT\s*\(\s*(.+?)\s*\)/i,
    ]);
    rec.message = pick(text, [
      /\bassert\s*info(?:rmation)?\s*[:=](?!=)\s*(.+)/i,
      /\b(?:assert\s*)?(?:message|msg|reason|description|cause|detail)\s*[:=](?!=)\s*(.+)/i,
      /\binfo\s*[:=](?!=)\s*(.+)/i,
    ]);
    rec.task = pick(text, [/\b(?:current\s*)?(?:task|thread|process)\s*(?:name)?\s*[:=]\s*([\w.\-[\]]+)/i, /\b(?:task|thread)\s*id\s*[:=]\s*((?:0x)?[0-9a-f]+)/i]);
    rec.version = pick(text, [/\b(?:sw\s*ver(?:sion)?|software\s*version|version|platform|base\s*version|build)\s*[:=](?!=)\s*([^\n]+)/i]);
    rec.registers = registersIn(text);
    const forced = FORCED.exec(flat.slice(0, 4000));
    if (forced) rec.forced = (forced[1] ?? forced[2]).toUpperCase();
  }

  const exc = /\b(data\s*abort|prefetch\s*abort|undef(?:ined)?\s*(?:instruction|inst)|hard\s*fault|bus\s*fault|usage\s*fault|mem(?:ory)?\s*manage\s*fault|watch\s*dog\s*(?:timeout|reset|expired)|stack\s*overflow|divide\s*by\s*zero|kernel\s+panic)\b/i.exec(
    `${rec.expression ?? ""} ${rec.message ?? ""} ${flat.slice(0, 3000)}`,
  );
  if (exc && !rec.forced) rec.exception = exc[1].replace(/\s+/g, " ");

  // a time of day in the record (the build time printed with the versions is not one)
  const noBuild = rec.build ? flat.replace(rec.build, "") : flat;
  rec.ts =
    /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[ T_]\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,6})?)/.exec(noBuild)?.[1] ??
    /(?:assert\s*time|time|timestamp)\s*[:=]\s*(\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,6})?)/i.exec(noBuild)?.[1] ??
    null;

  // call stack: the lines after a "call stack" / "backtrace" heading, or address + function lines
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /call\s*stack|back\s*trace|stack\s*trace|callstack|stack\s*dump/i.test(l) && !/^\s*>?\s*[0-9a-z]\.\s/i.test(l));
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

  if (/watch\s*dog/i.test(rec.exception ?? "")) rec.kind = "watchdog";
  else if (/abort|fault|undef/i.test(rec.exception ?? "")) rec.kind = "exception";
  else if (/panic/i.test(rec.exception ?? "")) rec.kind = "panic";
  else if (/overflow/i.test(rec.exception ?? "")) rec.kind = "memory";
  rec.module = moduleOf(`${rec.source ?? ""} ${rec.task ?? ""}`) ?? moduleOf(`${rec.expression ?? ""} ${rec.message ?? ""}`);
  rec.title = assertTitle(rec);
  return rec;
}

export function assertTitle(rec: AssertRecord) {
  const where = rec.where ? ` (${rec.where})` : "";
  if (rec.forced) return `Assert requested by ${rec.forced}${where}`;
  const what =
    rec.kind === "assert" ? "Modem assert" : rec.kind === "watchdog" ? "Modem watchdog reset" : rec.kind === "memory" ? "Modem memory failure" : rec.exception ? `Modem crash: ${rec.exception}` : "Modem crash";
  const part = rec.module?.replace(/\s*\(.*\)$/, "") ?? (rec.core && !/^core\d/.test(rec.core) ? rec.core : undefined);
  return `${what}${part ? ` in ${part}` : ""}${where}`;
}

/** Does this text look like it holds an assert record at all (for dumps and unknown files)? */
export function looksLikeAssert(text: string) {
  return (/\bassert(?:ion)?\b/i.test(text) && (new RegExp(SRC, "i").test(text) || /\bline\s*[:=#]?\s*\d+/i.test(text))) || /^\s*File:\s*\S+\s*\n\s*Line:\s*\d+/m.test(text);
}

/** What a memory dump file is, from its first bytes. */
export function dumpKind(head: Uint8Array): { what: string; detail: string } | null {
  if (head.length >= 4 && head[0] === 0x78 && head[1] === 0x56 && head[2] === 0x34 && head[3] === 0x12)
    return { what: "Modem memory dump", detail: "A copy of the modem's memory at the assert (every region the assert record lists)." };
  if (head.length >= 8 && String.fromCharCode(...head.subarray(0, 8)) === "RFICDEBG")
    return { what: "RFIC register dump", detail: "The radio chip's registers at the assert." };
  if (head.length >= 4 && String.fromCharCode(...head.subarray(0, 4)) === "MDMP") return { what: "Minidump", detail: "A crash minidump." };
  if (head.length >= 4 && head[0] === 0x7f && String.fromCharCode(...head.subarray(1, 4)) === "ELF") return { what: "Core dump (ELF)", detail: "A core file." };
  return null;
}

/** File names that only exist after a crash. */
export const CRASH_FILE = /\.(?:ass|dmp|mdmp|core|mem)$|assert|crash|panic|tombstone|minidump|memdump|mem_dump|coredump|core_dump|ramdump|ram_dump|cpdump|cp_dump|modem_dump|watchdog|exception|\bdump\b|_dump\b/i;
