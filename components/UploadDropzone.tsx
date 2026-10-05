"use client";

import { useRef, useState } from "react";
import { api, type Doc } from "@/lib/client";

export default function UploadDropzone({ onUploaded }: { onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      // FormData deliberately, not JSON: api() only sets content-type for
      // string bodies, so the browser writes the multipart boundary itself.
      const body = new FormData();
      body.append("file", file);
      await api<Doc>("/api/documents", { method: "POST", body });
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
        className={`w-full rounded-xl px-3 py-6 text-center text-sm transition ${
          over ? "bg-accent-soft text-accent shadow-neu-inset" : "text-muted shadow-neu-inset-sm hover:shadow-neu-inset"
        } disabled:opacity-60`}
      >
        {busy ? "Uploading…" : "Drop a lease PDF, or click to choose"}
      </button>

      <input
        ref={input}
        type="file"
        accept="application/pdf"
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
