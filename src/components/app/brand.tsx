import { useId } from "react";
import { LockSimpleIcon } from "@phosphor-icons/react";
import { SKYWORTH_LOGO_SVG } from "./skyworth-logo";
import { cn } from "@/lib/utils";

export const APP_VERSION = "1.0.0";

/** SKYWORTH 创维 wordmark (keeps its 1800:162 proportions; set the height). */
export function SkyworthLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1800 162"
      role="img"
      aria-label="SKYWORTH"
      className={cn("block shrink-0", className)}
      dangerouslySetInnerHTML={{ __html: SKYWORTH_LOGO_SVG }}
    />
  );
}

/** The 3GPP Decoder mark: four signal bars in the brand gradient, the tallest in mist. */
export function DecoderMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("block shrink-0", className)}>
      <defs>
        <linearGradient id={`g-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#001b48" />
          <stop offset=".5" stopColor="#02457a" />
          <stop offset="1" stopColor="#018abe" />
        </linearGradient>
      </defs>
      <rect x="2" y="19" width="5.5" height="10" rx="1.6" fill={`url(#g-${id})`} />
      <rect x="9.5" y="13" width="5.5" height="16" rx="1.6" fill={`url(#g-${id})`} />
      <rect x="17" y="7" width="5.5" height="22" rx="1.6" fill={`url(#g-${id})`} />
      <rect x="24.5" y="2" width="5.5" height="27" rx="1.6" fill="#018abe" />
      <rect x="24.5" y="2" width="5.5" height="27" rx="1.6" fill="#97cadb" opacity=".55" />
    </svg>
  );
}

/** Logo, rule, mark and product name, as in Skyworth Log Prism. */
export function BrandLockup({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <SkyworthLogo className={size === "sm" ? "h-[15px] w-[167px]" : "h-[18px] w-[200px]"} />
      <span aria-hidden className={cn("w-px bg-line-3", size === "sm" ? "h-6" : "h-[26px]")} />
      <DecoderMark className={size === "sm" ? "size-[22px]" : "size-6"} />
      <span className={cn("font-extrabold tracking-[-0.02em] text-foreground", size === "sm" ? "text-[18px]" : "text-[19px]")}>
        3GPP Decoder
      </span>
    </span>
  );
}

/** Footer: brand, privacy note, copyright and version, as in Skyworth Log Prism.
 *  `big` is the home page footer; the default closes the summary. */
export function SiteFooter({ className, big = false }: { className?: string; big?: boolean }) {
  return (
    <footer
      className={cn(
        "glass grid grid-cols-1 items-center gap-x-12 gap-y-3 rounded-[20px] px-5 py-5 text-ink-2 sm:grid-cols-[auto_minmax(0,1fr)] sm:[grid-template-areas:'brand_copy'_'note_copy']",
        big ? "text-[13.5px] sm:px-[clamp(20px,2.6vw,36px)] sm:text-[15px]" : "text-[12.5px] sm:px-7",
        className,
      )}
    >
      <span className={cn("inline-flex items-center gap-2.5 sm:[grid-area:brand]", big && "sm:gap-3.5")}>
        <SkyworthLogo className={cn("h-[13px] w-[145px]", big && "sm:h-5 sm:w-[222px]")} />
        <span aria-hidden className={cn("h-5 w-px bg-line-3", big && "sm:h-7")} />
        <DecoderMark className={cn("size-[18px]", big && "sm:size-[26px]")} />
        <b className={cn("whitespace-nowrap text-[15px] font-extrabold tracking-[-0.02em] text-foreground", big && "sm:text-[23px]")}>3GPP Decoder</b>
      </span>
      <div className="leading-relaxed sm:text-right sm:[grid-area:copy]">
        <div>
          Copyright © 2026 <b className="whitespace-nowrap text-foreground">Rahul Kumbhar</b>. All rights reserved.
        </div>
        <div className="text-balance text-muted-foreground">
          Skyworth 3GPP Decoder™ by Rahul Kumbhar. SKYWORTH, 创维 and the SKYWORTH logo are trademarks of Skyworth Group. Decodes with
          pycrate (LGPL 2.1) on Pyodide (MPL 2.0).
        </div>
        <div className="text-muted-foreground">
          Version <b className="text-foreground">{APP_VERSION}</b>
        </div>
      </div>
      <span className="flex max-w-[420px] items-start gap-2 text-muted-foreground sm:[grid-area:note]">
        <LockSimpleIcon weight="bold" className={cn("mt-[3px] shrink-0 text-ok-ink", big ? "size-4" : "size-[14px]")} />
        A single offline page: your log never leaves this browser.
      </span>
    </footer>
  );
}
