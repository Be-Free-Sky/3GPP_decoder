/**
 * Open a Logel capture (a zip, a folder, or loose files), read every file in it, each with the
 * reader for its kind, and build the capture the engine decodes. Nothing is left out: a file
 * this page has no reader for is still searched line by line and described.
 */

import { isZip, listZip, readZipEntry, zipEntryStream } from "./zip";
import { fmtClock, isLogel, parseLogel, type LogelResult, type RadioSample } from "./logel";
import { pcapCount, summarizePcap, type IpSummary } from "./pcap";
import { CRASH_FILE, assertTitle, dumpKind, fileText, looksLikeAssert, parseAssert, parseCoreAssert, printableStrings, scanText, type CrashLine } from "./crash";
import type { AssertRecord, CoreAssert, CrashGroup, CrashInfo } from "@/lib/engine/types";

export interface SourceFile {
  path: string;
  name: string;
  size: number;
  read: () => Promise<Uint8Array>;
  /** the bytes in chunks, for files too large to hold whole */
  stream: () => Promise<ReadableStream<Uint8Array>>;
}

export interface CaptureSource {
  name: string;
  kind: "zip" | "folder" | "files";
  size: number;
  files: SourceFile[];
}

export type FileRole = "analysed" | "info" | "skipped";

export interface CaptureFile {
  path: string;
  name: string;
  size: number;
  role: FileRole;
  label: string;
  reason: string;
  detail?: string;
}

export interface Capture {
  name: string;
  kind: string;
  records: { ts: string | null; protocol: string; hex: string; header: string }[];
  radio: RadioSample[];
  at: { ts: string | null; line: string }[];
  device: Record<string, string>;
  stats?: { lostCount: number; lostPercent?: number; totalPackets?: number };
  ip?: IpSummary;
  files: CaptureFile[];
  span?: { date: string | null; start: string | null; end: string | null };
  notes: string[];
  crashes: CrashInfo;
}

export interface Prepared {
  capture: Capture;
  /** hex text exports to decode the classic way, when there is no .logel */
  text?: string;
}

const MB = 1024 * 1024;

export const sizeText = (n: number) =>
  n >= 1024 * MB ? `${(n / 1024 / MB).toFixed(1)} GB` : n >= MB ? `${(n / MB).toFixed(n >= 100 * MB ? 0 : 1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} bytes`;

// --- building a source ------------------------------------------------------------

function fileSource(f: File, path?: string): SourceFile {
  return {
    path: path || f.webkitRelativePath || f.name,
    name: f.name,
    size: f.size,
    read: async () => new Uint8Array(await f.arrayBuffer()),
    stream: async () => f.stream(),
  };
}

/** A zip's entries; `under` puts them in a folder named after the zip, so several zips stay apart.
 *  Zips inside it are opened too (up to 1 GB each, three levels deep), so every file is read. */
async function zipSources(blob: Blob, under?: string, depth = 0): Promise<SourceFile[]> {
  const entries = await listZip(blob);
  const prefix = under ? `${under}/` : "";
  const out: SourceFile[] = [];
  for (const e of entries) {
    if (depth < 3 && /\.zip$/i.test(e.name) && e.size > 0 && e.size <= 1024 * MB && !e.encrypted) {
      try {
        const inner = new Blob([(await readZipEntry(blob, e)) as Uint8Array<ArrayBuffer>]);
        out.push(...(await zipSources(inner, prefix + e.path.replace(/\.zip$/i, ""), depth + 1)));
        continue;
      } catch {
        /* not a zip after all: list it as it is */
      }
    }
    out.push({ path: prefix + e.path, name: e.name, size: e.size, read: () => readZipEntry(blob, e), stream: () => zipEntryStream(blob, e) });
  }
  return out;
}

export interface PickedFile {
  file: File;
  /** path inside a dropped folder */
  path?: string;
}

/** Files picked or dropped: one zip, a folder, or several files (zips inside are opened). */
export async function sourceFromFiles(picked: PickedFile[], folderName?: string): Promise<CaptureSource> {
  const out: SourceFile[] = [];
  let zipped = 0;
  for (const { file: f, path } of picked) {
    if (/\.zip$/i.test(f.name) || (picked.length === 1 && !/\.\w{1,6}$/.test(f.name) && (await isZip(f)))) {
      // one zip on its own keeps its paths; zips among other files get a folder of their own name
      const where = (path || f.webkitRelativePath || f.name).replace(/\.zip$/i, "");
      out.push(...(await zipSources(f, picked.length > 1 ? where : undefined)));
      zipped++;
    } else out.push(fileSource(f, path));
  }
  const size = picked.reduce((n, p) => n + p.file.size, 0);
  const first = picked[0];
  const tops = new Set(picked.map((p) => (p.path || p.file.webkitRelativePath || "").split("/").filter(Boolean)).filter((x) => x.length > 1).map((x) => x[0]));
  const root = folderName || (tops.size === 1 ? [...tops][0] : undefined);
  if (picked.length === 1 && zipped === 1) return { name: first.file.name.replace(/\.zip$/i, ""), kind: "zip", size, files: out };
  if (root && picked.length > 1) return { name: root, kind: "folder", size, files: out };
  if (tops.size > 1) return { name: `${tops.size} folders`, kind: "folder", size, files: out };
  if (zipped > 1 && zipped === picked.length) return { name: `${zipped} zips`, kind: "zip", size, files: out };
  return { name: picked.length === 1 ? first.file.name : `${picked.length} files`, kind: "files", size, files: out };
}

const ARMLOG = /_armlog$/i;

/**
 * The logs in a selection. Logel saves each capture as a folder whose name ends in "_armlog", so
 * every such folder is one log (the deepest one, when a zip's folder holds a folder of the same
 * name). Selections without _armlog folders fall back to one log per folder holding a .logel.
 * Paths inside each log are made relative to the log's folder.
 */
export function splitLogs(src: CaptureSource): CaptureSource[] {
  const dirsOf = (path: string) => path.split("/").slice(0, -1);
  const keyOf = (path: string, test: (dir: string, parts: string[], i: number) => boolean) => {
    const parts = dirsOf(path);
    let at = -1;
    parts.forEach((d, i) => {
      if (test(d, parts, i)) at = i;
    });
    return at >= 0 ? parts.slice(0, at + 1).join("/") : null;
  };
  let groups = new Map<string, SourceFile[]>();
  for (const f of src.files) {
    const k = keyOf(f.path, (d) => ARMLOG.test(d));
    if (k) groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  // .logel files outside any _armlog folder: one log per folder that holds one
  const loose = src.files.filter((f) => !keyOf(f.path, (d) => ARMLOG.test(d)));
  const logelDirs = [...new Set(loose.filter((f) => /\.logel$/i.test(f.name)).map((f) => dirsOf(f.path).join("/")))];
  if (logelDirs.length && (groups.size || logelDirs.length > 1)) {
    for (const f of loose) {
      const dir = dirsOf(f.path).join("/");
      const home = logelDirs.filter((d) => d === "" || dir === d || dir.startsWith(`${d}/`)).sort((a, b) => b.length - a.length)[0];
      if (home !== undefined) groups.set(home || ".", [...(groups.get(home || ".") ?? []), f]);
    }
  }
  if (groups.size <= 1) return [src];
  // by folder name: Logel names folders by date and time, so this is the order they were captured
  const last = (k: string) => k.split("/").pop() ?? k;
  groups = new Map([...groups].sort(([a], [b]) => last(a).localeCompare(last(b)) || a.localeCompare(b)));
  const names = [...groups.keys()].map((k) => k.split("/").pop() || src.name);
  return [...groups].map(([key, files], i) => {
    const dup = names.filter((n) => n === names[i]).length > 1;
    const name = dup ? key : names[i];
    const cut = key === "." ? 0 : key.length + 1;
    return {
      name,
      kind: "folder" as const,
      size: files.reduce((n, f) => n + f.size, 0),
      files: files.map((f) => ({ ...f, path: f.path.slice(cut) || f.name })),
    };
  });
}

/** Is this a capture (zip, folder, .logel, several files) rather than one text export? */
export function isCaptureSelection(picked: PickedFile[]) {
  return picked.length > 1 || picked.some(({ file }) => /\.(zip|logel|cap|pcap)$/i.test(file.name));
}

/** Read every file under the dropped items, folders included. Call it inside the drop handler. */
export function filesFromDrop(dt: DataTransfer): Promise<{ picked: PickedFile[]; folder?: string }> {
  type Entry = FileSystemEntry;
  const entries = Array.from(dt.items)
    .filter((i) => i.kind === "file")
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is Entry => Boolean(e));
  const plain = Array.from(dt.files).map((file) => ({ file }));
  if (!entries.length) return Promise.resolve({ picked: plain });
  const out: PickedFile[] = [];
  const walk = async (e: Entry, prefix: string): Promise<void> => {
    if (e.isFile) {
      const file = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: prefix + file.name });
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<Entry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) await walk(c, `${prefix}${e.name}/`);
      }
    }
  };
  const folder = entries.length === 1 && entries[0].isDirectory ? entries[0].name : undefined;
  return (async () => {
    for (const e of entries) await walk(e, "");
    return { picked: out, folder };
  })();
}

// --- what each file is ------------------------------------------------------------

type Kind =
  | "logel" | "ass" | "tracedat" | "traceidx" | "cache" | "pcap" | "pcapng" | "csv" | "lst" | "ini" | "stat" | "bookmark"
  | "iq" | "media" | "chiptrace" | "dump" | "crash" | "text" | "zip";

interface Rule {
  test: RegExp;
  kind: Kind;
  label: string;
  /** what the file holds when the tool writes to it */
  holds: string;
}

const RULES: Rule[] = [
  { test: /\.logel$/i, kind: "logel", label: "Modem log (Logel)", holds: "Every RRC and NAS message, the modem's radio measurements, its AT answers, its traces and, after an assert, what the modem printed and its memory." },
  { test: /\.ass$/i, kind: "ass", label: "Modem assert record", holds: "What the modem printed when it asserted: where and why it stopped, the task, registers, the files it saved and its memory use." },
  { test: /^(traceview|phytraceview)\.dat$/i, kind: "tracedat", label: "Logel decoded traces", holds: "Logel's decoded text of every modem trace, the PHY traces too (the .logel keeps them as numbers)." },
  { test: /^(traceview|phytraceview)\.pbs$/i, kind: "traceidx", label: "Trace index", holds: "Where and when each decoded trace line was logged: used to time every line found in the decoded traces." },
  { test: /^(msgview|msgflowview|phyparamchart)\.(dat|pbs)$/i, kind: "cache", label: "Logel view cache", holds: "Logel's display cache (message list, flow and PHY charts), built from the .logel." },
  { test: /_mux\.cap$/i, kind: "pcap", label: "AT channel packets", holds: "The AT commands and answers between the host and the modem." },
  { test: /_(bt|wcn)\.cap$/i, kind: "pcap", label: "Bluetooth / Wi-Fi chip packets", holds: "Packets of the connectivity chip." },
  { test: /\.(cap|pcap)$/i, kind: "pcap", label: "IP packets", holds: "Data traffic of the modem: DNS lookups, their answers and failures." },
  { test: /\.pcapng$/i, kind: "pcapng", label: "IP packets (pcapng)", holds: "Data traffic in the pcapng format." },
  { test: /_(lte|nr|5g|gsm|wcdma|td|c2k|cdma)\.csv$/i, kind: "csv", label: "Signal measurements", holds: "Serving cell measurements Logel exported (RSRP / RSCP / RSSI, SINR / SNR)." },
  { test: /\.lst$/i, kind: "lst", label: "Log record", holds: "Modem and Logel versions, and what happened to the device while logging." },
  { test: /_modem\.ini$/i, kind: "ini", label: "Modem version", holds: "Platform, project, hardware and build time of the modem software." },
  { test: /_log_stat\.txt$/i, kind: "stat", label: "Lost-packet statistics", holds: "Packets logged and lost, for the protocol stack and the PHY: lost packets mean missing messages." },
  { test: /_bookmark\.xml$/i, kind: "bookmark", label: "Bookmarks", holds: "Bug ID, notes and bookmarks added in Logel." },
  { test: /(^|_)w?\.iq$|\.iq$/i, kind: "iq", label: "IQ samples", holds: "Raw radio samples for lab analysis." },
  { test: /(\.wvoice|_vt_(up|down)\.bin)$/i, kind: "media", label: "Call media", holds: "Voice or video call payload." },
  { test: /(\.xdsp_log|_wcn_dsp\.org|_dsp_ag_trace\.txt)$/i, kind: "chiptrace", label: "DSP trace", holds: "Trace of the DSP or the connectivity chip, in UNISOC's own format." },
  { test: /\.wrrc_log$/i, kind: "chiptrace", label: "WCDMA RRC trace", holds: "3G RRC trace." },
  { test: /_ipa_des\.bin$/i, kind: "chiptrace", label: "IP accelerator data", holds: "The modem's IP accelerator buffers." },
  { test: /\.(?:dmp|mdmp|core|mem)$|dump/i, kind: "dump", label: "Memory dump", holds: "Saved when the modem asserts: its memory or its radio chip's registers." },
  { test: CRASH_FILE, kind: "crash", label: "Crash evidence", holds: "Written when something crashed." },
  { test: /\.zip$/i, kind: "zip", label: "Archive", holds: "More files, zipped." },
  { test: /\.(txt|log|hex|csv|xml|ini|json)$/i, kind: "text", label: "Text file", holds: "Text: trace lines, settings or hex messages." },
];

const OTHER: Rule = { test: /./, kind: "text", label: "Other file", holds: "A file this page has no reader of its own for." };

const HEX_LINE = /(?:^|[\s:])(?:[0-9a-f]{2}[ ,]){7,}[0-9a-f]{2}/im;

function textOf(b: Uint8Array, max = 2 * MB) {
  return new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, max));
}

// --- the small text files -----------------------------------------------------------

function parseIni(text: string, device: Record<string, string>) {
  const map: Record<string, string> = {
    platformversion: "platform", projectversion: "project", baseversion: "modem", hwversion: "hw", buildtime: "build",
  };
  const got: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z ]+?)\s*[=:]\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    got.push(`${m[1].trim()} ${m[2]}`);
    const k = map[m[1].replace(/\s+/g, "").toLowerCase()];
    if (k && !device[k]) device[k] = m[2];
  }
  return got;
}

/** Versions, and the events Logel wrote between Start and Stop Logging ("Device is plugged out"). */
function parseLst(text: string, device: Record<string, string>) {
  const modem = /Modem Version:[ \t]*(\S+)/i.exec(text);
  const tool = /Tool Version:[ \t]*(\S+)/i.exec(text);
  const parser = /ParserLib Version:[ \t]*(\S+)/i.exec(text);
  if (modem && !device.modem) device.modem = modem[1];
  if (tool) device.tool = tool[1];
  const events = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(Start|Stop) Logging|Version:/i.test(l));
  return { modem: modem?.[1], tool: tool?.[1], parser: parser?.[1], events, stopped: /Stop Logging/i.test(text) };
}

function parseStats(text: string) {
  const all: Record<string, number> = {};
  for (const m of text.matchAll(/^\s*([^=[\]\r\n]+?)\s*=\s*([\d.]+)\s*$/gm)) all[m[1].trim()] = Number(m[2]);
  const lostCount = all["Total lost count"] ?? 0;
  return { lostCount, lostPercent: all["Total lost"] || undefined, totalPackets: all["Total package"], all };
}

function parseMeasCsv(text: string): RadioSample[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const col = (re: RegExp) => head.findIndex((h) => re.test(h));
  const t = col(/ue time|time/);
  const rsrp = col(/^(ss-?)?rsrp$/);
  const rsrq = col(/^(ss-?)?rsrq$/);
  const sinr = col(/^(ss-?)?sinr$/);
  const pci = col(/^pc(i|id)$/);
  const ch = col(/arfcn/);
  const out: RadioSample[] = [];
  for (const l of lines.slice(1)) {
    const c = l.split(",").map((x) => x.trim());
    const n = (i: number) => (i >= 0 && c[i] !== "" && Number.isFinite(Number(c[i])) ? Number(c[i]) : undefined);
    const ts = t >= 0 ? (/(\d{1,2}:\d{2}:\d{2}(?:\.\d+)?)/.exec(c[t])?.[1] ?? null) : null;
    const pt: RadioSample = { ts, rsrp: n(rsrp), rsrq: n(rsrq), sinr: n(sinr), pci: n(pci), arfcn: ch >= 0 ? n(ch) ?? Number.parseInt(c[ch]) : undefined };
    if (pt.rsrp !== undefined || pt.sinr !== undefined) out.push(pt);
  }
  return out;
}

// --- searching ------------------------------------------------------------------------

const IN_MEMORY = 48 * MB;

/** Crash lines in bytes held in memory (text files, binaries, UTF-16). */
function scanBytes(data: Uint8Array, name: string): CrashLine[] {
  const { text, binary } = fileText(data, data.length);
  if (!binary) return scanText(text, name, 0);
  const out: CrashLine[] = [];
  const dec = new TextDecoder("latin1");
  const WIN = 16 * MB;
  let lastEnd = -1;
  for (let w = 0; w < data.length; w += WIN) {
    const from = Math.max(0, w - 1024);
    for (const hit of scanText(dec.decode(data.subarray(from, Math.min(data.length, w + WIN))), name, from)) {
      if (hit.offset <= lastEnd) continue;
      lastEnd = hit.offset;
      out.push(hit);
    }
  }
  return out;
}

/** Crash lines in a file read chunk by chunk (Logel's 400 MB decoded traces, memory dumps). */
async function scanStream(f: SourceFile, progress: (done: number) => void): Promise<CrashLine[]> {
  const reader = (await f.stream()).getReader();
  const dec = new TextDecoder("latin1");
  const out: CrashLine[] = [];
  let pending: Uint8Array[] = [];
  let pendingSize = 0;
  let pos = 0; // file offset of the first pending byte
  let carry = "";
  let lastEnd = -1;
  const flush = () => {
    const buf = new Uint8Array(pendingSize);
    let at = 0;
    for (const c of pending) {
      buf.set(c, at);
      at += c.length;
    }
    const text = carry + dec.decode(buf);
    const textStart = pos - carry.length;
    for (const hit of scanText(text, f.name, textStart)) {
      if (hit.offset <= lastEnd) continue;
      lastEnd = hit.offset;
      out.push(hit);
    }
    pos += pendingSize;
    carry = text.slice(-1024);
    pending = [];
    pendingSize = 0;
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending.push(value);
    pendingSize += value.length;
    if (pendingSize >= 16 * MB) {
      flush();
      progress(pos);
      await new Promise((r) => setTimeout(r, 0));
      if (out.length > 20000) break;
    }
  }
  flush();
  return out;
}

/**
 * Time decoded trace lines with Logel's index (traceview.pbs): a "TIND" header, then from 0x200
 * one 44-byte row per line: the .logel packet's sequence number at +4, the line's tick at +12,
 * its length at +26, its offset in the .dat at +28 and the .logel packet's offset at +36. The
 * packet offset gives the line the same clock as everything read from the .logel.
 */
async function timeTraceLines(pbs: SourceFile, hits: CrashLine[], clock: ((offset: number, tick?: number) => number | null) | null, base: number | null) {
  if (!hits.length) return;
  const sorted = [...hits].sort((a, b) => a.offset - b.offset);
  const offs = sorted.map((h) => h.offset);
  const reader = (await pbs.stream()).getReader();
  const ROW = 44;
  let next = 0x200; // file offset of the next row
  let bufStart = 0;
  let carry = new Uint8Array(0);
  let left = sorted.length;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const buf = new Uint8Array(carry.length + value.length);
    buf.set(carry);
    buf.set(value, carry.length);
    if (bufStart === 0 && buf.length >= 4 && String.fromCharCode(...buf.subarray(0, 4)) !== "TIND") return;
    let i = next - bufStart;
    if (i > buf.length) {
      carry = buf;
      continue;
    }
    const dv = new DataView(buf.buffer);
    for (; i + ROW <= buf.length; i += ROW) {
      const at = dv.getUint32(i + 28, true);
      const len = dv.getUint16(i + 26, true);
      // the first hit at or after this line's start, if it lies inside the line
      let lo = 0;
      let hi = offs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (offs[mid] < at) lo = mid + 1;
        else hi = mid;
      }
      for (let k = lo; k < offs.length && offs[k] <= at + Math.max(len, 1) - 1; k++) {
        if (sorted[k].ts) continue;
        const packet = dv.getUint32(i + 36, true) + dv.getUint32(i + 40, true) * 2 ** 32;
        const tick = dv.getUint32(i + 12, true);
        const ms = clock?.(packet, tick) ?? (base !== null ? base + tick : null);
        sorted[k].ts = ms !== null ? fmtClock(ms) : null;
        left--;
      }
      if (!left) return;
    }
    carry = buf.slice(i);
    bufStart += i;
    next = bufStart;
  }
}

/** What an assert record gave, for the Files list. */
function recordFields(r: AssertRecord) {
  const mem = r.memory;
  const got = [
    r.source && "where it stopped",
    r.expression && "the check",
    r.message && "the assert info",
    r.task && "the task",
    r.thread?.length && "its queue and stack",
    r.exception && "the exception",
    r.versions?.length && "the software versions",
    r.registers.length && `${r.registers.length} registers`,
    r.banked?.length && `the registers of ${r.banked.length} CPU modes`,
    r.corePcs?.length && `the PC of ${r.corePcs.length} cores`,
    r.stack.length && `${r.stack.length} call stack frames`,
    r.dumps?.length && `${r.dumps.length} saved files`,
    r.regions?.length && `${r.regions.length} memory regions`,
    mem?.blockPool && `${mem.blockPool.entries} block-pool allocations`,
    mem?.bytePool && `${mem.bytePool.entries} byte-pool allocations`,
    mem?.initialized && `${mem.initialized.entries} initialised-memory allocations`,
  ].filter(Boolean) as string[];
  return got.length ? got.join(", ") : "no known field (the whole text is kept)";
}

const groupKey = (l: CrashLine) => `${l.kind}|${l.text.replace(/0x[0-9a-f]+/gi, "0x_").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase()}`;

function groupLines(lines: CrashLine[]): CrashGroup[] {
  const by = new Map<string, CrashGroup>();
  for (const l of lines) {
    const key = groupKey(l);
    let g = by.get(key);
    if (!g) {
      g = { kind: l.kind, strong: l.strong, text: l.text, files: {}, count: 0, first: l.ts ?? null, last: l.ts ?? null };
      by.set(key, g);
    }
    g.files[l.file] = (g.files[l.file] ?? 0) + 1;
    if (l.ts) {
      if (!g.first || l.ts < g.first) g.first = l.ts;
      if (!g.last || l.ts > g.last) g.last = l.ts;
    }
  }
  // the same trace is in the .logel and in Logel's decoded copy: count it once
  for (const g of by.values()) g.count = Math.max(...Object.values(g.files));
  return [...by.values()].sort((a, b) => Number(b.strong) - Number(a.strong) || (a.first ?? "~").localeCompare(b.first ?? "~") || b.count - a.count).slice(0, 400);
}

const msOf = (ts?: string | null) => {
  const m = /(\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(ts ?? "");
  return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + Number((m[4] ?? "0").padEnd(3, "0")) : null;
};

export async function prepareCapture(src: CaptureSource, onStep: (text: string) => void): Promise<Prepared> {
  const files: CaptureFile[] = [];
  const device: Record<string, string> = {};
  const notes: string[] = [];
  const records: Capture["records"] = [];
  const radio: RadioSample[] = [];
  const at: Capture["at"] = [];
  let stats: Capture["stats"];
  const ips: IpSummary[] = [];
  let span: Capture["span"];
  const texts: string[] = [];
  const hasLogel = src.files.some((f) => /\.logel$/i.test(f.name) && f.size > 0);
  const crashLines: CrashLine[] = [];
  const events: AssertRecord[] = [];
  const history: CoreAssert[] = [];
  const searched: string[] = [];
  let base: LogelResult["base"] = { ps: null, phy: null };
  let clock: ((offset: number, tick?: number) => number | null) | null = null;

  const add = (f: SourceFile, role: FileRole, label: string, reason: string, detail?: string) =>
    files.push({ path: f.path, name: f.name, size: f.size, role, label, reason, detail });
  const found = (hits: CrashLine[]) => {
    const strong = hits.filter((h) => h.strong).length;
    return hits.length
      ? `Searched: ${strong ? `${strong} assert or crash ${strong === 1 ? "line" : "lines"}` : "no assert or crash"}${hits.length > strong ? `, ${hits.length - strong} ${hits.length - strong === 1 ? "line mentions" : "lines mention"} one` : ""}.`
      : "Searched: no assert or crash.";
  };
  /** search a file's contents, whatever its size */
  const search = async (f: SourceFile, data?: Uint8Array) => {
    searched.push(f.name);
    if (data) return scanBytes(data, f.name);
    return scanStream(f, (done) => onStep(`Searching ${f.name} for asserts and crashes (${sizeText(done)} of ${sizeText(f.size)})`));
  };
  const sentences = (...xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(" ");

  // the .logel first: its clock dates every other file; then small files before large ones
  const order = [...src.files].sort((a, b) => Number(!/\.logel$/i.test(a.name)) - Number(!/\.logel$/i.test(b.name)) || a.size - b.size);
  const traceHits: { f: SourceFile; hits: CrashLine[] }[] = [];
  const dumpFiles: { f: SourceFile; what: string }[] = [];
  for (const f of order) {
    const rule = RULES.find((r) => r.test.test(f.name)) ?? OTHER;
    if (f.size === 0) {
      add(f, "skipped", rule.label, `Empty (0 bytes): nothing was logged to it. When used it holds: ${rule.holds.charAt(0).toLowerCase()}${rule.holds.slice(1)}`);
      continue;
    }
    try {
      if (rule.kind === "logel") {
        onStep(`Reading ${f.name} (${sizeText(f.size)})`);
        const data = await f.read();
        if (!isLogel(data.subarray(0, 64))) {
          const hits = await search(f, data);
          crashLines.push(...hits);
          add(f, "analysed", rule.label, "Not in the Logel format this page reads (UNISOC armlog); searched as a binary file.", found(hits));
          continue;
        }
        onStep(`Finding RRC and NAS messages, asserts and crashes in ${f.name}`);
        await new Promise((r) => setTimeout(r, 0));
        const res: LogelResult = parseLogel(data, 5000, f.name);
        searched.push(f.name);
        records.push(...res.records);
        radio.push(...res.radio);
        at.push(...res.at);
        crashLines.push(...res.crash);
        if (res.base.ps !== null) base = res.base;
        clock = res.timeAt;
        Object.entries(res.device).forEach(([k, v]) => (device[k] ??= v));
        if (res.date || res.start) span = { date: res.date, start: res.start, end: res.end };
        if (res.truncated) notes.push(`${f.name} ends part way through a packet: the log may have been cut short.`);
        // what the modem printed at its assert console is an assert record of its own
        let consoleNote: string | null = null;
        if (res.console) {
          const name = `${f.name} (assert console)`;
          if (looksLikeAssert(res.console.text)) {
            const rec = parseAssert(res.console.text, name);
            rec.ts ??= res.console.ms !== null ? fmtClock(res.console.ms) : null;
            events.push(rec);
            consoleNote = `It also holds the modem's assert console (${res.console.packets} packets), read as an assert record: ${rec.title}.`;
          } else {
            const hits = scanText(res.console.text, name);
            crashLines.push(...hits);
            consoleNote = `It also holds ${res.console.packets} packets of modem console output; ${found(hits).replace(/^Searched: /, "searched: ")}`;
          }
        }
        let dumpNote: string | null = null;
        if (res.dump) {
          const kind = dumpKind(res.dump.head);
          dumpNote = `${sizeText(res.dump.bytes)} of it is the ${kind ? kind.what.toLowerCase() : "memory dump"} the modem sent after the assert (${res.dump.packets} packets): firmware memory, so its text is not counted as crash lines.`;
        }
        const bits = [
          `${res.records.length} RRC and NAS ${res.records.length === 1 ? "message" : "messages"}`,
          res.at.length ? `${res.at.length} AT answers` : null,
          res.radio.length ? `${res.radio.length} radio samples` : null,
          `${res.packets} packets in ${res.streams} trace ${res.streams === 1 ? "stream" : "streams"}`,
        ].filter(Boolean);
        add(f, "analysed", rule.label, rule.holds, sentences(`${bits.join(", ")}.`, res.internal ? `${res.internal} internal modem messages left out.` : null, consoleNote, dumpNote, found(res.crash)));
        continue;
      }

      if (rule.kind === "ass" || rule.kind === "crash") {
        onStep(`Reading the assert record ${f.name}`);
        const data = f.size <= IN_MEMORY ? await f.read() : undefined;
        const text = data ? fileText(data, data.length).text : "";
        if (rule.kind === "ass" || looksLikeAssert(text)) {
          // the record is the event: its own lines are not counted again as crash lines
          searched.push(f.name);
          const rec = parseAssert(text || (data ? printableStrings(data.subarray(0, 4 * MB)) : ""), f.name);
          events.push(rec);
          add(f, "analysed", rule.label, rule.holds, `${rec.title}. Read in full: ${recordFields(rec)}.${rec.memory?.cutShort ? ` ${rec.memory.cutShort}` : ""}`);
        } else {
          const hits = await search(f, data);
          crashLines.push(...hits);
          add(f, "analysed", rule.label, `${rule.holds} This one records no assert.`, found(hits));
        }
        continue;
      }

      if (rule.kind === "dump") {
        onStep(`Reading the memory dump ${f.name} (${sizeText(f.size)})`);
        const head = new Uint8Array(await new Response((await f.stream()).pipeThrough(firstBytes(64))).arrayBuffer());
        const kind = dumpKind(head);
        const data = f.size <= IN_MEMORY ? await f.read() : undefined;
        const hits = await search(f, data);
        // a memory image holds the firmware's message text: only finished assert lines count, as history
        const asserts = hits.map((h) => parseCoreAssert(h.text, f.name)).filter((x): x is CoreAssert => Boolean(x));
        history.push(...asserts);
        const firmware = hits.length - asserts.length;
        dumpFiles.push({ f, what: kind?.what ?? "Memory dump" });
        add(
          f,
          "analysed",
          kind?.what ?? rule.label,
          kind?.detail ?? rule.holds,
          sentences(
            `Searched in full: ${asserts.length ? `${asserts.length} finished assert ${asserts.length === 1 ? "line" : "lines"} kept in memory (listed with the assert)` : "no finished assert line in it"}.`,
            firmware ? `${firmware} firmware ${firmware === 1 ? "message mentions" : "messages mention"} an assert or a failure: the firmware's own text, not events.` : null,
          ),
        );
        continue;
      }

      if (rule.kind === "traceidx") {
        const rows = Math.max(0, Math.floor((f.size - 0x200) / 44));
        searched.push(f.name);
        add(f, "analysed", rule.label, rule.holds, `Index of ${rows.toLocaleString("en")} decoded trace lines; used to time the lines found in ${f.name.replace(/\.pbs$/i, ".dat")}.`);
        continue;
      }

      const big = f.size > IN_MEMORY;
      const data = big ? undefined : await f.read();
      if (rule.kind === "tracedat" || !data) {
        onStep(`Searching ${f.name} for asserts and crashes`);
        const hits = await search(f, data);
        crashLines.push(...hits);
        if (rule.kind === "tracedat") traceHits.push({ f, hits });
        add(f, "analysed", rule.label, rule.holds, found(hits));
        continue;
      }
      const hits = await search(f, data);
      crashLines.push(...hits);
      const scanNote = found(hits);

      if (rule.kind === "pcap") {
        const s = summarizePcap(data);
        const n = pcapCount(data);
        if (!n) add(f, "analysed", rule.label, `${rule.holds} This one is not a pcap file; searched as a binary file.`, scanNote);
        else if (!n.total) add(f, "analysed", rule.label, rule.holds, `No packets: only the file header was written. ${scanNote}`);
        else if (s && s.packets && rule.label === "IP packets") {
          ips.push(s);
          add(f, "analysed", rule.label, rule.holds, `${s.packets} IP packets (${s.ul} up, ${s.dl} down), ${s.dns.length} DNS ${s.dns.length === 1 ? "lookup" : "lookups"}. ${scanNote}`);
        } else {
          const cmds = [...new Set([...textOf(data).matchAll(/AT[+^$%][A-Z0-9]+[^\r\n\0]{0,40}/gi)].map((m) => m[0].trim()))];
          add(f, "analysed", rule.label, rule.holds, sentences(`${n.total} packets (link type ${n.link}).`, cmds.length ? `AT commands in it: ${cmds.slice(0, 12).join(", ")}${cmds.length > 12 ? ` and ${cmds.length - 12} more` : ""}.` : null, scanNote));
        }
        continue;
      }
      const text = textOf(data);
      if (rule.kind === "csv") {
        const pts = parseMeasCsv(text);
        const rows = text.split(/\r?\n/).filter((l) => l.trim()).length - 1;
        if (pts.length) radio.push(...pts);
        add(
          f,
          "analysed",
          rule.label,
          rule.holds,
          pts.length ? `${pts.length} samples. ${scanNote}` : rows > 0 ? `${rows} rows (2G / 3G values, not charted). ${scanNote}` : `Only the column titles: the modem logged no ${/^(\w+),/.exec(text)?.[1] ?? ""} measurements. ${scanNote}`,
        );
        continue;
      }
      if (rule.kind === "lst") {
        const l = parseLst(text, device);
        for (const e of l.events) notes.push(`Logel recorded: ${e}.`);
        add(
          f,
          "analysed",
          rule.label,
          rule.holds,
          sentences(
            [l.modem && `Modem ${l.modem}`, l.parser && `parser ${l.parser}`, l.tool && `Logel ${l.tool}`].filter(Boolean).join(", ") + ".",
            l.events.length ? `While logging: ${l.events.join("; ")}.` : null,
            l.stopped ? null : "No Stop Logging line: Logel did not finish this log normally.",
            hits.length ? scanNote : null,
          ),
        );
        continue;
      }
      if (rule.kind === "ini") {
        const got = parseIni(text, device);
        add(f, "analysed", rule.label, rule.holds, got.length ? `${got.join(", ")}.` : "No version lines in it.");
        continue;
      }
      if (rule.kind === "stat") {
        const s = parseStats(text);
        stats = { lostCount: s.lostCount, lostPercent: s.lostPercent, totalPackets: s.totalPackets };
        const a = s.all;
        add(
          f,
          "analysed",
          rule.label,
          rule.holds,
          sentences(
            a["PS Total package"] !== undefined ? `Protocol stack: ${a["PS Total package"].toLocaleString("en")} packets, ${a["PS Channel lost count"] ?? 0} lost on the channel, ${a["PS MTA lost count"] ?? 0} lost in the modem.` : null,
            a["PHY Total package"] !== undefined ? `PHY: ${a["PHY Total package"].toLocaleString("en")} packets, ${a["PHY CP lost count"] ?? 0} lost in the modem, ${a["PHY Channel lost count"] ?? 0} on the channel.` : null,
            `In all ${s.totalPackets?.toLocaleString("en") ?? "?"} packets, ${s.lostCount} lost${s.lostPercent ? ` (${s.lostPercent}%)` : ""}.`,
          ),
        );
        continue;
      }
      if (rule.kind === "bookmark") {
        const bug = /BugID="([^"]*)"/.exec(text)?.[1];
        const sum = /<Summary>([\s\S]*?)<\/Summary>/.exec(text)?.[1]?.trim();
        const marks = (text.match(/<(Item|Bookmark\w+|Mark)\b/g) || []).length;
        if (bug) device.bug = bug;
        if (sum) notes.push(`Logel note: ${sum}`);
        add(f, "analysed", rule.label, rule.holds, bug || sum || marks ? [bug && `Bug ${bug}`, sum, marks && `${marks} bookmarks`].filter(Boolean).join(". ") : "No bookmarks or bug notes were added.");
        continue;
      }
      // text exports: decode them only when there is no .logel (it holds the same messages)
      const isText = !fileText(data, Math.min(data.length, 65536)).binary;
      if (isText && HEX_LINE.test(text)) {
        if (hasLogel) add(f, "analysed", rule.label, rule.holds, `Hex messages, the same ones the .logel holds. ${scanNote}`);
        else {
          texts.push(text);
          add(f, "analysed", rule.label, rule.holds, `Hex messages: decoded with the rest. ${scanNote}`);
        }
        continue;
      }
      const lines = isText ? text.split(/\r?\n/).filter((l) => l.trim()).length : 0;
      add(f, "analysed", rule.label, rule.holds, sentences(isText ? `Text, ${lines.toLocaleString("en")} lines.` : "Binary data.", scanNote));
    } catch (e) {
      add(f, "skipped", rule.label, `Could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // time the decoded trace lines with Logel's trace index (traceview.pbs beside traceview.dat)
  for (const { f, hits } of traceHits) {
    if (!hits.length) continue;
    const pbsPath = f.path.replace(/\.dat$/i, ".pbs");
    const pbs = src.files.find((x) => x.path === pbsPath);
    if (!pbs) continue;
    onStep(`Timing the assert and crash lines found in ${f.name}`);
    try {
      await timeTraceLines(pbs, hits, clock, /phytraceview/i.test(f.name) ? (base.phy ?? base.ps) : base.ps);
    } catch {
      /* leave them untimed */
    }
  }

  // every core's "Modem Assert: ... assert in file X line N" line, once each, earliest first
  const cores = new Map<string, CoreAssert>();
  for (const l of crashLines) {
    const c = parseCoreAssert(l.text, l.file, l.ts);
    if (!c) continue;
    const key = `${c.core}|${c.file}|${c.line}`;
    const had = cores.get(key);
    if (!had || (c.ts && (!had.ts || c.ts < had.ts))) cores.set(key, { ...c, task: c.task ?? had?.task, exp: c.exp ?? had?.exp, info: c.info ?? had?.info });
  }
  // the command that asked for an assert, when the traces show it arriving
  const ask = crashLines
    .filter((l) => /SPATASSERT/i.test(l.text) && /line:|=\s*\d|Extended cmd/i.test(l.text))
    .sort((a, b) => (a.ts ?? "~").localeCompare(b.ts ?? "~"));

  // one event per assert: the .ass, the console in the .logel and a dump can hold the same one
  const unique: AssertRecord[] = [];
  for (const e of [...events].sort((a, b) => Number(/console/.test(a.file)) - Number(/console/.test(b.file)))) {
    const same = unique.find((k) => k.where && k.where === e.where && (k.expression ?? "") === (e.expression ?? ""));
    if (same) {
      same.also = [...(same.also ?? []), e.file];
      same.ts ??= e.ts;
      continue;
    }
    unique.push(e);
  }
  const explained = new Map<string, string>();
  for (const e of unique) {
    const src0 = e.source?.split("/").pop()?.toLowerCase();
    const own = [...cores.values()].find((c) => src0 && c.file.toLowerCase() === src0 && c.line === e.line);
    // the assert's own trace line times it best; then the record, then any line naming the same file
    e.ts = own?.ts ?? e.ts ?? crashLines.find((l) => l.strong && l.ts && src0 && l.text.toLowerCase().includes(src0))?.ts ?? null;
    if (own) {
      e.core = own.core;
      e.task ??= own.task;
    }
    // the cores that stopped at the same moment
    const at0 = msOf(e.ts);
    e.cores = [...cores.values()]
      .filter((c) => at0 === null || c.ts == null || Math.abs((msOf(c.ts) ?? at0) - at0) < 10000)
      .sort((a, b) => Number(b === own) - Number(a === own) || (a.ts ?? "~").localeCompare(b.ts ?? "~"));
    if (e.forced && ask.length) {
      const near = ask.filter((x) => !x.ts || at0 === null || Math.abs((msOf(x.ts) ?? at0) - at0) < 60000);
      const l = near.find((x) => /line:/i.test(x.text)) ?? near[0] ?? ask[0];
      e.forcedBy = { ts: l.ts ?? null, line: l.text, channel: /link_id:(\d+)/i.exec(ask.find((x) => /link_id/i.test(x.text))?.text ?? "")?.[1] };
    }
    if (history.length) {
      const seen = new Set<string>();
      e.history = history.filter((h) => {
        const k = `${h.core}|${h.file}|${h.line}|${h.info ?? ""}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    // which saved files are here
    for (const d of e.dumps ?? []) d.present = src.files.some((x) => x.name.toLowerCase() === d.file.toLowerCase() && x.size > 0);
    e.title = assertTitle(e);
    for (const c of e.cores) explained.set(`${c.core}|${c.file}|${c.line}`, e.title);
    if (e.forced) explained.set("forced", e.title);
  }
  // a memory dump with no assert record anywhere still says the modem stopped
  if (!unique.length && dumpFiles.some((d) => d.what === "Modem memory dump")) {
    const d = dumpFiles.find((x) => x.what === "Modem memory dump")!;
    unique.push({ file: d.f.name, kind: "reset", title: "Modem memory dump saved", registers: [], stack: [], raw: "", fromDump: true, history: history.length ? history : undefined });
  }

  // a log with no clock of its own (only the assert output) is dated by Logel's folder name
  const stamp = /(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{3})/.exec(`${src.name} ${src.files[0]?.path ?? ""}`);
  if (!span?.date && stamp) span = { date: `${stamp[1]}-${stamp[2]}-${stamp[3]}`, start: span?.start ?? `${stamp[4]}:${stamp[5]}:${stamp[6]}.${stamp[7]}`, end: span?.end ?? null };
  // versions from the assert record when no version file came with the log
  const v = unique.find((e) => e.versions?.length)?.versions ?? [];
  const ver = (re: RegExp) => v.find((x) => re.test(x.label))?.value;
  const fill = (k: string, value?: string) => {
    if (value && !device[k]) device[k] = value;
  };
  fill("platform", ver(/platform/i));
  fill("project", ver(/project/i));
  fill("modem", ver(/base/i));
  fill("hw", ver(/^hw/i));
  fill("build", unique.find((e) => e.build)?.build);

  const groups = groupLines(crashLines);
  for (const g of groups) {
    const c = parseCoreAssert(g.text, "");
    const why = c ? explained.get(`${c.core}|${c.file}|${c.line}`) : /SPATASSERT/i.test(g.text) ? explained.get("forced") : undefined;
    if (why) g.explained = why;
  }

  // IP captures: one summary, every DNS lookup from all of them
  let ip: IpSummary | undefined;
  for (const s of ips) {
    if (!ip) ip = { ...s, dns: [...s.dns], servers: [...s.servers] };
    else {
      for (const k of ["packets", "ul", "dl", "bytes", "ipv4", "ipv6", "tcp", "udp", "icmp", "tcpResets"] as const) ip[k] += s[k];
      ip.dns.push(...s.dns);
      ip.servers = [...new Set([...ip.servers, ...s.servers])];
      if (s.first && (!ip.first || s.first < ip.first)) ip.first = s.first;
      if (s.last && (!ip.last || s.last > ip.last)) ip.last = s.last;
    }
  }
  ip?.dns.sort((a, b) => a.ts.localeCompare(b.ts));

  const rank: Record<FileRole, number> = { analysed: 0, info: 1, skipped: 2 };
  files.sort((a, b) => rank[a.role] - rank[b.role] || b.size - a.size);
  const capture: Capture = {
    name: src.name,
    kind: src.kind,
    records: records.map((r) => ({ ts: r.ts, protocol: r.protocol, hex: r.hex, header: r.header })),
    radio,
    at,
    device,
    stats,
    ip,
    files,
    span,
    notes,
    crashes: { events: unique, groups, searched, lines: crashLines.length },
  };
  return { capture, text: texts.length ? texts.join("\n\n") : undefined };
}

/** The first n bytes of a stream. */
function firstBytes(n: number) {
  let got = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      if (got >= n) return;
      const part = chunk.subarray(0, n - got);
      got += part.length;
      ctl.enqueue(part);
      if (got >= n) ctl.terminate();
    },
  });
}
