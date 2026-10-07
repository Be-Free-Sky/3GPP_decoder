/**
 * IP packet capture (.cap / .pcap) summary: traffic counts and every DNS lookup with its answer.
 * Logel writes the modem's IP packets as classic pcap with a 14-byte pseudo Ethernet header whose
 * 6th byte is the direction (1 = uplink, 2 = downlink). Raw IP captures (link type 101 / 228 / 229)
 * are read too.
 */

import { fmtClock } from "./logel";

export interface DnsLookup {
  ts: string;
  name: string;
  type: string;
  rcode: number | null;
  answers: number;
  answered: boolean;
  rttMs?: number;
}

export interface IpSummary {
  packets: number;
  ul: number;
  dl: number;
  bytes: number;
  ipv4: number;
  ipv6: number;
  tcp: number;
  udp: number;
  icmp: number;
  tcpResets: number;
  first: string | null;
  last: string | null;
  dns: DnsLookup[];
  servers: string[];
}

const QTYPE: Record<number, string> = { 1: "A", 28: "AAAA", 5: "CNAME", 15: "MX", 16: "TXT", 33: "SRV", 35: "NAPTR", 65: "HTTPS", 12: "PTR" };

export function pcapPackets(data: Uint8Array) {
  if (data.length < 24) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = dv.getUint32(0, true);
  const le = magic === 0xa1b2c3d4 || magic === 0xa1b23c4d;
  const be = magic === 0xd4c3b2a1 || magic === 0x4d3cb2a1;
  if (!le && !be) return null;
  const nano = magic === 0xa1b23c4d || magic === 0x4d3cb2a1;
  const link = dv.getUint32(20, le);
  const out: { ms: number; dir: "UL" | "DL" | null; ip: Uint8Array }[] = [];
  let off = 24;
  while (off + 16 <= data.length) {
    const sec = dv.getUint32(off, le);
    const frac = dv.getUint32(off + 4, le);
    const incl = dv.getUint32(off + 8, le);
    off += 16;
    if (off + incl > data.length) break;
    const pkt = data.subarray(off, off + incl);
    off += incl;
    let ip: Uint8Array | null = null;
    let dir: "UL" | "DL" | null = null;
    if (link === 1 && pkt.length > 14) {
      const et = (pkt[12] << 8) | pkt[13];
      if (et === 0x0800 || et === 0x86dd) ip = pkt.subarray(14);
      dir = pkt[5] === 1 ? "UL" : pkt[5] === 2 ? "DL" : null;
    } else if (link === 101 || link === 228 || link === 229 || link === 12 || link === 14) {
      ip = pkt;
    }
    if (ip) out.push({ ms: sec * 1000 + Math.floor(nano ? frac / 1e6 : frac / 1000), dir, ip });
  }
  return out;
}

function readName(msg: Uint8Array, p: number, depth = 0): [string, number] {
  const labels: string[] = [];
  let end = -1;
  while (p < msg.length) {
    const len = msg[p];
    if (len === 0) {
      p++;
      break;
    }
    if ((len & 0xc0) === 0xc0) {
      if (depth > 8 || p + 1 >= msg.length) break;
      const [rest] = readName(msg, ((len & 0x3f) << 8) | msg[p + 1], depth + 1);
      if (rest) labels.push(rest);
      if (end < 0) end = p + 2;
      p += 2;
      break;
    }
    labels.push(String.fromCharCode(...msg.subarray(p + 1, p + 1 + len)));
    p += 1 + len;
  }
  return [labels.join("."), end >= 0 ? end : p];
}

function ipText(b: Uint8Array) {
  if (b.length === 4) return Array.from(b).join(".");
  const g: string[] = [];
  for (let i = 0; i < 16; i += 2) g.push(((b[i] << 8) | b[i + 1]).toString(16));
  return g.join(":").replace(/(^|:)0(:0)+(:|$)/, "::").replace(/:{3,}/, "::");
}

export function summarizePcap(data: Uint8Array): IpSummary | null {
  const pkts = pcapPackets(data);
  if (!pkts) return null;
  const s: IpSummary = {
    packets: pkts.length, ul: 0, dl: 0, bytes: 0, ipv4: 0, ipv6: 0, tcp: 0, udp: 0, icmp: 0, tcpResets: 0,
    first: pkts.length ? fmtClock(pkts[0].ms) : null,
    last: pkts.length ? fmtClock(pkts[pkts.length - 1].ms) : null,
    dns: [], servers: [],
  };
  const open = new Map<string, DnsLookup & { ms: number }>();
  const servers = new Set<string>();
  for (const p of pkts) {
    s.bytes += p.ip.length;
    if (p.dir === "UL") s.ul++;
    else if (p.dir === "DL") s.dl++;
    const v = p.ip[0] >> 4;
    let proto: number;
    let l4: Uint8Array;
    let src: Uint8Array;
    let dst: Uint8Array;
    if (v === 4 && p.ip.length >= 20) {
      s.ipv4++;
      proto = p.ip[9];
      l4 = p.ip.subarray((p.ip[0] & 0x0f) * 4);
      src = p.ip.subarray(12, 16);
      dst = p.ip.subarray(16, 20);
    } else if (v === 6 && p.ip.length >= 40) {
      s.ipv6++;
      proto = p.ip[6];
      l4 = p.ip.subarray(40);
      src = p.ip.subarray(8, 24);
      dst = p.ip.subarray(24, 40);
    } else continue;
    if (proto === 6) {
      s.tcp++;
      if (l4.length >= 14 && l4[13] & 0x04) s.tcpResets++;
    } else if (proto === 1 || proto === 58) s.icmp++;
    else if (proto === 17 && l4.length >= 8) {
      s.udp++;
      const sport = (l4[0] << 8) | l4[1];
      const dport = (l4[2] << 8) | l4[3];
      if (sport !== 53 && dport !== 53) continue;
      const msg = l4.subarray(8);
      if (msg.length < 12) continue;
      const id = (msg[0] << 8) | msg[1];
      const qr = msg[2] >> 7;
      const rcode = msg[3] & 0x0f;
      const qd = (msg[4] << 8) | msg[5];
      const an = (msg[6] << 8) | msg[7];
      if (!qd) continue;
      const [name, q] = readName(msg, 12);
      const qtype = q + 2 <= msg.length ? (msg[q] << 8) | msg[q + 1] : 0;
      const key = `${id}|${name}|${qtype}`;
      if (!qr) {
        servers.add(ipText(dst));
        if (!open.has(key)) {
          const look = { ts: fmtClock(p.ms), ms: p.ms, name, type: QTYPE[qtype] ?? String(qtype), rcode: null, answers: 0, answered: false };
          open.set(key, look);
          s.dns.push(look);
        }
      } else {
        servers.add(ipText(src));
        const look = open.get(key);
        if (look && !look.answered) {
          look.answered = true;
          look.rcode = rcode;
          look.answers = an;
          look.rttMs = p.ms - look.ms;
        }
      }
    }
  }
  // a lookup in the last 3 s of the capture may simply have been cut off: leave it undecided
  const lastMs = pkts.length ? pkts[pkts.length - 1].ms : 0;
  s.dns = (s.dns as (DnsLookup & { ms: number })[])
    .map(({ ms, ...d }) => (!d.answered && lastMs - ms < 3000 ? { ...d, answered: undefined as unknown as boolean } : d))
    .slice(0, 400);
  s.servers = [...servers].slice(0, 6);
  return s;
}

/** Packets in any pcap, IP or not, and its link type (for AT channel, Bluetooth or other captures). */
export function pcapCount(data: Uint8Array): { link: number; total: number } | null {
  if (data.length < 24) return null;
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const magic = dv.getUint32(0, true);
  const le = magic === 0xa1b2c3d4 || magic === 0xa1b23c4d;
  const be = magic === 0xd4c3b2a1 || magic === 0x4d3cb2a1;
  if (!le && !be) return null;
  let total = 0;
  let off = 24;
  while (off + 16 <= data.length) {
    const incl = dv.getUint32(off + 8, le);
    off += 16 + incl;
    if (off > data.length) break;
    total++;
  }
  return { link: dv.getUint32(20, le), total };
}
