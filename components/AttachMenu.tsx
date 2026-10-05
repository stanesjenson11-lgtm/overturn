"use client";

import { useRef, useState } from "react";
import { api, type Doc } from "@/lib/client";

// Mirrors lib/ingest/pdf.ts (MAX_PHOTOS, and MAX_BYTES on Vercel), checked here
// too so a too-big upload is refused before it's sent rather than by Vercel's
// opaque 413. The server still enforces both.
const MAX_PHOTOS = 10;
const MAX_UPLOAD = 4 * 1024 * 1024;

/**
 * A phone photo is often 3–8 MB, over what Vercel accepts (4.5 MB) before the
 * app even sees it. So photos are redrawn in the browser at most 1800px on
 * the long side and re-encoded as JPEG: a few hundred KB, still sharp enough
 * to read, and ten of them fit in one upload. Re-encoding also turns an
 * iPhone's HEIC into a JPEG wherever the browser can decode it, so the server
 * only ever sees a PDF, a JPEG or a PNG.
 */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`This browser can't read ${file.name}. Try a JPG or PNG.`);
  }
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
  if (!blob) throw new Error("That photo couldn't be prepared. Try a JPG or PNG.");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
}

/**
 * The one upload path: a PDF, or photos of one document in page order. The
 * server reads it and works out whether it's the policy, the letter or a
 * medical document.
 */
export async function uploadFiles(caseId: string, picked: File[]): Promise<Doc> {
  const pdfs = picked.filter((f) => f.type === "application/pdf");
  if (pdfs.length && picked.length > 1) throw new Error("Upload one PDF at a time, or several photos together.");
  if (picked.length > MAX_PHOTOS) throw new Error(`Up to ${MAX_PHOTOS} photos at a time: one per page.`);

  const files = await Promise.all(picked.map(shrink));
  if (files.reduce((n, f) => n + f.size, 0) > MAX_UPLOAD)
    throw new Error("That's over 4 MB. Try fewer photos, or a smaller PDF.");

  // FormData deliberately, not JSON: api() only sets content-type for string
  // bodies, so the browser writes the multipart boundary itself.
  const body = new FormData();
  for (const f of files) body.append("file", f);
  body.append("caseId", caseId);
  return api<Doc>("/api/documents", { method: "POST", body });
}

export function PlusIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** The "+" beside the message box: a PDF, or photos. Nothing to classify by hand. */
export default function AttachMenu({
  busy,
  full,
  onFiles,
}: {
  busy: boolean;
  full: boolean;
  onFiles: (files: File[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const pdf = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);

  const picked = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = ""; // the same file can be picked again
    if (files.length) onFiles(files);
  };

  const item = (label: string, hint: string, input: React.RefObject<HTMLInputElement | null>) => (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          setOpen(false);
          input.current?.click();
        }}
        className="w-full rounded-xl px-3 py-2 text-left text-sm transition hover:shadow-neu-sm"
      >
        {label}
        <span className="block text-xs text-muted">{hint}</span>
      </button>
    </li>
  );

  return (
    <div
      className="relative"
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label="Add a document"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy || full}
        title={full ? "This case has all three documents" : "Add a PDF or photos"}
        onClick={() => setOpen((o) => !o)}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-accent shadow-neu-sm transition hover:shadow-neu active:shadow-neu-inset-sm disabled:opacity-40"
      >
        {busy ? <span className="size-2 animate-pulse rounded-full bg-accent" /> : <PlusIcon />}
      </button>

      {open && (
        <ul role="menu" className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-2xl bg-paper p-2 shadow-neu">
          {item("Upload PDF", "Policy wording, rejection letter or discharge summary", pdf)}
          {item("Upload photos", `One per page, up to ${MAX_PHOTOS}`, photos)}
        </ul>
      )}

      <input ref={pdf} type="file" accept="application/pdf" className="hidden" onChange={(e) => picked(e.target)} />
      <input
        ref={photos}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => picked(e.target)}
      />
    </div>
  );
}
