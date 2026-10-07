/**
 * Open a Logel capture (a zip, a folder, or loose files), pick the files that help
 * troubleshooting, read them and build the capture the engine decodes.
 */

import { isZip, listZip, readZipEntry, zipEntryStream } from "./zip";
import { fmtClock, isLogel, parseLogel, type LogelResult, type RadioSample } from "./logel";
import { summarizePcap, type IpSummary } from "./pcap";
import { CRASH_FILE, fileText, looksLikeAssert, parseAssert, printableStrings, scanText, type CrashLine } from "./crash";
import type { AssertRecord, CrashGroup, CrashInfo } from "@/lib/engine/types";

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

/** A zip's entries; `under` puts them in a folder named after the zip, so several zips stay apart. */
async function zipSources(f: File, under?: string): Promise<SourceFile[]> {
  const entries = await listZip(f);
  const prefix = under ? `${under}/` : "";
  return entries.map((e) => ({ path: prefix + e.path, name: e.name, size: e.size, read: () => readZipEntry(f, e), stream: () => zipEntryStream(f, e) }));
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

interface Rule {
  test: RegExp;
  role: FileRole | "check";
  label: string;
  reason: string;
}

const SEARCHED = "Searched line by line for asserts, crashes, exceptions and resets.";

const RULES: Rule[] = [
  { test: /\.logel$/i, role: "analysed", label: "Modem log (Logel)", reason: "Every RRC and NAS message, the modem's radio measurements, its AT command answers, and every assert or crash line." },
  { test: /\.ass$/i, role: "analysed", label: "Modem assert record", reason: "Written when the modem asserts: where and why it stopped, the task, registers and call stack." },
  { test: /(^|\/)(traceview|phytraceview)\.dat$/i, role: "info", label: "Logel decoded traces", reason: `Logel's decoded copy of every modem trace, the PHY traces too (the .logel keeps them as numbers). ${SEARCHED}` },
  { test: /(^|\/)(traceview|phytraceview)\.pbs$/i, role: "info", label: "Trace index", reason: "Time and place of every decoded trace line: used to time any assert found in the decoded traces." },
  { test: /(^|\/)(msgview|msgflowview|phyparamchart)\.(dat|pbs)$/i, role: "info", label: "Logel view cache", reason: `Logel's display cache, built from the .logel. ${SEARCHED}` },
  { test: /_(bt|wcn)\.cap$/i, role: "info", label: "Bluetooth / Wi-Fi chip packets", reason: `Packets of the connectivity chip, not the cellular modem. ${SEARCHED}` },
  { test: /_mux\.cap$/i, role: "info", label: "AT channel packets", reason: `Raw AT channel traffic; the AT answers are read from the .logel. ${SEARCHED}` },
  { test: /\.(cap|pcap)$/i, role: "check", label: "IP packets", reason: "Data traffic of the modem: DNS lookups, their answers and failures." },
  { test: /\.pcapng$/i, role: "info", label: "IP packets (pcapng)", reason: `pcapng is not decoded yet. ${SEARCHED}` },
  { test: /_(lte|nr|5g|gsm|wcdma|td)\.csv$/i, role: "check", label: "Signal measurements", reason: "RSRP / SINR samples exported by Logel." },
  { test: /\.lst$/i, role: "info", label: "Log record", reason: "Modem software and Logel tool versions." },
  { test: /_modem\.ini$/i, role: "info", label: "Modem version", reason: "Platform, project, hardware and build time of the modem software." },
  { test: /_log_stat\.txt$/i, role: "info", label: "Lost-packet statistics", reason: "Shows whether the log is complete. Lost packets mean missing messages." },
  { test: /_bookmark\.xml$/i, role: "check", label: "Bookmarks", reason: "Bug ID and notes added in Logel." },
  { test: /\.iq$/i, role: "skipped", label: "IQ samples", reason: "Raw radio samples for lab analysis: numbers only, no signalling or text to search." },
  { test: /(\.wvoice|_vt_(up|down)\.bin)$/i, role: "skipped", label: "Call media", reason: "Voice or video call payload: no signalling or text to search." },
  { test: /(\.xdsp_log|_wcn_dsp\.org|_dsp_ag_trace\.txt)$/i, role: "info", label: "DSP trace", reason: `Chip trace in UNISOC's own format. ${SEARCHED}` },
  { test: /\.wrrc_log$/i, role: "info", label: "WCDMA RRC trace", reason: `3G RRC trace; signalling is read from the .logel. ${SEARCHED}` },
  { test: /_ipa_des\.bin$/i, role: "info", label: "IP accelerator data", reason: `Internal modem buffers. ${SEARCHED}` },
  { test: CRASH_FILE, role: "analysed", label: "Crash evidence", reason: "Saved only when something crashed: read for the assert or exception it records." },
  { test: /_trace\.txt$/i, role: "check", label: "Text trace", reason: "Trace lines exported as text." },
  { test: /\.(txt|log|hex|csv)$/i, role: "check", label: "Text export", reason: "Hex messages exported as text." },
  { test: /\.zip$/i, role: "skipped", label: "Archive inside the archive", reason: "Unzip it and open it on its own." },
];

const HEX_LINE = /(?:^|[\s:])(?:[0-9a-f]{2}[ ,]){7,}[0-9a-f]{2}/im;

function textOf(b: Uint8Array, max = 2 * MB) {
  return new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, max));
}

// --- the small text files -----------------------------------------------------------

function parseIni(text: string, device: Record<string, string>) {
  const map: Record<string, string> = {
    platformversion: "platform", projectversion: "project", baseversion: "modem", hwversion: "hw", buildtime: "build",
  };
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z ]+?)\s*[=:]\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const k = map[m[1].replace(/\s+/g, "").toLowerCase()];
    if (k && !device[k]) device[k] = m[2];
  }
}

function parseLst(text: string, device: Record<string, string>) {
  const modem = /Modem Version:\s*(\S+)/i.exec(text);
  const tool = /Tool Version:\s*(\S+)/i.exec(text);
  if (modem && !device.modem) device.modem = modem[1];
  if (tool) device.tool = tool[1];
}

function parseStats(text: string) {
  const num = (k: string) => {
    const m = new RegExp(`^${k}=([\\d.]+)`, "mi").exec(text);
    return m ? Number(m[1]) : undefined;
  };
  const lostCount = num("Total lost count") ?? 0;
  const lostPercent = num("Total lost");
  return { lostCount, lostPercent: lostPercent || undefined, totalPackets: num("Total package") };
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

// --- read the capture -------------------------------------------------------------

const IN_MEMORY = 48 * MB;
const DUMP = /\.(?:dmp|mdmp|core|mem)$|dump/i;

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

/** Crash lines in a file read chunk by chunk (Logel's 300 MB+ decoded trace view, dumps). */
async function scanStream(f: SourceFile, progress: (done: number) => void): Promise<CrashLine[]> {
  const reader = (await f.stream()).getReader();
  const dec = new TextDecoder("latin1");
  const out: CrashLine[] = [];
  let pending: Uint8Array[] = [];
  let pendingSize = 0;
  let pos = 0; // file offset of the first pending byte
  let carry = "";
  let lastEnd = -1;
  const flush = (final: boolean) => {
    if (!pendingSize && !final) return;
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
      flush(false);
      progress(pos);
      await new Promise((r) => setTimeout(r, 0));
      if (out.length > 5000) break;
    }
  }
  flush(true);
  return out;
}

/**
 * Time trace view lines with Logel's index (traceview.pbs): a "TIND" header, then from 0x200
 * one 44-byte row per line: tick at +12, length at +26, offset in the .dat at +28.
 */
async function timeTraceLines(pbs: SourceFile, hits: CrashLine[], base: number | null) {
  if (!hits.length || base === null) return;
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
        sorted[k].ts = fmtClock(base + dv.getUint32(i + 12, true));
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
  const got = [
    r.source && "where",
    r.expression && "the failed check",
    r.message && "the message",
    r.task && "the task",
    r.exception && "the exception",
    r.ts && "the time",
    r.version && "the software version",
    r.registers.length && `${r.registers.length} registers`,
    r.stack.length && `${r.stack.length} call stack frames`,
  ].filter(Boolean) as string[];
  return got.length ? got.join(", ") : "no known field (the whole text is kept)";
}

function groupLines(lines: CrashLine[]): CrashGroup[] {
  const by = new Map<string, CrashGroup>();
  for (const l of lines) {
    const norm = l.text.replace(/0x[0-9a-f]+/gi, "0x_").replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
    const key = `${l.kind}|${norm}`;
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

export async function prepareCapture(src: CaptureSource, onStep: (text: string) => void): Promise<Prepared> {
  const files: CaptureFile[] = [];
  const device: Record<string, string> = {};
  const notes: string[] = [];
  const records: Capture["records"] = [];
  const radio: RadioSample[] = [];
  const at: Capture["at"] = [];
  let stats: Capture["stats"];
  let ip: IpSummary | undefined;
  let span: Capture["span"];
  const texts: string[] = [];
  const hasLogel = src.files.some((f) => /\.logel$/i.test(f.name) && f.size > 0);
  const crashLines: CrashLine[] = [];
  const events: AssertRecord[] = [];
  const searched: string[] = [];
  let base: LogelResult["base"] = { ps: null, phy: null };

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

  // the .logel first: its clock dates every other file; then small files before large ones
  const order = [...src.files].sort((a, b) => Number(!/\.logel$/i.test(a.name)) - Number(!/\.logel$/i.test(b.name)) || a.size - b.size);
  const traceHits: { f: SourceFile; hits: CrashLine[] }[] = [];
  for (const f of order) {
    const rule = RULES.find((r) => r.test.test(f.name)) ?? {
      test: /./,
      role: "info" as FileRole,
      label: "Other file",
      reason: `No reader of its own. ${SEARCHED}`,
    };
    if (f.size === 0) {
      add(f, "skipped", rule.label, "Empty: the tool created it but nothing was logged to it.");
      continue;
    }
    if (rule.role === "skipped") {
      add(f, "skipped", rule.label, rule.reason);
      continue;
    }
    try {
      if (/\.logel$/i.test(f.name)) {
        onStep(`Reading ${f.name} (${sizeText(f.size)})`);
        const data = await f.read();
        if (!isLogel(data.subarray(0, 64))) {
          const hits = await search(f, data);
          crashLines.push(...hits);
          add(f, "info", rule.label, "Not in the Logel format this page reads (UNISOC armlog).", found(hits));
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
        Object.entries(res.device).forEach(([k, v]) => (device[k] ??= v));
        span = { date: res.date, start: res.start, end: res.end };
        if (res.truncated) notes.push(`${f.name} ends part way through a packet: the log may have been cut short.`);
        const bits = [
          `${res.records.length} RRC and NAS ${res.records.length === 1 ? "message" : "messages"}`,
          res.at.length ? `${res.at.length} AT answers` : null,
          res.radio.length ? `${res.radio.length} radio samples` : null,
        ].filter(Boolean);
        add(f, "analysed", rule.label, rule.reason, `${bits.join(", ")}. ${res.internal} internal modem messages left out. ${found(res.crash)}`);
        continue;
      }
      if (rule.label === "Trace index") {
        add(f, "info", rule.label, rule.reason);
        continue;
      }
      if (rule.label === "Modem assert record" || rule.label === "Crash evidence") {
        onStep(`Reading the crash record ${f.name}`);
        const isDump = DUMP.test(f.name);
        const data = f.size <= IN_MEMORY ? await f.read() : undefined;
        const hits = await search(f, data);
        const text = data ? fileText(data, isDump ? 4 * MB : data.length).text : hits.map((h) => h.text).join("\n");
        if (rule.label === "Modem assert record" || looksLikeAssert(text) || hits.some((h) => h.strong)) {
          // the record is the event: its own lines are not counted again as crash lines
          const rec = parseAssert(text || (data ? printableStrings(data.subarray(0, 4 * MB)) : ""), f.name, { fromDump: isDump });
          events.push(rec);
          add(f, "analysed", rule.label, rule.reason, `${rec.title}${rec.ts ? ` at ${rec.ts}` : ""}. Read field by field: ${recordFields(rec)}.`);
        } else if (isDump) {
          crashLines.push(...hits);
          events.push({ file: f.name, kind: "reset", title: "Modem memory dump saved", registers: [], stack: [], raw: "", fromDump: true });
          add(f, "analysed", "Memory dump", "The modem saves one when it crashes (or when one is taken by hand). Its contents need UNISOC's tools; its text is searched.", found(hits));
        } else {
          // named like crash output, but nothing in it shows one
          crashLines.push(...hits);
          add(f, "info", "Other file", `Named like crash output, but it records no assert or crash. ${SEARCHED}`, found(hits));
        }
        continue;
      }
      const big = f.size > IN_MEMORY;
      const data = big ? undefined : await f.read();
      if (rule.label === "Logel decoded traces" || big || !data) {
        onStep(`Searching ${f.name} for asserts and crashes`);
        const hits = await search(f, data);
        crashLines.push(...hits);
        if (rule.label === "Logel decoded traces") traceHits.push({ f, hits });
        add(f, rule.role === "check" ? "info" : (rule.role as FileRole), rule.label, rule.reason, found(hits));
        continue;
      }
      const hits = await search(f, data);
      crashLines.push(...hits);
      const scanNote = found(hits);
      if (rule.label === "IP packets") {
        const s = summarizePcap(data);
        if (!s) add(f, "info", rule.label, "Not a pcap file this page reads.", scanNote);
        else if (!s.packets) add(f, "skipped", rule.label, "Empty: no packets were captured.");
        else {
          if (!ip || s.packets > ip.packets) ip = s;
          add(f, "analysed", rule.label, rule.reason,
            `${s.packets} packets (${s.ul} up, ${s.dl} down), ${s.dns.length} DNS ${s.dns.length === 1 ? "lookup" : "lookups"}. ${scanNote}`);
        }
        continue;
      }
      const text = textOf(data);
      if (rule.label === "Signal measurements") {
        const pts = parseMeasCsv(text);
        if (!pts.length) add(f, "skipped", rule.label, "Only the column titles: the modem logged no measurements here.");
        else {
          radio.push(...pts);
          add(f, "analysed", rule.label, rule.reason, `${pts.length} samples. ${scanNote}`);
        }
        continue;
      }
      if (rule.label === "Bookmarks") {
        const bug = /BugID="([^"]*)"/.exec(text)?.[1];
        const sum = /<Summary>([\s\S]*?)<\/Summary>/.exec(text)?.[1]?.trim();
        const marks = (text.match(/<(Item|Bookmark\w+|Mark)\b/g) || []).length;
        if (!bug && !sum && !marks) add(f, "skipped", rule.label, "No bookmarks or bug notes were added.");
        else {
          if (bug) device.bug = bug;
          if (sum) notes.push(`Logel note: ${sum}`);
          add(f, "info", rule.label, rule.reason, [bug && `Bug ${bug}`, sum].filter(Boolean).join(". "));
        }
        continue;
      }
      if (rule.role === "info") {
        if (/\.lst$/i.test(f.name)) parseLst(text, device);
        else if (/_modem\.ini$/i.test(f.name)) parseIni(text, device);
        else if (/_log_stat\.txt$/i.test(f.name)) stats = parseStats(text);
        add(f, "info", rule.label, rule.reason, hits.length ? scanNote : undefined);
        continue;
      }
      // text exports: decode them only when there is no .logel (it holds the same messages)
      if (HEX_LINE.test(text)) {
        if (hasLogel) add(f, "info", rule.label, "The .logel already holds these messages.", scanNote);
        else {
          texts.push(text);
          add(f, "analysed", rule.label, rule.reason, scanNote);
        }
      } else add(f, "info", rule.label, `No hex messages in it. ${SEARCHED}`, scanNote);
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
      await timeTraceLines(pbs, hits, /phytraceview/i.test(f.name) ? (base.phy ?? base.ps) : base.ps);
    } catch {
      /* leave them untimed */
    }
  }
  // an assert record without its own time takes the time of the first strong line that names the same place
  for (const e of events) {
    if (e.ts || !e.where) continue;
    const src0 = e.source?.split("/").pop()?.toLowerCase();
    const hit = crashLines.find((l) => l.strong && l.ts && src0 && l.text.toLowerCase().includes(src0));
    if (hit) e.ts = hit.ts;
  }
  // a memory dump usually holds the same assert as the .ass record: keep the record, once
  const unique: AssertRecord[] = events.filter((e) => !e.fromDump);
  for (const d of events.filter((e) => e.fromDump)) {
    if (d.where ? unique.some((k) => k.where === d.where) : unique.length > 0) continue;
    unique.push(d);
  }

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
    crashes: { events: unique, groups: groupLines(crashLines), searched, lines: crashLines.length },
  };
  return { capture, text: texts.length ? texts.join("\n\n") : undefined };
}
