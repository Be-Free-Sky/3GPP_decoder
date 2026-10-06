import { WaveformIcon } from "@phosphor-icons/react";
import { EngineStatus } from "./engine-status";
import { SamplesMenu } from "./samples-menu";

export function TopBar({ onSample }: { onSample: (text: string) => void }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/75 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-[1680px] items-center gap-3 px-4">
        <div className="flex items-center gap-2.5">
          <span className="brand-gradient grid size-8 place-items-center rounded-[10px] shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_6px_16px_-8px_rgb(2_69_122/0.8)]">
            <WaveformIcon weight="bold" className="size-4.5 text-white" />
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight text-foreground">Skyworth 3GPP Decoder</div>
            <div className="hidden text-[11px] text-muted-foreground sm:block">LTE, 5G NR, NAS and core signalling, readable</div>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <EngineStatus className="hidden md:flex" />
          <SamplesMenu onPick={onSample} />
        </div>
      </div>
    </header>
  );
}
