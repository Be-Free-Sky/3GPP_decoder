import { useMemo, useRef } from "react";
import { toast } from "sonner";
import { CircleNotchIcon, LightningIcon, TrashIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { ProtocolPicker } from "./protocol-picker";
import type { SplitMode } from "@/lib/engine/types";
import { cn } from "@/lib/utils";

const SPLITS: { value: SplitMode; label: string; hint: string }[] = [
  { value: "auto", label: "Auto", hint: "Headers, blank lines or one message per line" },
  { value: "lines", label: "Per line", hint: "Every line is one message" },
  { value: "single", label: "One message", hint: "Join everything into one message" },
];

export function InputPanel({
  text,
  setText,
  protocol,
  setProtocol,
  split,
  setSplit,
  onDecode,
  decoding,
  engineReady,
  compact,
  variant = "panel",
}: {
  text: string;
  setText: (t: string) => void;
  protocol: string;
  setProtocol: (p: string) => void;
  split: SplitMode;
  setSplit: (s: SplitMode) => void;
  onDecode: () => void;
  decoding: boolean;
  engineReady: boolean;
  /** shrink the editor once results are on screen, so the message list gets the room */
  compact?: boolean;
  /** "hero": the home page card, with the options side by side */
  variant?: "panel" | "hero";
}) {
  const hero = variant === "hero";
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const decode = () => {
    if (!text.trim()) {
      areaRef.current?.focus();
      toast.info("Paste hex or Logel log lines first, or open an example.");
      return;
    }
    onDecode();
  };
  const stats = useMemo(() => {
    const lines = text ? text.split(/\r?\n/).filter((l) => l.trim()).length : 0;
    const hexChars = (text.match(/[0-9a-fA-F]/g) || []).length;
    return { lines, bytes: Math.floor(hexChars / 2) };
  }, [text]);

  return (
    <section aria-labelledby="input-heading" className={cn("flex flex-col gap-3", hero ? "p-5 sm:p-6" : "p-4")}>
      <div className="flex items-baseline justify-between gap-2">
        <label id="input-heading" htmlFor="hex-input" className={cn("font-semibold text-foreground", hero ? "text-[15px]" : "text-sm")}>
          Hex or Logel log text
        </label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {stats.lines} {stats.lines === 1 ? "line" : "lines"}, ~{stats.bytes} bytes
        </span>
      </div>
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
          placeholder={"10:21:33.104  LTE RRC UL_CCCH RRCConnectionRequest\n45 A2 B3 C4 D5 E6 ..."}
          className={cn(
            "block min-h-28 w-full resize-y rounded-xl border border-input bg-raised py-3 pl-3.5 pr-10 font-mono text-[12.5px] leading-relaxed text-foreground shadow-[inset_0_1px_2px_rgb(0_27_72/0.06)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 focus-visible:border-brand-3 focus-visible:ring-3 focus-visible:ring-brand-3/20",
            compact ? "h-36" : hero ? "h-44" : "h-56 lg:h-64",
          )}
        />
        {text ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setText("")}
            className="absolute right-2 top-2 text-muted-foreground"
            aria-label="Clear input"
          >
            <TrashIcon />
          </Button>
        ) : null}
      </div>
      <p id="hex-help" className="text-xs leading-relaxed text-muted-foreground">
        Paste raw hex, a hexdump, or Logel lines with timestamps and channel names. Each header line or block becomes one message.
      </p>

      <div className={cn("grid gap-3", hero && "sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]")}>
      <div className="grid gap-2">
        <label htmlFor="protocol-picker" className="text-xs font-medium text-muted-foreground">
          Protocol and channel
        </label>
        <ProtocolPicker id="protocol-picker" value={protocol} onChange={setProtocol} />
      </div>

      <div className="grid gap-2">
        <span id="split-label" className="text-xs font-medium text-muted-foreground">
          Message boundaries
        </span>
        <div role="radiogroup" aria-labelledby="split-label" className="grid grid-cols-3 gap-1 rounded-[10px] bg-muted p-1">
          {SPLITS.map((s) => (
            <button
              key={s.value}
              role="radio"
              aria-checked={split === s.value}
              title={s.hint}
              onClick={() => setSplit(s.value)}
              className={cn(
                "press h-8 whitespace-nowrap rounded-md px-1.5 text-xs font-medium transition-[background-color,color,box-shadow] duration-150",
                split === s.value
                  ? "bg-white text-brand-2 shadow-[0_1px_3px_rgb(0_27_72/0.14)] ring-1 ring-brand-3/30"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
      </div>

      <Button variant="brand" size="lg" className={cn("mt-1 w-full gap-2", hero ? "h-11 text-[15px]" : "h-10 text-[14px]")} onClick={decode} disabled={decoding}>
        {decoding ? <CircleNotchIcon className="animate-spin motion-reduce:animate-none" /> : <LightningIcon weight="fill" />}
        {decoding ? (engineReady ? "Decoding" : "Starting decoder") : "Decode"}
        {!decoding ? (
          <Kbd className="ml-1 border-white/25 bg-white/15 text-white">Ctrl ↵</Kbd>
        ) : null}
      </Button>
    </section>
  );
}
