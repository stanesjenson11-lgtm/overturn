"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, post, type Case } from "@/lib/client";
import Logo from "./Logo";
import { PlusIcon } from "./AttachMenu";
import { broadcastSignOut } from "./IdleTimeout";

/** CaseView fires this when an answer lands, so a fresh auto-title shows up
 *  without a reload. Cheaper than a store for the one thing that needs it. */
export const REFRESH = "overturn:refresh";

/**
 * Two-step delete, in place, without a modal.
 *
 * The confirm state lives on the button: first click arms it, second commits,
 * blur disarms. A window.confirm() blocks the whole tab, and a modal is a
 * focus trap to get wrong for something this small. Armed swaps the outline
 * bin for a filled accent one, so the state change is visible without text.
 */
export function DeleteButton({ what, onDelete }: { what: string; onDelete: () => Promise<void> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      title={armed ? `Click again to delete ${what}` : `Delete ${what}`}
      aria-label={armed ? `Confirm deleting ${what}` : `Delete ${what}`}
      onBlur={() => setArmed(false)}
      onClick={async (e) => {
        // The row is a link; deleting must not also navigate into it.
        e.preventDefault();
        e.stopPropagation();
        if (!armed) return setArmed(true);
        setBusy(true);
        try {
          await onDelete();
        } finally {
          setBusy(false);
          setArmed(false);
        }
      }}
      className={`flex size-7 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-40 ${
        armed
          ? "bg-accent text-accent-ink shadow-neu-inset-sm opacity-100"
          : "text-muted opacity-0 hover:text-accent hover:shadow-neu-sm focus-visible:opacity-100 group-hover:opacity-100"
      }`}
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden className="size-3.5">
        <path
          d="M4 7h16M10 4h4M9 7v11m6-11v11M6 7l1 12.5A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5L18 7"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [cases, setCases] = useState<Case[]>([]);

  const load = useCallback(async () => {
    setCases(await api<Case[]>("/api/cases"));
  }, []);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  useEffect(() => {
    const handler = () => void load();
    window.addEventListener(REFRESH, handler);
    return () => window.removeEventListener(REFRESH, handler);
  }, [load]);

  async function newCase() {
    const created = await post<Case>("/api/cases", {});
    router.push(`/cases/${created.id}`);
  }

  async function removeCase(id: string) {
    await api(`/api/cases/${id}`, { method: "DELETE" });
    // Leaving the deleted case on screen would show documents the server no
    // longer has; step off it before the list reloads under us.
    if (pathname === `/cases/${id}`) router.push("/cases");
    await load();
  }

  async function signOut() {
    await post("/api/auth/logout", {});
    broadcastSignOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-dvh w-72 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-panel px-4 py-5">
      <Link href="/cases" aria-label="Overturn: your cases">
        <Logo />
      </Link>

      <button
        type="button"
        onClick={() => void newCase()}
        className="flex items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5 text-sm font-medium text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm"
      >
        <PlusIcon />
        New case
      </button>

      <section className="flex-1">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Cases</h2>
        {cases.length === 0 && (
          <p className="text-sm text-muted">One case per rejected claim. Start one above.</p>
        )}
        <ul className="space-y-1">
          {cases.map((c) => {
            const active = pathname === `/cases/${c.id}`;
            return (
              <li key={c.id} className="group flex items-center gap-1">
                <Link
                  href={`/cases/${c.id}`}
                  className={`min-w-0 flex-1 truncate rounded-lg px-2 py-1.5 text-sm transition ${
                    active ? "bg-accent text-accent-ink shadow-neu-sm" : "hover:shadow-neu-sm"
                  }`}
                >
                  {c.title ?? "Untitled case"}
                </Link>
                <DeleteButton what={c.title ?? "this case"} onDelete={() => removeCase(c.id)} />
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex items-center justify-between border-t border-line pt-3 text-xs">
        <Link href="/guide" className="text-muted underline-offset-2 hover:underline">
          How to use
        </Link>
        <Link href="/cases/account" className="text-muted underline-offset-2 hover:underline">
          Your data
        </Link>
        <button type="button" onClick={signOut} className="text-muted hover:underline">
          Sign out
        </button>
      </div>
    </aside>
  );
}
