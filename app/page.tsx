import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-sm uppercase tracking-[0.2em] text-muted">LeaseLens</p>

      <h1 className="mt-4 font-serif text-4xl leading-tight sm:text-5xl">
        Ask your lease what it <em>actually</em> says.
      </h1>

      <p className="mt-6 max-w-prose text-lg leading-relaxed text-muted">
        Upload a rental agreement and ask it anything. Every answer quotes the
        clause that governs and cites the page it came from.
      </p>

      <div className="mt-8 rounded-lg border border-line bg-panel p-5">
        <p className="text-sm text-muted">And when the lease genuinely doesn&apos;t say:</p>
        <p className="prose-lease mt-3">
          &ldquo;This lease does not address reptiles. Clause 12 permits up to two cats
          or dogs under 25 pounds with written consent&nbsp;[1]; it says nothing about
          other animals.&rdquo;
        </p>
        <p className="mt-3 text-sm text-muted">
          Declining is the hard part. It&apos;s the part this was built for.
        </p>
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/register"
          className="rounded-md bg-accent px-5 py-2.5 font-medium text-paper transition hover:opacity-90"
        >
          Create an account
        </Link>
        <Link
          href="/login"
          className="rounded-md border border-line px-5 py-2.5 font-medium transition hover:bg-panel"
        >
          Sign in
        </Link>
      </div>

      <p className="mt-10 text-xs text-muted">
        Information from your document, not legal advice.
      </p>
    </main>
  );
}
