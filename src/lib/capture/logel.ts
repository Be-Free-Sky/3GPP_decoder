/**
 * UNISOC Logel (.logel) reader.
 *
 * The file is a sequence of diag packets: [u32 length][u32 seq][u16 len][u8 type][u8 subtype][data].
 * Type 0xF8 packets carry the modem log; each subtype is one stream (protocol stack, PHY ...).
 * After a 24-byte header ([u32 0][u32 ticks per second][u32 tick][12 bytes]) the data of
 * consecutive packets of a stream join into one item stream, so items can cross packets.
 *
 * In the protocol stack stream:
 *   signal items  [0x20F][u32 words][00 00 30 00 01 ... 48-byte header][0x1C body][0x28 PDU]
 *                 header +10 sender task, +11 receiver task, +12 group, +14 code, +40 tick
 *   string traces [type][u32 info: bits 0-4 argument count, 5-15 format length in words][format][args]
 *
 * Time: a tick is 1 ms (the header says 1000 per second). A time packet (0x05 / 0x11) pairs a tick
 * with the log time; without it, the tool's start packet (0xD1 / 0x8x) pairs the PC time with a tick.
 * Both are wall-clock times stored as if UTC, so they are formatted with the UTC fields.
 */

export interface LogelRecord {
  tick: number;
  ts: string | null;
  protocol: string;
  hex: string;
  header: string;
}

export interface RadioSample {
  ts: string | null;
  rsrp?: number;
  rsrq?: number;
  sinr?: number;
  pci?: number;
  arfcn?: number;
}

export interface LogelResult {
  /** assert, crash, exception and reset lines anywhere in the file, every stream included */
  crash: CrashLine[];
  /** log time of a tick: protocol stack stream, and the PHY stream when it has its own clock */
  base: { ps: number | null; phy: number | null };
  /** log time (ms) of the packet at a byte offset, from the protocol stack clock and the order of the
   *  packets in the file: every stream, the assert console and Logel's trace index use it */
  timeAt: (offset: number, tick?: number) => number | null;
  /** what the modem printed on its assert console (UNISOC sends it inside the log) */
  console?: { text: string; ms: number | null; packets: number };
  /** a modem memory dump sent inside the log after an assert */
  dump?: { bytes: number; packets: number; head: Uint8Array; ms: number | null };
  records: LogelRecord[];
  radio: RadioSample[];
  at: { ts: string | null; line: string }[];
  device: Record<string, string>;
  packets: number;
  streams: number;
  internal: number;
  start: string | null;
  end: string | null;
  date: string | null;
  truncated: boolean;
}

import { scanText, type CrashLine } from "./crash";

/** UNISOC packets that are not traces: the assert console (0xff/0x00) and a memory dump (0xff/0x01). */
const CONSOLE = 0xff00;
const DUMP = 0xff01;

const NR_RRC: Record<number, string> = {
  1: "bcch-bch",
  2: "bcch-dl-sch",
  3: "pcch",
  4: "dl-ccch",
  5: "dl-dcch",
  6: "ul-ccch",
  7: "ul-dcch",
};

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

export function fmtClock(ms: number) {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

export function fmtDate(ms: number) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

const hexOf = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += (x < 16 ? "0" : "") + x.toString(16);
  return s;
};

interface Stream {
  sub: number;
  parts: [number, number][]; // [file offset, length]
  ticks: number[]; // tick of each part
  size: number;
  buf?: Uint8Array;
  starts?: number[]; // stream offset of each part
}

function findAll(hay: Uint8Array, needle: Uint8Array, from = 0, to = hay.length) {
  const out: number[] = [];
  const first = needle[0];
  const last = to - needle.length;
  let i = hay.indexOf(first, from);
  while (i >= 0 && i <= last) {
    let k = 1;
    while (k < needle.length && hay[i + k] === needle[k]) k++;
    if (k === needle.length) out.push(i);
    i = hay.indexOf(first, i + 1);
  }
  return out;
}

/** Offsets of signal items: [0F 02 00 00][u32 words][00 00 30 00 01]. */
function findSignals(b: Uint8Array, limit = Infinity) {
  const out: number[] = [];
  let i = b.indexOf(0x0f);
  while (i >= 0 && i + 13 <= b.length) {
    if (
      b[i + 1] === 0x02 && b[i + 2] === 0 && b[i + 3] === 0 && b[i + 7] === 0 &&
      b[i + 8] === 0 && b[i + 9] === 0 && b[i + 10] === 0x30 && b[i + 11] === 0 && b[i + 12] === 1
    ) {
      out.push(i);
      if (out.length >= limit) break;
    }
    i = b.indexOf(0x0f, i + 1);
  }
  return out;
}

const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** Radio traces of the UNISOC NR protocol stack: format string -> how to read its arguments. */
const RADIO_TRACES: { fmt: string; read: (a: number[]) => Partial<RadioSample> | "cell" | null }[] = [
  { fmt: "A2 rsrp enter Ms = %d hys = %d a2_Threshold = %d isSatifiesCell = %d", read: (a) => (a[0] > -16000 && a[0] < -2000 ? { rsrp: a[0] / 100 } : null) },
  {
    fmt: "NRRC: nrmes_is_need_report_l4_serving_cell_meas_result_ind,%d,%d,%d,%d.",
    read: (a) => (a.length === 4 && a[1] < -2000 && a[1] > -16000 && a[3] < 0 && a[3] > -4500 ? { rsrq: a[3] / 100 } : null),
  },
  {
    fmt: "NRRC: nreng_get_phy_static_info,dl bler:%d,ul bler:%d,tx power:%d,sinr:%d",
    read: (a) => (a.length === 4 && a[3] !== 0 && a[3] > -3000 && a[3] < 5000 ? { sinr: a[3] / 100 } : null),
  },
  { fmt: "UNISOC_INFO_TABLE:NR_PCI:%d,UNISOC_INFO_TABLE:NR_SS_RSRP: %d dBm", read: (a) => (a.length === 2 ? { pci: a[0], rsrp: a[1] } : null) },
  { fmt: "UNISOC_INFO_TABLE:NR_PCI:%d,UNISOC_INFO_TABLE:NR_SS_RSRQ: %d dB", read: (a) => (a.length === 2 ? { pci: a[0], rsrq: a[1] } : null) },
  { fmt: "UNISOC_INFO_TABLE:NR_PCI:%d,UNISOC_INFO_TABLE:NR_SS_SINR: %d dB", read: (a) => (a.length === 2 ? { pci: a[0], sinr: a[1] } : null) },
  { fmt: "NRRC: Get NR Serving cell info, pci:%x,afrcn:%x,bandwidth:%x", read: () => "cell" },
];

// AT answers are printable ASCII up to the end of the line
const AT_RE = /\+(C5GREG|CEREG|CREG|CGREG|CESQ|COPS|CGCONTRDP|CSCON|CME ERROR|CMS ERROR): ?[ -~]*/g;

function withoutTick<T extends { tick: number }>(o: T): Omit<T, "tick"> {
  const c: Partial<T> = { ...o };
  delete c.tick;
  return c as Omit<T, "tick">;
}

export function isLogel(head: Uint8Array) {
  if (head.length < 12) return false;
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const L = dv.getUint32(0, true);
  return L >= 8 && L < 1 << 20 && dv.getUint16(8, true) === L && head[10] === 0xd1;
}

export function parseLogel(data: Uint8Array, maxRecords = 5000, fileName = "the .logel"): LogelResult {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const streams = new Map<number, Stream>();
  const anchors = new Map<number, number>(); // stream -> base ms (time = base + tick)
  let pending: number | null = null;
  let lastSub: number | null = null;
  let sync: { sub: number; base: number } | null = null;
  let device = "";
  let off = 0;
  let packets = 0;
  let truncated = false;
  // every packet's place in the file and the stream tick it belongs to, to time crash lines
  const pOff: number[] = [];
  const pTick: number[] = []; // a trace packet's own tick, -1 for other packets
  const pKind: number[] = []; // trace stream sub, or 0xff00 / 0xff01, or -1
  while (off + 12 <= data.length) {
    const L = dv.getUint32(off, true);
    if (L < 8 || off + 4 + L > data.length) {
      truncated = off + 4 < data.length;
      break;
    }
    const type = data[off + 10];
    const sub = data[off + 11];
    packets++;
    pOff.push(off);
    pTick.push(type === 0xf8 && L >= 32 ? dv.getUint32(off + 20, true) : -1);
    pKind.push(type === 0xf8 && L >= 32 ? sub : type === 0xff && sub <= 1 ? (0xff00 | sub) : -1);
    if (type === 0xf8 && L >= 32) {
      const tick = dv.getUint32(off + 20, true);
      let s = streams.get(sub);
      if (!s) {
        s = { sub, parts: [], ticks: [], size: 0 };
        streams.set(sub, s);
      }
      s.parts.push([off + 36, L - 32]);
      s.ticks.push(tick);
      s.size += L - 32;
      // the tool's start packet just before a stream's first packet dates that stream
      if (pending !== null && !anchors.has(sub)) {
        anchors.set(sub, pending);
        pending = null;
      }
      lastSub = sub;
    } else if (type === 0xd1 && sub >= 0x80 && sub <= 0x8f && L >= 20) {
      const pc = dv.getUint32(off + 12, true) + dv.getUint32(off + 16, true) * 2 ** 32;
      pending = pc - dv.getUint32(off + 20, true);
    } else if (type === 0x05 && sub === 0x11 && L >= 24 && lastSub !== null) {
      sync = { sub: lastSub, base: dv.getUint32(off + 16, true) * 1000 - dv.getUint32(off + 24, true) };
    } else if (type === 0x00 && sub === 0x00 && L > 8) {
      device += new TextDecoder("latin1").decode(data.subarray(off + 12, off + 4 + L));
    }
    off += 4 + L;
  }
  const res = extract(data, streams, anchors, sync, device, packets, truncated, maxRecords);

  // One clock for every packet. The protocol stack stream is dated by its start anchor (or the
  // sync packet); the PHY streams' ticks can run on other clocks or pause, so every other packet
  // takes the time of the protocol stack packet just before it in the file (packets are written
  // in the order they arrive), or its own tick when its stream keeps time with it.
  const baseOf = (sub: number) => (sync && sync.sub === sub ? sync.base : anchors.get(sub) ?? null);
  const psSub = res.psSub ?? [...streams.values()].filter((x) => baseOf(x.sub) !== null).sort((a, b) => b.parts.length - a.parts.length)[0]?.sub;
  const psBase = psSub != null ? baseOf(psSub) : null;
  const n = pOff.length;
  const ms = new Float64Array(n).fill(NaN);
  const clocked = new Set<number>(); // streams whose own ticks keep time with the protocol stack
  if (psBase !== null) {
    if (psSub != null) clocked.add(psSub);
    let last = NaN;
    for (let i = 0; i < n; i++) {
      if (pKind[i] === psSub) last = psBase + pTick[i];
      ms[i] = last;
    }
    let next = NaN;
    for (let i = n - 1; i >= 0; i--) {
      if (pKind[i] === psSub) next = ms[i];
      else if (Number.isNaN(ms[i])) ms[i] = next;
    }
    for (const st of streams.values()) {
      if (st.sub === psSub) continue;
      const d: number[] = [];
      for (let i = 0; i < n; i++) if (pKind[i] === st.sub && !Number.isNaN(ms[i])) d.push(ms[i] - pTick[i]);
      if (d.length < 3) continue;
      const sorted = [...d].sort((x, y) => x - y);
      const mid = sorted[sorted.length >> 1];
      if (d.filter((x) => Math.abs(x - mid) < 2000).length >= d.length * 0.9) {
        clocked.add(st.sub);
        for (let i = 0; i < n; i++) if (pKind[i] === st.sub) ms[i] = mid + pTick[i];
      }
    }
  }
  const packetAt = (offset: number) => {
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (pOff[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  // a line's own tick refines its packet's time when its stream keeps time
  res.timeAt = (offset: number, tick?: number) => {
    if (!n) return null;
    const i = packetAt(offset);
    const v = ms[i];
    if (Number.isNaN(v)) return null;
    const d = tick === undefined || pTick[i] < 0 || !clocked.has(pKind[i]) ? 0 : tick - pTick[i];
    return d > 0 && d < 10000 ? v + d : v;
  };
  const phySub = [...streams.values()].filter((x) => x.sub !== psSub).sort((a, b) => b.size - a.size)[0]?.sub;
  res.base = { ps: psBase, phy: phySub != null ? baseOf(phySub) : null };

  // the assert console and a memory dump the modem sent after an assert
  const dec = new TextDecoder("latin1");
  let consoleText = "";
  let consolePackets = 0;
  let consoleMs: number | null = null;
  let dumpBytes = 0;
  let dumpPackets = 0;
  let dumpHead: Uint8Array | null = null;
  let dumpMs: number | null = null;
  for (let i = 0; i < n; i++) {
    if (pKind[i] === CONSOLE) {
      const L = dv.getUint32(pOff[i], true);
      consoleText += dec.decode(data.subarray(pOff[i] + 12, pOff[i] + 4 + L)).replace(/\0+/g, "\n");
      consolePackets++;
      if (consoleMs === null && !Number.isNaN(ms[i])) consoleMs = ms[i];
    } else if (pKind[i] === DUMP) {
      const L = dv.getUint32(pOff[i], true);
      dumpBytes += L - 8;
      dumpPackets++;
      if (!dumpHead) {
        dumpHead = data.slice(pOff[i] + 12, pOff[i] + 12 + 64);
        if (!Number.isNaN(ms[i])) dumpMs = ms[i];
      }
    }
  }
  if (consolePackets && consoleText.trim()) res.console = { text: consoleText, ms: consoleMs, packets: consolePackets };
  if (dumpPackets && dumpHead) res.dump = { bytes: dumpBytes, packets: dumpPackets, head: dumpHead, ms: dumpMs };

  // Search the whole file, every stream, for assert / crash / reset text, and time each hit. The
  // console is read as an assert record and a memory dump holds the firmware's own message text,
  // so neither is searched line by line here.
  const WIN = 16 * 1024 * 1024;
  const OVER = 1024;
  let lastEnd = -1;
  for (let w = 0; w < data.length; w += WIN) {
    const from = Math.max(0, w - OVER);
    const text = dec.decode(data.subarray(from, Math.min(data.length, w + WIN)));
    for (const hit of scanText(text, fileName, from)) {
      if (hit.offset <= lastEnd) continue;
      lastEnd = hit.offset;
      const i = packetAt(hit.offset);
      if (pKind[i] === CONSOLE || pKind[i] === DUMP) continue;
      hit.ts = Number.isNaN(ms[i]) ? null : fmtClock(ms[i]);
      res.crash.push(hit);
    }
    if (res.crash.length > 5000) break;
  }
  delete (res as { psSub?: number }).psSub;
  return res;
}

function extract(
  data: Uint8Array,
  streams: Map<number, Stream>,
  anchors: Map<number, number>,
  sync: { sub: number; base: number } | null,
  deviceText: string,
  packets: number,
  truncated: boolean,
  maxRecords: number,
): LogelResult & { psSub?: number } {
  const records: LogelRecord[] = [];
  const radio: (RadioSample & { tick: number })[] = [];
  const at: { ts: string | null; line: string; tick: number }[] = [];
  let internal = 0;
  let minMs = Infinity;
  let maxMs = -Infinity;
  let psSub: number | undefined;
  for (const s of streams.values()) {
    // Only protocol stack streams carry signal items; skip the rest (the PHY stream can be 90 % of the file).
    if (!s.parts.some(([o, len]) => findSignals(data.subarray(o, o + len), 1).length)) continue;
    const buf = new Uint8Array(s.size);
    const starts: number[] = [];
    let at0 = 0;
    for (const [o, len] of s.parts) {
      starts.push(at0);
      buf.set(data.subarray(o, o + len), at0);
      at0 += len;
    }
    s.buf = buf;
    s.starts = starts;
    psSub ??= s.sub;
    const base = sync && sync.sub === s.sub ? sync.base : anchors.get(s.sub) ?? null;
    const tickAt = (p: number) => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= p) lo = mid;
        else hi = mid - 1;
      }
      return s.ticks[lo];
    };
    const tsOf = (tick: number) => {
      if (base === null) return null;
      const ms = base + tick;
      if (ms < minMs) minMs = ms;
      if (ms > maxMs) maxMs = ms;
      return fmtClock(ms);
    };
    const v = new DataView(buf.buffer);

    // signal items
    let signals = 0;
    for (const item of findSignals(buf)) {
      const m = item + 8;
      const words = v.getUint32(item + 4, true);
      const end = m + words * 4;
      if (words < 16 || words > 0x4000 || end > buf.length) continue;
      signals++;
      const H = m + 4;
      const snd = buf[H + 10];
      const rcv = buf[H + 11];
      const grp = buf[H + 12];
      const code = v.getUint16(H + 14, true);
      const tick = v.getUint32(H + 40, true);
      let p = H + 48;
      let pdu: Uint8Array | null = null;
      while (p + 4 <= end) {
        const ty = v.getUint16(p, true);
        const ln = v.getUint16(p + 2, true);
        if (ty === 0x1c) p += 8 + v.getUint16(p + 6, true);
        else if (ty === 0x28) {
          if (p + 4 + ln <= end && ln > 0) pdu = buf.subarray(p + 4, p + 4 + ln);
          break;
        } else break;
      }
      let protocol: string | null = null;
      let label = "";
      if (pdu) {
        if (grp === 249 && NR_RRC[code]) {
          protocol = `nr-rrc.${NR_RRC[code]}`;
          label = `NR RRC ${NR_RRC[code].toUpperCase()}`;
        } else if (snd === rcv && pdu[0] === 0x7e) {
          protocol = "nas.5gs";
          label = "5GS NAS";
        } else if (snd === rcv && (pdu[0] & 0x0f) === 0x07 && pdu[0] >> 4 <= 4) {
          protocol = "nas.eps";
          label = "EPS NAS";
        }
      }
      if (!protocol || !pdu) {
        internal++;
        continue;
      }
      if (records.length < maxRecords) {
        records.push({ tick, ts: tsOf(tick), protocol, hex: hexOf(pdu), header: `${label}, modem log` });
      }
    }
    if (!signals) continue;

    // radio traces of this protocol stack stream
    const events: { tick: number; v: Partial<RadioSample> | "cell"; a: number[] }[] = [];
    for (const t of RADIO_TRACES) {
      const needle = ascii(t.fmt + "\0");
      for (const i of findAll(buf, needle)) {
        if (i < 4) continue;
        const info = v.getUint32(i - 4, true);
        const nargs = info & 0x1f;
        const words = (info >>> 5) & 0x7ff;
        const a0 = i + words * 4;
        if (words * 4 < needle.length || a0 + nargs * 4 > buf.length) continue;
        const args: number[] = [];
        for (let k = 0; k < nargs; k++) args.push(v.getInt32(a0 + 4 * k, true));
        const val = t.read(args);
        if (val) events.push({ tick: tickAt(i), v: val, a: args });
      }
    }
    events.sort((x, y) => x.tick - y.tick);
    let cell: { pci?: number; arfcn?: number } = {};
    for (const e of events) {
      if (e.v === "cell") {
        if (e.a.length >= 2) cell = { pci: e.a[0], arfcn: e.a[1] };
        continue;
      }
      const pt: RadioSample & { tick: number } = { tick: e.tick, ts: tsOf(e.tick), ...e.v };
      for (const k of ["rsrp", "rsrq", "sinr"] as const) if (pt[k] !== undefined) pt[k] = Math.round(pt[k]! * 10) / 10;
      if (pt.pci === undefined && cell.pci !== undefined) pt.pci = cell.pci;
      if (pt.arfcn === undefined && cell.arfcn !== undefined) pt.arfcn = cell.arfcn;
      radio.push(pt);
    }

    // AT responses
    const text = new TextDecoder("latin1").decode(buf);
    const seen = new Set<string>();
    for (const m of text.matchAll(AT_RE)) {
      const tick = tickAt(m.index!);
      const line = m[0].trim();
      const key = `${line}|${Math.floor(tick / 50)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      at.push({ ts: tsOf(tick), line, tick });
    }
  }

  records.sort((a, b) => a.tick - b.tick);
  radio.sort((a, b) => a.tick - b.tick);
  at.sort((a, b) => a.tick - b.tick);
  const device: Record<string, string> = {};
  for (const [k, rx] of [
    ["platform", /Platform Version:\s*(\S+)/],
    ["project", /Project Version:\s*(\S+)/],
    ["modem", /(?:Base|Modem) Version:\s*(\S+)/],
  ] as const) {
    const m = rx.exec(deviceText);
    if (m) device[k] = m[1];
  }
  // keep the radio series to a chartable size
  const step = Math.max(1, Math.ceil(radio.length / 1500));
  return {
    crash: [],
    base: { ps: null, phy: null },
    timeAt: () => null,
    psSub,
    records,
    radio: radio.filter((_, i) => i % step === 0).map(withoutTick),
    at: at.map(withoutTick),
    device,
    packets,
    streams: streams.size,
    internal,
    start: Number.isFinite(minMs) ? fmtClock(minMs) : null,
    end: Number.isFinite(maxMs) ? fmtClock(maxMs) : null,
    date: Number.isFinite(minMs) ? fmtDate(minMs) : null,
    truncated,
  };
}
