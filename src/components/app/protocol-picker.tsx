"use client";

import { useState } from "react";
import { CaretUpDownIcon, CheckIcon, MagicWandIcon } from "@phosphor-icons/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import catalogData from "@/data/catalog.json";
import type { Catalog } from "@/lib/engine/types";
import { cn } from "@/lib/utils";

const catalog = catalogData as Catalog;

export function protocolLabel(id: string) {
  if (id === "auto") return "Auto-detect";
  return catalog.protocols.find((p) => p.id === id)?.label ?? id;
}

export function ProtocolPicker({
  value,
  onChange,
  className,
  id,
}: {
  value: string;
  onChange: (id: string) => void;
  className?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const choose = (v: string) => {
    onChange(v);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            size="lg"
            className={cn("w-full justify-between bg-raised font-normal", className)}
            aria-label="Protocol and channel"
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          {value === "auto" ? <MagicWandIcon className="size-4 text-brand-3" /> : null}
          <span className="truncate">{protocolLabel(value)}</span>
        </span>
        <CaretUpDownIcon className="size-4 text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(92vw,380px)] p-0">
        <Command>
          <CommandInput placeholder="Search protocol or channel" />
          <CommandList className="max-h-[360px]">
            <CommandEmpty>No protocol matches.</CommandEmpty>
            <CommandGroup heading="Recommended">
              <CommandItem value="auto auto-detect detect" onSelect={() => choose("auto")}>
                <MagicWandIcon className="text-brand-3" />
                <span className="flex-1">
                  Auto-detect
                  <span className="block text-xs text-muted-foreground">Uses Logel headers, then verifies by re-encoding</span>
                </span>
                {value === "auto" ? <CheckIcon className="text-brand-3" /> : null}
              </CommandItem>
            </CommandGroup>
            {catalog.groups.map((g) => {
              const items = catalog.protocols.filter((p) => p.group === g);
              if (!items.length) return null;
              return (
                <CommandGroup key={g} heading={g}>
                  {items.map((p) => (
                    <CommandItem key={p.id} value={`${p.label} ${p.id}`} onSelect={() => choose(p.id)}>
                      <span className="flex-1 truncate">{p.label}</span>
                      {p.direction ? (
                        <span className="text-[11px] tabular-nums text-muted-foreground">{p.direction}</span>
                      ) : null}
                      {value === p.id ? <CheckIcon className="text-brand-3" /> : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
