import { useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowCounterClockwiseIcon,
  FileArchiveIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  FoldersIcon,
  LightningIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { filesFromDrop, isCaptureSelection, sizeText, sourceFromFiles, splitLogs, type CaptureSource, type PickedFile } from "@/lib/capture";
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

const keyOf = (p: PickedFile) => `${p.path || p.file.webkitRelativePath || p.file.name}|${p.file.size}`;

type Staged =
  | { kind: "capture"; picked: PickedFile[]; folder?: string; source: CaptureSource; logs: { name: string; files: number; size: number }[] }
  | { kind: "text"; file: File };

const ghost =
  "press inline-flex h-10 items-center gap-2 rounded-[11px] border border-line-2 bg-white/70 px-4 text-[13.5px] font-semibold text-foreground transition-[background-color,border-color] duration-150 hover:border-line-3 hover:bg-hover-2";

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
  // the next pick adds to what is staged, rather than replacing it
  const adding = useRef(false);

  const stage = async (picked: PickedFile[], folder?: string) => {
    const add = adding.current;
    adding.current = false;
    if (!picked.length) return;
    const prev = add && staged?.kind === "capture" ? staged : null;
    const all = prev ? [...prev.picked, ...picked.filter((p) => !prev.picked.some((q) => keyOf(q) === keyOf(p)))] : picked;
    if (!prev && !isCaptureSelection(all) && !folder) {
      setStaged({ kind: "text", file: all[0].file });
      return;
    }
    setOpening(true);
    try {
      // one folder keeps its own name; several picks are named after what they hold
      const name = prev ? undefined : folder;
      const source = await sourceFromFiles(all, name);
      const logs = splitLogs(source).map((l) => ({ name: l.name, files: l.files.length, size: l.files.reduce((n, f) => n + f.size, 0) }));
      setStaged({ kind: "capture", picked: all, folder: name, source, logs });
      if (prev) toast.success(`Added ${picked.length} ${picked.length === 1 ? "file" : "files"}: ${logs.length} ${logs.length === 1 ? "log" : "logs"} ready.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };

  const pickFolder = (add = false) => {
    adding.current = add;
    folderRef.current?.click();
  };
  const pickFiles = (add = false) => {
    adding.current = add;
    fileRef.current?.click();
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

  const inputs = (
    <>
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
        id="folder-input"
        type="file"
        hidden
        multiple
        // @ts-expect-error: directory picking is a non-standard but widely supported attribute
        webkitdirectory=""
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (!files.length) {
            adding.current = false;
            toast.error("That folder is empty, or the browser was not allowed to read it.");
          } else
            stage(
              files.map((file) => ({ file, path: file.webkitRelativePath })),
              files[0]?.webkitRelativePath.split("/")[0],
            );
          e.target.value = "";
        }}
      />
    </>
  );

  const s = staged?.kind === "capture" ? staged.source : null;
  const logs = staged?.kind === "capture" ? staged.logs : [];
  const Icon = logs.length > 1 ? FoldersIcon : s ? (s.kind === "zip" ? FileArchiveIcon : s.kind === "folder" ? FolderOpenIcon : FileArchiveIcon) : FileTextIcon;
  const title = s ? s.name : staged?.kind === "text" ? staged.file.name : "";
  const total = s ? s.files.reduce((n, f) => n + f.size, 0) : 0;
  const sub = s
    ? `${logs.length > 1 ? `${logs.length} logs, ` : ""}${s.files.length} ${s.files.length === 1 ? "file" : "files"}, ${sizeText(total)}`
    : staged?.kind === "text"
      ? `Text export, ${sizeText(staged.file.size)}`
      : "";

  if (staged) {
    return (
      <motion.div
        initial={reduce ? false : { opacity: 0, transform: "translateY(4px)" }}
        animate={{ opacity: 1, transform: "translateY(0px)" }}
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }}
        className={cn(
          "flex min-h-[260px] flex-1 flex-col items-center justify-center gap-4 rounded-[18px] border border-line-2 bg-gradient-to-b from-hover to-transparent px-[18px] py-7 text-center",
          opening && "pointer-events-none opacity-70",
        )}
      >
        {inputs}
        <span className="grad grid size-[68px] place-items-center rounded-[20px] text-white shadow-[0_14px_34px_-10px_rgb(1_138_190/0.65)]">
          <Icon weight="bold" className="size-[30px]" />
        </span>
        <div className="min-w-0 max-w-full">
          <div className="truncate text-[20px] font-bold tracking-[-0.01em] text-foreground" title={title}>
            {opening ? "Opening" : title}
          </div>
          <div className="mt-1 text-[14.5px] text-ink-2">{sub}</div>
          {logs.length ? (
            <ul className="mx-auto mt-3 flex max-h-44 max-w-[56ch] flex-col gap-1 overflow-y-auto text-left scrollbar-thin" aria-label="Logs found">
              {logs.map((l) => (
                <li key={l.name} className="flex items-center gap-2 rounded-[9px] border border-border bg-panel px-2.5 py-1.5">
                  <FolderOpenIcon weight="bold" className="size-4 shrink-0 text-blue" />
                  <span className="min-w-0 flex-1 break-all font-mono text-[12.5px] font-semibold text-foreground">{l.name}</span>
                  <span className="shrink-0 font-mono text-[11.5px] text-muted-foreground">
                    {l.files} files, {sizeText(l.size)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {s ? (
            <p className="mx-auto mt-2 max-w-[48ch] text-[13.5px] leading-relaxed text-muted-foreground">
              {logs.length > 1
                ? "Each log is read on its own, every file in it, with its own result and a note of which ones have issues."
                : "Every file in it is read and searched; the list of files and what each held appears with the results."}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={analyse}
            disabled={busy || opening}
            className="btn-primary press inline-flex h-10 items-center gap-2 rounded-[11px] px-5 text-[14px] font-semibold disabled:cursor-progress disabled:opacity-70"
          >
            <LightningIcon weight="fill" className="size-[18px]" />
            {logs.length > 1 ? `Analyse ${logs.length} logs` : s ? "Analyse log" : "Decode"}
          </button>
          {s ? (
            <>
              <button onClick={() => pickFolder(true)} className={ghost}>
                <FolderPlusIcon weight="bold" className="size-4" />
                Add another folder
              </button>
              <button onClick={() => pickFiles(true)} className={ghost}>
                <FilePlusIcon weight="bold" className="size-4" />
                Add files
              </button>
            </>
          ) : null}
          <button onClick={() => setStaged(null)} className={ghost}>
            <ArrowCounterClockwiseIcon weight="bold" className="size-4" />
            Start again
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <>
      <div
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
          "flex min-h-[260px] flex-1 flex-col items-center justify-center gap-2.5 rounded-[18px] border-[1.5px] border-dashed border-line-3 bg-gradient-to-b from-hover to-transparent px-[18px] py-7 text-center transition-[border-color,box-shadow,background-color] duration-200",
          over && "border-blue bg-accent shadow-[0_0_0_5px_rgb(0_105_200/0.1)]",
          opening && "pointer-events-none opacity-70",
        )}
      >
        {inputs}
        <span className="grad mb-1.5 grid size-[68px] place-items-center rounded-[20px] text-white shadow-[0_14px_34px_-10px_rgb(1_138_190/0.65)]">
          <UploadSimpleIcon weight="bold" className="size-[30px]" />
        </span>
        <span className="text-[23px] font-bold tracking-[-0.01em] text-foreground">{opening ? "Opening" : "Drop Logel logs here"}</span>
        <span className="max-w-[46ch] text-[16px] text-ink-2">one or more _armlog folders, their zips or .logel files</span>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button onClick={() => pickFolder()} className="btn-primary press inline-flex h-10 items-center gap-2 rounded-[11px] px-5 text-[14px] font-semibold">
            <FolderOpenIcon weight="bold" className="size-[18px]" />
            Choose a folder
          </button>
          <button onClick={() => pickFiles()} className={ghost}>
            <FileArchiveIcon weight="bold" className="size-[18px]" />
            Choose files or a zip
          </button>
        </div>
      </div>
      <div className="mx-1.5 mb-1.5 mt-3 flex flex-wrap items-center justify-center gap-1.5 text-[13.5px] text-muted-foreground">
        <span>Reads</span>
        {["_armlog folders", ".zip", ".logel", ".ass", ".mem", ".cap", ".txt"].map((f) => (
          <span key={f} className="rounded-md border border-border bg-panel px-1.5 py-px font-mono text-[12.5px] text-ink-2">
            {f}
          </span>
        ))}
        <span>and every other file in a log.</span>
        <span className="basis-full text-center">
          The folder picker takes one folder at a time: use Add another folder for more, or drop several at once. Read here, on this computer.
        </span>
      </div>
    </>
  );
}
