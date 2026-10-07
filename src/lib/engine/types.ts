// Shapes produced by decoder/engine (Python) and passed through the worker as JSON.

export type Severity = "critical" | "warning" | "info" | "ok";
export type Quality = "excellent" | "good" | "fair" | "poor" | "bad";
export type Direction = "UL" | "DL" | null;
export type Status = "ok" | "warning" | "failure";

export interface TreeNode {
  /** raw spec identifier */
  k: string;
  /** readable label */
  l: string;
  /** release tag (r15, v1530 ...) */
  r?: string;
  /** ASN.1 / NAS type name */
  t?: string;
  /** displayed raw value */
  v?: string;
  /** human interpretation */
  h?: string;
  /** semantic tag (pci, rsrp, plmn ...) */
  tag?: string;
  q?: Quality;
  num?: number;
  c?: TreeNode[];
  /** chosen CHOICE alternative */
  ch?: string;
  chl?: string;
  /** item count for lists */
  n?: number;
  /** full hex for long octet strings */
  x?: string;
  /** index into result.embedded */
  emb?: number;
  cont?: string;
}

export interface Highlight {
  label: string;
  value: string;
  hint?: string;
  tag?: string;
  q?: Quality;
}

export interface Finding {
  severity: Severity;
  title: string;
  detail?: string;
  causes?: string[];
  checks?: string[];
  ref?: string;
  code?: number;
  category?: string;
  field?: string;
  refs?: number[];
  via?: string;
  count?: number;
  procedure?: boolean;
}

export interface ProtocolRef {
  id: string;
  family?: string;
  rat?: string;
  layer?: string;
  channel?: string;
  label?: string;
}

export interface Alternative {
  id: string;
  label: string;
  message: string;
  score: number;
}

export interface DecodeResult {
  ok: boolean;
  error?: string;
  protocol: ProtocolRef;
  bytes: number;
  hex: string;
  warnings: string[];
  findings: Finding[];
  highlights: Highlight[];
  embedded: { field: string; result: DecodeResult }[];
  direction?: Direction;
  message?: {
    name: string;
    title: string;
    release?: string | null;
    proto?: string;
    type?: number;
    wrapped?: boolean;
    outcome?: string;
  };
  summary?: string;
  tree?: TreeNode;
  text?: string;
  status?: Status;
  detection?: {
    mode: "manual" | "hint" | "auto" | "log";
    confidence: "high" | "medium" | "low" | "none" | "manual";
    score?: number;
    alternatives: Alternative[];
  };
  facts?: Record<string, unknown>;
  security?: { header: number; label?: string };
  nas?: { family: string; proto: string };
}

export interface MessageEntry {
  index: number;
  line: number | null;
  timestamp: string | null;
  header: string | null;
  result: DecodeResult;
}

export interface FlowEvent {
  i: number;
  sub?: number;
  ts?: string | null;
  from?: string;
  to?: string;
  title: string;
  layer?: string;
  status: Status;
  key?: string;
  bcast?: boolean;
  via?: string;
  nested?: boolean;
  error?: boolean;
}

export interface Procedure {
  id: string;
  name: string;
  start: number;
  end?: number;
  startTs?: string | null;
  endTs?: string | null;
  endTitle?: string;
  status: "success" | "failure" | "no-answer" | "retried" | "open";
  steps: number[];
  layer: string;
  durationMs?: number;
}

export interface RadioPoint {
  i: number;
  ts?: string | null;
  rat?: string;
  rsrp?: number;
  rsrq?: number;
  sinr?: number;
  neighbors: { rat: string; pci: number; rsrp?: number; rsrq?: number; sinr?: number }[];
}

export interface ContextItem {
  label: string;
  value: string;
  hint?: string | null;
  /** message the value came from; null for values from the capture's AT answers or traces */
  from: number | null;
}

/** Serving cell samples from the modem's own traces and AT+CESQ (capture logs). */
export interface ModemSample {
  ts?: string | null;
  rsrp?: number;
  rsrq?: number;
  sinr?: number;
  pci?: number;
  arfcn?: number;
  src?: string;
}

export interface Stat {
  min: number;
  max: number;
  avg: number;
  median: number;
  n: number;
}

export interface ModemRadio {
  points: ModemSample[];
  rsrp?: Stat;
  rsrq?: Stat;
  sinr?: Stat;
  cells?: { pci: number; arfcn?: number; band?: number }[];
}

export interface CaptureFileInfo {
  path: string;
  name: string;
  size: number;
  role: "analysed" | "info" | "skipped";
  label: string;
  reason: string;
  detail?: string;
}

export interface CaptureInfo {
  name?: string;
  kind?: string;
  files?: CaptureFileInfo[];
  device?: Record<string, string>;
  stats?: { lostCount: number; lostPercent?: number; totalPackets?: number };
  ip?: {
    packets: number;
    ul: number;
    dl: number;
    bytes: number;
    tcp: number;
    udp: number;
    icmp: number;
    tcpResets: number;
    first: string | null;
    last: string | null;
    dns: { ts: string; name: string; type: string; rcode: number | null; answers: number; answered?: boolean; rttMs?: number }[];
    servers: string[];
  };
  span?: { date: string | null; start: string | null; end: string | null };
  notes?: string[];
  /** asserts and crashes: records, dumps and every matching line in any file */
  crashes?: CrashInfo;
}

export type CrashKind = "assert" | "exception" | "watchdog" | "reset" | "memory" | "panic" | "fatal";

/** One assert record or crash file, read field by field. */
export interface AssertRecord {
  file: string;
  kind: CrashKind;
  title: string;
  where?: string;
  source?: string;
  line?: number;
  module?: string;
  expression?: string;
  message?: string;
  task?: string;
  exception?: string;
  ts?: string | null;
  version?: string;
  registers: { name: string; value: string }[];
  stack: string[];
  raw: string;
  fromDump?: boolean;
  /** which core asserted (PS CP, NR PHY ...) and its assert number ("core0 assert 1") */
  core?: string;
  number?: number;
  /** the assert was requested, not a fault: the command that asked for it (AT+SPATASSERT) */
  forced?: string;
  /** when and where that command reached the modem */
  forcedBy?: { ts?: string | null; line: string; channel?: string };
  /** firmware build time printed with the versions (not the time of the assert) */
  build?: string;
  versions?: { label: string; value: string }[];
  /** the task that was running: ID, name, queue use, stack bounds */
  thread?: { label: string; value: string }[];
  cpuMode?: string;
  corePcs?: { core: string; pc: string }[];
  banked?: { mode: string; registers: { name: string; value: string }[] }[];
  /** asserts of every core at that moment, from the traces: the one that asked and the ones stopped with it */
  cores?: CoreAssert[];
  /** asserts kept in modem memory (the firmware's recent-asserts list), from dumps */
  history?: CoreAssert[];
  /** files the assert handler wrote, and whether they are in the log */
  dumps?: { file: string; size?: number; what: string; present?: boolean }[];
  regions?: { name: string; start: string; length: string }[];
  memory?: AssertMemory;
  /** section headings in the record, so nothing in it goes unseen */
  sections?: string[];
  /** commands typed at the assert console (t, reboot ...) */
  commands?: string[];
  /** other files that hold the same record */
  also?: string[];
}

/** One "Modem Assert: <task> <core> assert in file X line N exp=E info=[I]" line. */
export interface CoreAssert {
  core: string;
  task?: string;
  file: string;
  line: number;
  exp?: string;
  info?: string;
  ts?: string | null;
  from: string;
}

export interface MemoryUse {
  site: string;
  count: number;
  bytes: number;
}

/** Memory at the assert, from the allocation lists the assert handler printed. */
export interface AssertMemory {
  blockPool?: { entries: number; bytes: number; top: MemoryUse[]; byEntity: MemoryUse[] };
  bytePool?: { entries: number; bytes: number; top: MemoryUse[]; corrupted?: string };
  initialized?: { entries: number; bytes: number; top: MemoryUse[]; byEntity: MemoryUse[] };
  /** a list that stopped part way, because the record or the log ends there */
  cutShort?: string;
}

/** The same assert or crash line wherever it was found, with how often and when. */
export interface CrashGroup {
  kind: CrashKind;
  /** a firm sign of a crash rather than a word in a trace */
  strong: boolean;
  text: string;
  files: Record<string, number>;
  count: number;
  first: string | null;
  last: string | null;
  /** the assert record this line belongs to (a core stopping with it, the command that asked for it) */
  explained?: string;
}

export interface CrashInfo {
  events: AssertRecord[];
  groups: CrashGroup[];
  /** files whose contents were searched (left out of a shared report, which keeps only the count) */
  searched: string[];
  searchedCount?: number;
  lines: number;
}

/** How many files were searched for asserts. */
export const searchedCount = (c?: CrashInfo | null) => c?.searchedCount ?? c?.searched.length ?? 0;

/** Whether a capture shows a crash: an assert record, a dump or a firm crash line. */
export function crashFound(c?: CrashInfo | null) {
  return Boolean(c && (c.events.length || c.groups.some((g) => g.strong)));
}

export interface Session {
  events: FlowEvent[];
  allEvents: FlowEvent[];
  lanes: string[];
  procedures: Procedure[];
  findings: Finding[];
  radio: { points: RadioPoint[]; rsrp?: { min: number; max: number; avg: number }; modem?: ModemRadio };
  context: { network: ContextItem[]; ue: ContextItem[]; radio: ContextItem[]; data: ContextItem[]; device?: ContextItem[] };
  kpis: {
    messages: number;
    decoded: number;
    failedDecode: number;
    critical: number;
    warnings: number;
    procedures: Record<string, number>;
    rats: string[];
    handovers: number;
    reestablishments: number;
    durationMs: number | null;
  };
  narrative: {
    steps: { i: number; severity: Severity; text: string }[];
    root: { title: string; detail?: string; refs: number[]; checks: string[]; causes: string[] } | null;
  };
  verdict: Status;
}

export interface Report {
  version: string;
  truncated: boolean;
  messages: MessageEntry[];
  session: Session | null;
  /** present when the input was a modem log capture (zip, folder, .logel) */
  capture?: CaptureInfo;
}

export interface CatalogProtocol {
  id: string;
  family: string;
  rat: string;
  layer: string;
  channel: string;
  direction: Direction;
  label: string;
  group: string;
  bundle: string;
}

export interface Catalog {
  protocols: CatalogProtocol[];
  groups: string[];
  version: string;
}

export type SplitMode = "auto" | "lines" | "single";
