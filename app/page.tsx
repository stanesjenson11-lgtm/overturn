import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm uppercase tracking-[0.2em] text-muted">Overturn</p>

      <h1 className="mt-4 font-serif text-4xl leading-tight sm:text-5xl">
        Your health insurance claim was rejected. Does the reason <em>hold up</em>?
      </h1>

      <p className="mt-6 max-w-prose text-lg leading-relaxed text-muted">
        Upload your policy wording and the insurer&apos;s letter. Overturn checks the reason
        against your policy and IRDAI&apos;s rules, quotes every clause it relies on, and drafts
        the appeal when the rejection doesn&apos;t stand.
      </p>

      <div className="mt-8 rounded-2xl p-5 shadow-neu-sm">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Likely challengeable</p>
        <p className="prose-lease mt-3">
          &ldquo;The insurer rejected the claim for non-disclosure, but your cover had run for
          79 months at admission. After sixty continuous months, no claim can be contested on
          that ground except for established fraud&nbsp;[R1], and your own policy says the
          same&nbsp;[P4].&rdquo;
        </p>
        <p className="mt-3 text-sm text-muted">
          And when the rejection is sound, it says so. False hope costs people time and money.
        </p>
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/register"
          className="rounded-xl bg-accent px-5 py-2.5 font-medium text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm"
        >
          Check a rejection
        </Link>
        <Link href="/login" className="rounded-xl px-5 py-2.5 font-medium shadow-neu-sm transition hover:shadow-neu">
          Sign in
        </Link>
      </div>

      <p className="mt-10 text-xs text-muted">
        Information from your documents and IRDAI&apos;s rules, not legal or medical advice.
      </p>
    </main>
  );
}
