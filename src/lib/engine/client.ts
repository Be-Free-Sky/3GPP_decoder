import type { Report, SplitMode } from "./types";
import workerSource from "./worker.js?raw";

export type EngineStage = "idle" | "runtime" | "engine" | "init" | "module" | "ready" | "error";

export interface EngineState {
  stage: EngineStage;
  label: string;
  /** 0..1 when known (the embedded build reports stages only) */
  progress: number | null;
  error?: string;
  info?: { engine?: string; python?: string; pyodide?: string; built?: string };
}

type Pending = { resolve: (r: Report) => void; reject: (e: Error) => void };
type Asset = { data: string; gz: boolean };

/** The decoder data embedded in index.html as <script type="application/octet-stream" data-asset> blocks. */
function readEmbeddedAssets(): Record<string, Asset> {
  const out: Record<string, Asset> = {};
  document.querySelectorAll<HTMLScriptElement>("script[data-asset]").forEach((s) => {
    out[s.dataset.asset!] = { data: (s.textContent ?? "").trim(), gz: s.dataset.gz === "1" };
  });
  return out;
}

class EngineClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private listeners = new Set<() => void>();
  state: EngineState = { stage: "idle", label: "Decoder not started", progress: null };

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getState = () => this.state;

  private set(next: Partial<EngineState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((fn) => fn());
  }

  /** Start the worker and the Python runtime in the background. */
  boot() {
    if (this.worker || typeof window === "undefined" || this.state.stage === "error") return;
    const assets = readEmbeddedAssets();
    if (!assets["engine-core"]) {
      this.set({
        stage: "error",
        label: "Decoder data missing",
        error: "This page was built without the decoder data. Run npm run build to produce the full index.html.",
      });
      return;
    }
    this.set({ stage: "runtime", label: "Starting decoder", progress: null });
    // A classic worker from a Blob: the only kind a page opened from disk may start.
    const worker = new Worker(URL.createObjectURL(new Blob([workerSource], { type: "text/javascript" })));
    worker.onmessage = (e: MessageEvent) => this.onMessage(e.data);
    worker.onerror = (e) => this.set({ stage: "error", label: "Decoder failed to start", error: e.message });
    worker.postMessage({ type: "boot", assets });
    this.worker = worker;
    // the worker now holds the data; drop the base64 text from the page to save memory
    document.querySelectorAll("script[data-asset]").forEach((s) => s.remove());
  }

  private onMessage(msg: {
    type: string;
    id?: number;
    stage?: EngineStage;
    label?: string;
    data?: Report;
    error?: string;
    info?: EngineState["info"];
  }) {
    switch (msg.type) {
      case "progress":
        // unpacking a protocol block after start must not flip the status back to loading
        if (this.state.stage === "ready" && msg.stage !== "module") return;
        this.set({ stage: msg.stage ?? "runtime", label: msg.label ?? "", progress: null });
        break;
      case "ready":
        this.set({ stage: "ready", label: "Decoder ready", progress: null, info: msg.info });
        break;
      case "fatal":
        this.set({ stage: "error", label: "Decoder failed to start", error: msg.error, progress: null });
        this.pending.forEach((p) => p.reject(new Error(msg.error)));
        this.pending.clear();
        break;
      case "result":
      case "error": {
        const p = this.pending.get(msg.id!);
        this.pending.delete(msg.id!);
        if (this.state.stage === "module") this.set({ stage: "ready", label: "Decoder ready", progress: null });
        if (msg.type === "result") p?.resolve(msg.data!);
        else p?.reject(new Error(msg.error));
        break;
      }
    }
  }

  decode(text: string, protocol = "auto", split: SplitMode = "auto", overrides: Record<number, string> = {}): Promise<Report> {
    this.boot();
    if (!this.worker) return Promise.reject(new Error(this.state.error ?? "The decoder is not available."));
    const id = ++this.seq;
    return new Promise<Report>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, type: "decode", text, protocol, split, overrides });
    });
  }
}

export const engine = new EngineClient();
