import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowCounterClockwiseIcon, FileArchiveIcon, FileTextIcon, FolderOpenIcon, LightningIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { filesFromDrop, isCaptureSelection, sizeText, sourceFromFiles, type CaptureSource, type PickedFile } from "@/lib/capture";
import { cn } from "@/lib/utils";

const MAX_TEXT = 25 * 1024 * 1024;

/** Looks like a binary file rather than a text export. */
function isBinary(text: string) {
  const head = text.slice(0, 4096);
  if (!head) return false;
  let odd = 0;
  for (let i = 0; i < head.length; i++) {
    const c = head.charCodeAt(i);
    if (c === 0xfffd || c < 9 || (c > 13 && c < 32)) odd++;
  }
  return odd / head.length > 0.02;
}

type Staged = { kind: "capture"; source: CaptureSource } | { kind: "text"; file: File };

export function UploadPane({
  onText,
  onCapture,
  busy,
}: {
  onText: (name: string, text: string) => void;
  onCapture: (source: CaptureSource) => void;
  busy: boolean;
}) {
  const reduce = useReducedMotion();
  const [over, setOver] = useState(false);
  const [staged, setStaged] = useState<Staged | null>(null);
  const [opening, setOpening] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  const stage = async (picked: PickedFile[], folder?: string) => {
    if (!picked.length) return;
    if (!isCaptureSelection(picked) && !folder) {
      setStaged({ kind: "text", file: picked[0].file });
      return;
    }
    setOpening(true);
    try {
      setStaged({ kind: "capture", source: await sourceFromFiles(picked, folder) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };

  const analyse = async () => {
    if (!staged) return;
    if (staged.kind === "capture") {
      onCapture(staged.source);
      return;
    }
    const file = staged.file;
    if (file.size > MAX_TEXT) {
      toast.error(`${file.name} is ${sizeText(file.size)}. A text export can be up to 25 MB; for a full log, open the .logel or the zip.`);
      return;
    }
    const text = await file.text();
    if (isBinary(text)) {
      toast.error("This is not a text export. Open the Logel log folder, its zip, or the .logel file.");
      return;
    }
    if (!/[0-9a-fA-F]{2}/.test(text)) {
      toast.error(`No hex found in ${file.name}.`);
      return;
    }
    onText(file.name, text);
  };

  const s = staged?.kind === "capture" ? staged.source : null;
  const Icon = s ? (s.kind === "zip" ? FileArchiveIcon : s.kind === "folder" ? FolderOpenIcon : FileArchiveIcon) : FileTextIcon;
  const title = s ? s.name : staged?.kind === "text" ? staged.file.name : "";
  const sub = s
    ? `${s.kind === "zip" ? "Zip" : s.kind === "folder" ? "Folder" : "Selection"} with ${s.files.length} ${s.files.length === 1 ? "file" : "files"}, ${sizeText(
        s.kind === "zip" ? s.files.reduce((n, f) => n + f.size, 0) : s.size,
      )}`
    : staged?.kind === "text"
      ? `Text export, ${sizeText(staged.file.size)}`
      : "";

  if (staged) {
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, transform: "translateY(4px)" }}
        animate={{ opacity: 1, transform: "translateY(0px)" }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        className="flex min-h-[260px] flex-1 flex-col items-center justify-center gap-4 rounded-[18px] border border-line-2 bg-gradient-to-b from-hover to-transparent px-[18px] py-7 text-center"
      >
        <span className="grad grid size-[68px] place-items-center rounded-[20px] text-white shadow-[0_14px_34px_-10px_rgb(1_138_190/0.65)]">
          <Icon weight="bold" className="size-[30px]" />
        </span>
        <div className="min-w-0 max-w-full">
          <div className="truncate text-[20px] font-bold tracking-[-0.01em] text-foreground" title={title}>
            {title}
          </div>
          <div className="mt-1 text-[14.5px] text-ink-2">{sub}</div>
          {s ? (
            <p className="mx-auto mt-2 max-w-[44ch] text-[13.5px] leading-relaxed text-muted-foreground">
              The files that help troubleshooting are picked out and read; the list appears with the results.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={analyse}
            disabled={busy}
            className="btn-primary press inline-flex h-10 items-center gap-2 rounded-[11px] px-5 text-[14px] font-semibold disabled:cursor-progress disabled:opacity-70"
          >
            <LightningIcon weight="fill" className="size-[18px]" />
            {s ? "Analyse log" : "Decode"}
          </button>
          <button
            onClick={() => setStaged(null)}
            className="press inline-flex h-10 items-center gap-2 rounded-[11px] border border-line-2 bg-white/70 px-4 text-[13.5px] font-semibold text-foreground transition-[background-color,border-color] duration-150 hover:border-line-3 hover:bg-hover-2"
          >
            <ArrowCounterClockwiseIcon weight="bold" className="size-4" />
            Choose another
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <>
      <label
        htmlFor="file-input"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          filesFromDrop(e.dataTransfer)
            .then(({ picked, folder }) => stage(picked, folder))
            .catch((err) => toast.error(String(err)));
        }}
        className={cn(
          "flex min-h-[260px] flex-1 cursor-pointer flex-col items-center justify-center gap-2.5 rounded-[18px] border-[1.5px] border-dashed border-line-3 bg-gradient-to-b from-hover to-transparent px-[18px] py-7 text-center transition-[border-color,box-shadow,background-color] duration-200 hover:border-blue hover:bg-accent hover:shadow-[0_0_0_5px_rgb(0_105_200/0.1)]",
          over && "border-blue bg-accent shadow-[0_0_0_5px_rgb(0_105_200/0.1)]",
          opening && "pointer-events-none opacity-70",
        )}
      >
        <span className="grad mb-1.5 grid size-[68px] place-items-center rounded-[20px] text-white shadow-[0_14px_34px_-10px_rgb(1_138_190/0.65)]">
          <UploadSimpleIcon weight="bold" className="size-[30px]" />
        </span>
        <span className="text-[23px] font-bold tracking-[-0.01em] text-foreground">{opening ? "Opening" : "Drop a Logel log here"}</span>
        <span className="text-[16px] text-ink-2">
          the armlog folder, its zip or the .logel, or{" "}
          <u className="font-semibold text-link underline-offset-[3px]">browse files</u>
        </span>
        <input
          ref={fileRef}
          id="file-input"
          type="file"
          multiple
          hidden
          onChange={(e) => {
            stage(Array.from(e.target.files ?? []).map((file) => ({ file })));
            e.target.value = "";
          }}
        />
        <input
          ref={folderRef}
          type="file"
          hidden
          multiple
          // @ts-expect-error: directory picking is a non-standard but widely supported attribute
          webkitdirectory=""
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            stage(
              files.map((file) => ({ file, path: file.webkitRelativePath })),
              files[0]?.webkitRelativePath.split("/")[0],
            );
            e.target.value = "";
          }}
        />
      </label>
      <div className="mx-1.5 mb-1.5 mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[13.5px] text-muted-foreground">
        <span>Reads</span>
        {[".zip", ".logel", ".cap", ".txt"].map((f) => (
          <span key={f} className="rounded-md border border-border bg-panel px-1.5 py-px font-mono text-[12.5px] text-ink-2">
            {f}
          </span>
        ))}
        <span>or</span>
        <button
          type="button"
          onClick={() => folderRef.current?.click()}
          className="rounded-md px-1 font-semibold text-link underline underline-offset-[3px] hover:no-underline"
        >
          choose a whole folder
        </button>
        <span className="basis-full text-center">Unzipped here, on this computer. Only the files that help troubleshooting are read.</span>
      </div>
    </>
  );
}
