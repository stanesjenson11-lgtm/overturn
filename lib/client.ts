"use client";

/**
 * Browser-side fetch. Notably absent: any base URL, any Authorization header,
 * any `credentials: "include"`. The API is the same origin, so the session
 * cookie rides along by default and there is nothing to configure.
 */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });

export type Doc = {
  id: string;
  filename: string;
  page_count: number | null;
  status: string;
  error: string | null;
  key_terms?: KeyTerm[] | null;
};

export type KeyTerm = { field: string; label: string; value: string; page: number };

export type Chat = { id: string; document_id: string | null; title: string | null };

export type Citation = {
  id: number;
  chunkId: string;
  heading: string | null;
  pageStart: number;
  pageEnd: number;
  text: string;
};

export type Msg = { id: string; role: string; content: string; citations: Citation[] | null };
