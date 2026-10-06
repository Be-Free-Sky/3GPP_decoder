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
    mode: "manual" | "hint" | "auto";
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
  from: number;
}

export interface Session {
  events: FlowEvent[];
  allEvents: FlowEvent[];
  lanes: string[];
  procedures: Procedure[];
  findings: Finding[];
  radio: { points: RadioPoint[]; rsrp?: { min: number; max: number; avg: number } };
  context: { network: ContextItem[]; ue: ContextItem[]; radio: ContextItem[]; data: ContextItem[] };
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
