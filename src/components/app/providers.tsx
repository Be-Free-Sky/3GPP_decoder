"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TooltipProvider delay={350}>
      {children}
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
