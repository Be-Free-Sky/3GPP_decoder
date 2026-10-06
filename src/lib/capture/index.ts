/**
 * Open a Logel capture (a zip, a folder, or loose files), pick the files that help
 * troubleshooting, read them and build the capture the engine decodes.
 */

import { isZip, listZip, readZipEntry } from "./zip";
import { isLogel, parseLogel, type LogelResult, type RadioSample } from "./logel";
import { summarizePcap, type IpSummary } from "./pcap";

export interface SourceFile {
  path: string;
  name: string;
  size: number;
  read: () => Promise<Uint8Array>;
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
  return { path: path || f.webkitRelativePath || f.name, name: f.name, size: f.size, read: async () => new Uint8Array(await f.arrayBuffer()) };
}

async function zipSources(f: File): Promise<SourceFile[]> {
  const entries = await listZip(f);
  return entries.map((e) => ({ path: e.path, name: e.name, size: e.size, read: () => readZipEntry(f, e) }));
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
      out.push(...(await zipSources(f)));
      zipped++;
    } else out.push(fileSource(f, path));
  }
  const size = picked.reduce((n, p) => n + p.file.size, 0);
  const first = picked[0];
  const root = folderName || (first?.path || first?.file.webkitRelativePath || "").split("/").filter(Boolean)[0];
  if (picked.length === 1 && zipped === 1) return { name: first.file.name.replace(/\.zip$/i, ""), kind: "zip", size, files: out };
  if (root && picked.length > 1 && (first.path || first.file.webkitRelativePath)) return { name: root, kind: "folder", size, files: out };
  return { name: picked.length === 1 ? first.file.name : `${picked.length} files`, kind: "files", size, files: out };
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

const CACHE = "Logel's display cache, built when the log was opened in Logel. Everything in it comes from the .logel, which is read instead.";

const RULES: Rule[] = [
  { test: /\.logel$/i, role: "analysed", label: "Modem log (Logel)", reason: "Every RRC and NAS message, the modem's radio measurements and its AT command answers." },
  { test: /(^|\/)(msgview|msgflowview|traceview|phytraceview|phyparamchart)\.(dat|pbs)$/i, role: "skipped", label: "Logel view cache", reason: CACHE },
  { test: /_(bt|wcn)\.cap$/i, role: "skipped", label: "Bluetooth / Wi-Fi chip packets", reason: "Packets of the connectivity chip, not the cellular modem." },
  { test: /_mux\.cap$/i, role: "skipped", label: "AT channel packets", reason: "Raw AT channel traffic. The AT answers are read from the .logel." },
  { test: /\.(cap|pcap)$/i, role: "check", label: "IP packets", reason: "Data traffic of the modem: DNS lookups, their answers and failures." },
  { test: /\.pcapng$/i, role: "skipped", label: "IP packets (pcapng)", reason: "pcapng is not read yet. Logel's own .cap files are." },
  { test: /_(lte|nr|5g|gsm|wcdma|td)\.csv$/i, role: "check", label: "Signal measurements", reason: "RSRP / SINR samples exported by Logel." },
  { test: /\.lst$/i, role: "info", label: "Log record", reason: "Modem software and Logel tool versions." },
  { test: /_modem\.ini$/i, role: "info", label: "Modem version", reason: "Platform, project, hardware and build time of the modem software." },
  { test: /_log_stat\.txt$/i, role: "info", label: "Lost-packet statistics", reason: "Shows whether the log is complete. Lost packets mean missing messages." },
  { test: /_bookmark\.xml$/i, role: "check", label: "Bookmarks", reason: "Bug ID and notes added in Logel." },
  { test: /\.iq$/i, role: "skipped", label: "IQ samples", reason: "Raw radio samples for lab analysis. They hold no signalling." },
  { test: /(\.wvoice|_vt_(up|down)\.bin)$/i, role: "skipped", label: "Call media", reason: "Voice or video call payload, not signalling." },
  { test: /(\.xdsp_log|_wcn_dsp\.org|_dsp_ag_trace\.txt)$/i, role: "skipped", label: "DSP trace", reason: "Chip trace in UNISOC's own format. It needs UNISOC's trace database." },
  { test: /\.wrrc_log$/i, role: "skipped", label: "WCDMA RRC trace", reason: "3G RRC trace. Signalling is read from the .logel." },
  { test: /_ipa_des\.bin$/i, role: "skipped", label: "IP accelerator data", reason: "Internal modem buffers, not useful for analysis." },
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

  const add = (f: SourceFile, role: FileRole, label: string, reason: string, detail?: string) =>
    files.push({ path: f.path, name: f.name, size: f.size, role, label, reason, detail });

  // small files first (fast), the big .logel last
  const order = [...src.files].sort((a, b) => Number(/\.logel$/i.test(a.name)) - Number(/\.logel$/i.test(b.name)));
  for (const f of order) {
    const rule = RULES.find((r) => r.test.test(f.path) || r.test.test(f.name));
    if (!rule) {
      add(f, "skipped", "Other file", "Not a log type this decoder reads.");
      continue;
    }
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
          add(f, "skipped", rule.label, "Not in the Logel format this page reads (UNISOC armlog).");
          continue;
        }
        onStep(`Finding RRC and NAS messages in ${f.name}`);
        await new Promise((r) => setTimeout(r, 0));
        const res: LogelResult = parseLogel(data);
        records.push(...res.records);
        radio.push(...res.radio);
        at.push(...res.at);
        Object.entries(res.device).forEach(([k, v]) => (device[k] ??= v));
        span = { date: res.date, start: res.start, end: res.end };
        if (res.truncated) notes.push(`${f.name} ends part way through a packet: the log may have been cut short.`);
        const bits = [
          `${res.records.length} RRC and NAS ${res.records.length === 1 ? "message" : "messages"}`,
          res.at.length ? `${res.at.length} AT answers` : null,
          res.radio.length ? `${res.radio.length} radio samples` : null,
        ].filter(Boolean);
        add(f, "analysed", rule.label, rule.reason, `${bits.join(", ")}. ${res.internal} internal modem messages left out.`);
        continue;
      }
      const data = await f.read();
      if (rule.label === "IP packets") {
        const s = summarizePcap(data);
        if (!s) add(f, "skipped", rule.label, "Not a pcap file this page reads.");
        else if (!s.packets) add(f, "skipped", rule.label, "Empty: no packets were captured.");
        else {
          if (!ip || s.packets > ip.packets) ip = s;
          add(f, "analysed", rule.label, rule.reason,
            `${s.packets} packets (${s.ul} up, ${s.dl} down), ${s.dns.length} DNS ${s.dns.length === 1 ? "lookup" : "lookups"}.`);
        }
        continue;
      }
      const text = textOf(data);
      if (rule.label === "Signal measurements") {
        const pts = parseMeasCsv(text);
        if (!pts.length) add(f, "skipped", rule.label, "Only the column titles: the modem logged no measurements here.");
        else {
          radio.push(...pts);
          add(f, "analysed", rule.label, rule.reason, `${pts.length} samples.`);
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
        add(f, "info", rule.label, rule.reason);
        continue;
      }
      // text exports: decode them only when there is no .logel (it holds the same messages)
      if (HEX_LINE.test(text)) {
        if (hasLogel) add(f, "skipped", rule.label, "The .logel already holds these messages.");
        else {
          texts.push(text);
          add(f, "analysed", rule.label, rule.reason);
        }
      } else add(f, "skipped", rule.label, "No hex messages in it.");
    } catch (e) {
      add(f, "skipped", rule.label, `Could not be read: ${e instanceof Error ? e.message : String(e)}`);
    }
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
  };
  return { capture, text: texts.length ? texts.join("\n\n") : undefined };
}
