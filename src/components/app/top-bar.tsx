import { WaveformIcon } from "@phosphor-icons/react";
import { EngineStatus } from "./engine-status";
import { SamplesMenu } from "./samples-menu";

export function TopBar({ onSample, onHome }: { onSample: (text: string) => void; onHome: () => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-white/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-3 px-4 sm:px-6">
        <button
          onClick={onHome}
          className="press -ml-1.5 flex items-center gap-2.5 rounded-xl px-1.5 py-1 text-left transition-colors duration-150 hover:bg-brand-3/[0.07]"
          aria-label="Skyworth 3GPP Decoder, go to the home page"
        >
          <span className="brand-gradient grid size-8 place-items-center rounded-[10px] shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_6px_16px_-8px_rgb(2_69_122/0.8)]">
            <WaveformIcon weight="bold" className="size-4.5 text-white" />
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-semibold tracking-tight text-brand-1">
              Skyworth <span className="text-brand-gradient">3GPP Decoder</span>
            </span>
            <span className="hidden text-[11px] text-muted-foreground sm:block">LTE, 5G NR, NAS and core signalling, readable</span>
          </span>
        </button>
        <div className="ml-auto flex items-center gap-2">
          <EngineStatus className="hidden md:flex" />
          <SamplesMenu onPick={onSample} />
        </div>
      </div>
    </header>
  );
}
