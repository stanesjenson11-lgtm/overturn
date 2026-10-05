import Link from "next/link";
import Logo from "@/components/Logo";
import { CONSENT_VERSION, CONTACT_EMAIL, PAID_TIER } from "@/lib/legal";

export const metadata = {
  title: "Privacy policy · Overturn",
  description: "What Overturn collects, why, who processes it, how long it's kept, and your rights.",
};

/**
 * The notice the sign-up consent points at (DPDP Act 2023 s.5, DPDP Rules 2025
 * rule 3): itemised data, the purpose, how to withdraw consent and exercise
 * rights, and how to complain to the Board. Readable on its own, without the
 * terms. Bump CONSENT_VERSION in lib/legal.ts when it changes in substance.
 */
export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" aria-label="Overturn home">
        <Logo />
      </Link>

      <h1 className="mt-10 font-serif text-4xl leading-tight">Privacy policy</h1>
      <p className="mt-3 text-sm text-muted">Version {CONSENT_VERSION}</p>
      <p className="mt-6 text-lg leading-relaxed text-muted">
        Overturn reads your health insurance documents, so it holds sensitive information about
        you. This page says exactly what, why, who else touches it, and how to get it back or have
        it deleted.
      </p>

      <Section title="What we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Your account:</strong> your email address, your password (stored only as a
            one-way scrypt hash, never readable), and when you agreed to this policy.
          </li>
          <li>
            <strong>Your documents:</strong> the policy wording, rejection letter and any medical
            document you upload. The file itself is read once and discarded. We keep its text,
            split into passages; a numeric search index of each passage; the file name and page
            count; and the key terms read from it (insurer, claim and policy numbers, amounts,
            dates, the stated reason). These usually include health information such as a
            diagnosis or treatment.
          </li>
          <li>
            <strong>Your conversation:</strong> your questions, your answers to Overturn&apos;s
            questions (for example, when your cover started), and its replies, verdicts and
            citations.
          </li>
          <li>
            <strong>Usage:</strong> how many questions you asked and how much model output they
            used each day, to enforce the daily limits.
          </li>
          <li>
            <strong>Security records:</strong> your IP address when you sign in, sign up, export
            your data or delete your account, and request counters used to stop password
            guessing.
          </li>
        </ul>
      </Section>

      <Section title="Why">
        <p>
          Only to check whether your claim rejection holds up, draft your appeal, keep your
          account working, and keep the service safe from abuse. We don&apos;t sell or share your
          data for advertising, don&apos;t build profiles, and don&apos;t use it to train our own
          models.
        </p>
      </Section>

      <Section title="Who else processes it" id="ai">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Google (Gemini API)</strong> reads your documents and messages to produce each
            answer.{" "}
            {PAID_TIER ? (
              <>
                Overturn uses Google&apos;s paid service, under which Google does not use your
                content to improve its products; it keeps it for a limited time to detect abuse.
              </>
            ) : (
              <>
                <strong>
                  Overturn currently runs on Google&apos;s free tier, under which Google may use
                  what is sent to improve its products, and human reviewers may read it.
                </strong>{" "}
                Until that changes, treat Overturn as a demo: use the sample documents, not your
                own.
              </>
            )}
          </li>
          <li>
            <strong>Neon</strong> hosts the database, in Singapore. It is encrypted on disk
            (AES-256) and only accepts encrypted connections.
          </li>
          <li>
            <strong>Vercel</strong> runs the app, in Singapore, over HTTPS only.
          </li>
          <li>
            <strong>Cloudflare Turnstile</strong> checks that sign-ins and sign-ups come from a
            person, using your IP address and browser signals.
          </li>
        </ul>
        <p className="mt-3">
          So your data is stored and processed outside India, which the DPDP Act permits except to
          countries the Government restricts.
        </p>
      </Section>

      <Section title="How it's protected">
        <ul className="list-disc space-y-2 pl-5">
          <li>Everything travels over HTTPS, and the database refuses unencrypted connections.</li>
          <li>
            Your messages, verdicts, case titles, file names and key terms are encrypted again
            (AES-256-GCM) before they reach the database, with a key the database never holds.
            The document passages themselves are protected by the database&apos;s disk encryption,
            because they have to be searchable.
          </li>
          <li>Every query is scoped to your account; no one else&apos;s request can reach your cases.</li>
          <li>
            Uploads are checked and refused if they carry scripts or attached files, and the
            original file is never stored.
          </li>
          <li>Sign-in is rate-limited and protected by a bot check.</li>
        </ul>
      </Section>

      <Section title="How long we keep it" id="retention">
        <p>
          Until you delete it. Deleting a document or a case removes it immediately; deleting your
          account removes the account and everything in it immediately. Unused empty draft cases
          are removed automatically. Security records (the event, time, IP address and account
          ID) are kept for one year to investigate misuse, as the DPDP Rules require, then
          deleted. The database provider keeps a short rolling restore history, after which
          deleted data is gone from it too.
        </p>
      </Section>

      <Section title="Your rights">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>See and take your data:</strong>{" "}
            <Link href="/cases/account" className="text-accent underline-offset-2 hover:underline">
              Your data
            </Link>{" "}
            downloads everything as a file; each case can be saved as a PDF.
          </li>
          <li>
            <strong>Correct it:</strong> delete a document and upload the right one, or write to
            us.
          </li>
          <li>
            <strong>Erase it, and withdraw consent:</strong> delete a case, or delete your account
            from Your data. Withdrawing is as easy as agreeing was.
          </li>
          <li>
            <strong>Nominate someone</strong> to exercise these rights if you die or can&apos;t: write
            to us with their details.
          </li>
          <li>
            <strong>Complain:</strong> write to {CONTACT_EMAIL}. We reply within 90 days. If
            you&apos;re not satisfied, you can complain to the Data Protection Board of India.
          </li>
        </ul>
      </Section>

      <Section title="If something goes wrong">
        <p>
          If a breach affects your data, we&apos;ll tell you and the Data Protection Board without
          delay: what happened, what it means for you, what we&apos;re doing about it, and what you
          can do, followed by a full report to the Board within 72 hours.
        </p>
      </Section>

      <Section title="Children">
        <p>
          Overturn is for adults (18 and over). If a claim concerns your child or another family
          member, you upload it as the policyholder, and you confirm you&apos;re entitled to share
          their information.
        </p>
      </Section>

      <Section title="Cookies">
        <p>
          One: a sign-in cookie that keeps you logged in for up to seven days. Scripts can&apos;t
          read it, and it&apos;s only sent over HTTPS. No analytics or advertising cookies.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes what we collect or who processes it, the version above changes
          and we&apos;ll ask you to agree again.
        </p>
      </Section>

      <p className="mt-12 text-xs text-muted">
        <Link href="/terms" className="underline-offset-2 hover:underline">
          Terms of use
        </Link>{" "}
        · Contact: {CONTACT_EMAIL}
      </p>
    </main>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-8">
      <h2 className="font-serif text-2xl">{title}</h2>
      <div className="mt-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}
