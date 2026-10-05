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
    // The status rides along, so a form can offer the right next step (no
    // account: sign up; already registered: sign in) without parsing words.
    throw Object.assign(new Error(body.error ?? `Request failed (${res.status})`), {
      status: res.status,
    });
  }
  return res.json() as Promise<T>;
}

export const post = <T>(path: string, body: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });

export type DocKind = "policy" | "rejection" | "medical";

export type Doc = {
  id: string;
  kind: DocKind;
  filename: string;
  page_count: number | null;
  status: string;
  error: string | null;
  key_terms?: KeyTerm[] | null;
};

export type KeyTerm = { field: string; label: string; value: string; page: number };

export type Case = { id: string; title: string | null };

export type Citation = {
  id: string; // "P3" for the user's documents, "R2" for a regulation
  source: "policy" | "regulation";
  document: string | null;
  chunkId: string;
  heading: string | null;
  pageStart: number;
  pageEnd: number;
  text: string;
};

export type Verdict = {
  verdict: "challengeable" | "valid" | "needs_info";
  summary: string;
  grounds: { point: string; cites: string[] }[];
};

export type Question = { id: string; text: string; type: "date" | "choice" | "text"; options?: string[] };
export type Questionnaire = { intro?: string; questions: Question[] };

export type Msg = {
  id: string;
  role: string;
  content: string;
  citations: Citation[] | null;
  meta?: { verdict?: Verdict; questionnaire?: Questionnaire } | null;
};
