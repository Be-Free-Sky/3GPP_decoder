"use client";

import { useState } from "react";
import { BookOpenIcon, FlowArrowIcon, HashIcon } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import samples from "@/data/samples.json";

type Single = { id: string; title: string; group: string; hex: string };
type SessionSample = { id: string; title: string; description: string; text: string };

const SINGLE = samples.single as Single[];
const SESSIONS = samples.sessions as SessionSample[];
const GROUPS = Array.from(new Set(SINGLE.map((s) => s.group)));

export function SamplesMenu({ onPick }: { onPick: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const pick = (text: string) => {
    onPick(text);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="lg" className="gap-2 bg-raised" />}>
        <BookOpenIcon className="size-4" />
        <span>Samples</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,560px)] gap-0 p-0">
        <div className="max-h-[70vh] overflow-y-auto scrollbar-thin p-1.5">
          <div className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">Log sessions</div>
          {SESSIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => pick(s.text)}
              className="flex w-full items-start gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
            >
              <FlowArrowIcon className="mt-0.5 size-4 shrink-0 text-brand-3" />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{s.title}</span>
                <span className="block text-xs text-muted-foreground">{s.description}</span>
              </span>
            </button>
          ))}
          {GROUPS.map((g) => (
            <div key={g}>
              <div className="mt-1 border-t border-hairline px-2.5 pb-1 pt-2.5 text-xs font-medium text-muted-foreground">{g}</div>
              <div className="grid gap-0.5 sm:grid-cols-2">
                {SINGLE.filter((s) => s.group === g).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => pick(s.hex)}
                    className="flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-foreground transition-colors duration-150 hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  >
                    <HashIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                    {s.title}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
