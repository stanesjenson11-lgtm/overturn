"use client";

import { useRef, useState } from "react";
import { api, type Doc, type DocKind } from "@/lib/client";

/** What the file pickers offer: a PDF, or a photo of the document. */
export const ACCEPT = "application/pdf,image/*";

/**
 * A phone photo is often 3–8 MB, over what Vercel accepts (4.5 MB) before the
 * app even sees it. So photos are redrawn in the browser at most 2000px on
 * the long side and re-encoded as JPEG: a few hundred KB, still sharp enough
 * to read. Re-encoding also turns an iPhone's HEIC into a JPEG wherever the
 * browser can decode it, so the server only ever sees a PDF, a JPEG or a PNG.
 */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("This browser can't read that photo. Try a JPG or PNG.");
  }
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
  if (!blob) throw new Error("That photo couldn't be prepared. Try a JPG or PNG.");
  return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
}

/** The one upload path, for the slots and the "+" menu alike. */
export async function uploadDocument(caseId: string, kind: DocKind, file: File): Promise<Doc> {
  // FormData deliberately, not JSON: api() only sets content-type for string
  // bodies, so the browser writes the multipart boundary itself.
  const body = new FormData();
  body.append("file", await shrink(file));
  body.append("caseId", caseId);
  body.append("kind", kind);
  return api<Doc>("/api/documents", { method: "POST", body });
}

export function PlusIcon({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export default function UploadDropzone({
  caseId,
  kind,
  prompt,
  onUploaded,
}: {
  caseId: string;
  kind: DocKind;
  prompt: string;
  onUploaded: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await uploadDocument(caseId, kind, file);
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload(e.dataTransfer.files[0]);
        }}
        disabled={busy}
        className={`flex w-full flex-col items-center gap-1.5 rounded-xl px-3 py-4 text-center text-sm transition ${
          over ? "bg-accent-soft text-accent shadow-neu-inset" : "text-muted shadow-neu-inset-sm hover:shadow-neu-inset"
        } disabled:opacity-60`}
      >
        <span className="flex size-7 items-center justify-center rounded-full text-accent shadow-neu-sm">
          <PlusIcon className="size-3.5" />
        </span>
        <span>{busy ? "Uploading…" : prompt}</span>
        <span className="text-xs opacity-80">PDF or photo</span>
      </button>

      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => void upload(e.target.files?.[0])}
      />

      {error && (
        <p role="alert" className="mt-2 text-xs text-accent">
          {error}
        </p>
      )}
    </div>
  );
}
