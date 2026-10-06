import { useMemo, useRef } from "react";
import { CircleNotchIcon, LightningIcon, TrashIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ProtocolPicker } from "./protocol-picker";
import type { SplitMode } from "@/lib/engine/types";
import { cn } from "@/lib/utils";

const SPLITS: { value: SplitMode; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Headers, blank lines or one message per line" },
  { value: "lines", label: "Per line", hint: "Every line is one message" },
  { value: "single", label: "One message", hint: "Join everything into one message" },
];

export interface InputProps {
  text: string;
  setText: (t: string) => void;
  protocol: string;
  setProtocol: (p: string) => void;
  split: SplitMode;
  setSplit: (s: SplitMode) => void;
  onDecode: () => void;
  decoding: boolean;
  engineReady: boolean;
}

/** The paste pane of the home card. */
export function InputPanel({ text, setText, protocol, setProtocol, split, setSplit, onDecode, decoding, engineReady }: InputProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const stats = useMemo(() => {
    const lines = text ? text.split(/\r?\n/).filter((l) => l.trim()).length : 0;
    const hexChars = (text.match(/[0-9a-fA-F]/g) || []).length;
    return { lines, bytes: Math.floor(hexChars / 2) };
  }, [text]);

  const decode = () => {
    if (!text.trim()) {
      areaRef.current?.focus();
      toast.info("Paste hex or Logel log lines first, or open an example.");
      return;
    }
    onDecode();
  };

  return (
    <section aria-label="Paste hex" className="flex flex-col gap-3 px-2 pb-2">
      <label htmlFor="hex-input" className="sr-only">
        Hex or Logel log text
      </label>
      <div className="relative">
        <textarea
          id="hex-input"
          ref={areaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              decode();
            }
          }}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-describedby="hex-help"
          className="block h-56 min-h-36 w-full resize-y rounded-2xl border border-line-2 bg-panel py-3.5 pl-4 pr-11 font-mono text-[13px] leading-relaxed text-foreground shadow-[inset_0_1px_2px_rgb(11_27_52/0.05)] outline-none transition-[border-color,box-shadow] duration-150 focus-visible:border-blue focus-visible:shadow-[0_0_0_4px_rgb(0_105_200/0.12)] focus-visible:outline-none"
        />
        {text ? (
          <button
            onClick={() => {
              setText("");
              areaRef.current?.focus();
            }}
            className="absolute right-2.5 top-2.5 grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
            aria-label="Clear the text"
          >
            <TrashIcon className="size-4" />
          </button>
        ) : null}
      </div>
      <p id="hex-help" className="text-[13px] leading-relaxed text-muted-foreground">
        Paste raw hex, a hexdump, or Logel lines with a timestamp and channel name. Each header line or block becomes one message.
      </p>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-1.5">
          <label htmlFor="protocol-picker" className="text-[12.5px] font-semibold text-ink-2">
            Protocol and channel
          </label>
          <ProtocolPicker id="protocol-picker" value={protocol} onChange={setProtocol} />
        </div>
        <div className="grid gap-1.5">
          <span id="split-label" className="text-[12.5px] font-semibold text-ink-2">
            Message boundaries
          </span>
          <div role="radiogroup" aria-labelledby="split-label" className="flex h-9 gap-1 rounded-[11px] border border-border bg-sunken p-[3px]">
            {SPLITS.map((s) => (
              <button
                key={s.value}
                role="radio"
                aria-checked={split === s.value}
                title={s.hint}
                onClick={() => setSplit(s.value)}
                className={cn(
                  "press flex-1 whitespace-nowrap rounded-[8px] px-2.5 text-[12.5px] font-semibold transition-[background-color,color,box-shadow] duration-150",
                  split === s.value ? "bg-panel text-foreground shadow-[0_1px_3px_rgb(0_27_72/0.12),inset_0_0_0_1px_rgb(11_27_52/0.13)]" : "text-ink-2 hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] tabular-nums text-muted-foreground">
          {stats.lines ? `${stats.lines} ${stats.lines === 1 ? "line" : "lines"}, about ${stats.bytes} bytes` : "Ctrl + Enter to decode"}
        </span>
        <button
          onClick={decode}
          disabled={decoding}
          className="btn-primary press inline-flex h-10 items-center gap-2 rounded-[11px] px-5 text-[14px] font-semibold disabled:cursor-progress disabled:opacity-70"
        >
          {decoding ? <CircleNotchIcon className="size-[18px] animate-spin motion-reduce:animate-none" /> : <LightningIcon weight="fill" className="size-[18px]" />}
          {decoding ? (engineReady ? "Decoding" : "Starting decoder") : "Decode"}
        </button>
      </div>
    </section>
  );
}
