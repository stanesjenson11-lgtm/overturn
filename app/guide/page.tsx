import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = {
  title: "How to use Overturn",
  description: "When Overturn can help with a rejected health insurance claim, and how to use it, step by step.",
};

const STEPS = [
  {
    title: "Start a case",
    body: "One case per rejected claim. Click New case; it's saved as a draft and renamed after the claim once you review it.",
  },
  {
    title: "Add the two documents",
    body: "The policy wording (the full terms booklet, not just the one-page schedule) and the insurer's rejection letter. A PDF or a clear phone photo both work. Add the discharge summary too if you have it. Use the slots at the top, or the + beside the message box.",
  },
  {
    title: "Review the rejection",
    body: "Click Review this rejection. Overturn reads the whole letter, finds the clause the insurer relied on, checks it against your policy and IRDAI's rules, and runs any date checks (waiting periods, the five-year moratorium) in plain code.",
  },
  {
    title: "Answer what it asks",
    body: "If the answer turns on something your documents don't say, such as the date your cover first started, it asks. Answer in the form; it never guesses a fact you haven't given.",
  },
  {
    title: "Read the verdict",
    body: "Likely challengeable, looks valid, or needs more information. Every point carries a chip: an orange one quotes your own documents, an outlined one quotes IRDAI. Click any chip to see the exact text.",
  },
  {
    title: "Send the appeal",
    body: "On a likely-challengeable verdict, download the appeal letter. Fill in the bracketed details, sign it, and send it to the insurer's grievance officer. The second page gives your dates for the Insurance Ombudsman.",
  },
];

export default function Guide() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" aria-label="Overturn home">
        <Logo />
      </Link>

      <h1 className="mt-10 font-serif text-4xl leading-tight">How to use Overturn</h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">
        Overturn checks whether the reason your insurer gave for rejecting a health claim
        actually holds up, against your own policy and the regulator&apos;s rules, and drafts
        the appeal when it doesn&apos;t.
      </p>

      <section className="mt-12 grid gap-5 sm:grid-cols-2">
        <div className="rounded-2xl p-5 shadow-neu-sm">
          <h2 className="font-serif text-xl">Use it when</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>an Indian health insurer rejected a claim, or paid only part of it;</li>
            <li>you have the rejection letter and the policy wording;</li>
            <li>you want to know, before arguing, whether the reason stands up;</li>
            <li>you need a cited letter to the grievance officer, and the Ombudsman dates.</li>
          </ul>
        </div>
        <div className="rounded-2xl p-5 shadow-neu-sm">
          <h2 className="font-serif text-xl">It can&apos;t help with</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed">
            <li>life, motor or travel insurance;</li>
            <li>medical judgements, such as whether a treatment was necessary;</li>
            <li>an allegation of fraud: talk to a lawyer;</li>
            <li>anything urgent in hospital: call the insurer or TPA first.</li>
          </ul>
        </div>
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl">Have these ready</h2>
        <ul className="mt-4 space-y-2 text-sm leading-relaxed">
          <li>
            <strong>The policy wording.</strong> The full terms booklet from your insurer&apos;s
            website or policy email, not just the schedule page.
          </li>
          <li>
            <strong>The rejection letter</strong> (sometimes called a repudiation letter).
          </li>
          <li>
            <strong>The date your cover first started</strong>, including any earlier policy you
            ported from. It often decides the case.
          </li>
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl">Step by step</h2>
        <ol className="mt-6 space-y-5">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full font-serif text-accent shadow-neu-sm">
                {i + 1}
              </span>
              <div>
                <h3 className="font-medium">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12 rounded-2xl p-5 shadow-neu-inset-sm">
        <h2 className="font-serif text-xl">When the rejection looks valid</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Overturn will say so. An appeal the documents don&apos;t support costs time and
          rarely ends well, so it never encourages one. You can still ask it questions about
          the policy, or about what the rejection means for future claims.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="font-serif text-2xl">Try it first</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Sample documents (a policy wording and eight rejection letters, one of them a scan)
          are in the project&apos;s{" "}
          <a
            href="https://github.com/stanesjenson11-lgtm/overturn/tree/main/samples"
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            samples folder
          </a>
          , with what to answer and what to expect for each.
        </p>
      </section>

      <div className="mt-12 flex flex-wrap gap-3">
        <Link
          href="/cases"
          className="rounded-xl bg-accent px-5 py-2.5 font-medium text-accent-ink shadow-neu-sm transition active:shadow-neu-inset-sm"
        >
          Start a case
        </Link>
      </div>

      <p className="mt-10 text-xs text-muted">
        Information from your documents and IRDAI&apos;s rules, not legal or medical advice.
      </p>
    </main>
  );
}
