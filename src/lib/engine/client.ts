"use client";

import type { Report, SplitMode } from "./types";

export type EngineStage = "idle" | "runtime" | "engine" | "init" | "module" | "ready" | "error";

export interface EngineState {
  stage: EngineStage;
  label: string;
  /** 0..1 when a download size is known */
  progress: number | null;
  error?: string;
  info?: { engine: string; python: string; pyodide: string; built: string };
}

type Pending = { resolve: (r: Report) => void; reject: (e: Error) => void };

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

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

  /** Start the worker and load the Python runtime in the background. */
  boot() {
    if (this.worker || typeof window === "undefined") return;
    this.set({ stage: "runtime", label: "Starting decoder", progress: null });
    const worker = new Worker(`${BASE_PATH}/engine/worker.js`, { type: "module" });
    worker.onmessage = (e: MessageEvent) => this.onMessage(e.data);
    worker.onerror = (e) => this.set({ stage: "error", label: "Decoder failed to start", error: e.message });
    worker.postMessage({ type: "boot" });
    this.worker = worker;
  }

  private onMessage(msg: {
    type: string;
    id?: number;
    stage?: EngineStage;
    label?: string;
    loaded?: number;
    total?: number;
    data?: Report;
    error?: string;
    info?: EngineState["info"];
  }) {
    switch (msg.type) {
      case "progress":
        // module downloads after boot must not flip the engine back into a loading state
        if (this.state.stage === "ready" && msg.stage !== "module") return;
        this.set({
          stage: msg.stage ?? "runtime",
          label: msg.label ?? "",
          progress: msg.total ? Math.min(1, (msg.loaded ?? 0) / msg.total) : null,
        });
        break;
      case "ready":
        this.set({ stage: "ready", label: "Decoder ready", progress: null, info: msg.info });
        break;
      case "fatal":
        this.set({ stage: "error", label: "Decoder failed to start", error: msg.error, progress: null });
        break;
      case "result": {
        const p = this.pending.get(msg.id!);
        this.pending.delete(msg.id!);
        if (this.state.stage === "module") this.set({ stage: "ready", label: "Decoder ready", progress: null });
        p?.resolve(msg.data!);
        break;
      }
      case "error": {
        const p = this.pending.get(msg.id!);
        this.pending.delete(msg.id!);
        if (this.state.stage === "module") this.set({ stage: "ready", label: "Decoder ready", progress: null });
        p?.reject(new Error(msg.error));
        break;
      }
    }
  }

  decode(text: string, protocol = "auto", split: SplitMode = "auto", overrides: Record<number, string> = {}): Promise<Report> {
    this.boot();
    const id = ++this.seq;
    return new Promise<Report>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, type: "decode", text, protocol, split, overrides });
    });
  }
}

export const engine = new EngineClient();
