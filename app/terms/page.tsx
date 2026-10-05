import Link from "next/link";
import Logo from "@/components/Logo";
import { CONSENT_VERSION, CONTACT_EMAIL, PAID_TIER } from "@/lib/legal";

export const metadata = {
  title: "Terms of use · Overturn",
  description: "What Overturn is and isn't, who can use it, and the rules for using it.",
};

const TERMS: { title: string; body: React.ReactNode }[] = [
  {
    title: "What Overturn is",
    body: (
      <>
        An information tool. It compares the reason an insurer gave for rejecting a health claim
        with your policy and IRDAI&apos;s published rules, and drafts an appeal letter. It is not a
        lawyer, a doctor or an insurance adviser, it is not legal or medical advice, and it is not
        connected to IRDAI or to any insurer.
      </>
    ),
  },
  {
    title: "It can be wrong",
    body: (
      <>
        Verdicts come from an AI model working from the documents you provide. Every point links to
        the text it relies on: read it. You decide whether to appeal, and you&apos;re responsible
        for what you send. For a large claim or an allegation of fraud, talk to a lawyer.
      </>
    ),
  },
  {
    title: "Who can use it",
    body: <>Adults aged 18 or over. One account per person.</>,
  },
  {
    title: "Your documents",
    body: (
      <>
        Only upload documents you&apos;re entitled to share: your own, or a family member&apos;s
        claim you&apos;re handling with their agreement. You keep all rights in them; you let
        Overturn process them only to provide the service, as the{" "}
        <Link href="/privacy" className="text-accent underline-offset-2 hover:underline">
          privacy policy
        </Link>{" "}
        describes.
        {!PAID_TIER && (
          <>
            {" "}
            While Overturn runs on Google&apos;s free tier, use the sample documents rather than
            your own.
          </>
        )}
      </>
    ),
  },
  {
    title: "Don't",
    body: (
      <>
        Try to reach anyone else&apos;s data; get around the rate limits or the bot check; upload
        files built to attack software; use automated tools to sign up or ask questions; or use
        Overturn for anything unlawful.
      </>
    ),
  },
  {
    title: "Limits and availability",
    body: (
      <>
        There are daily limits on questions and uploads. Overturn is provided as it is, may be
        unavailable or change, and may stop. To the extent the law allows, it comes with no
        warranty, and its operator isn&apos;t liable for decisions made using it.
      </>
    ),
  },
  {
    title: "Ending",
    body: (
      <>
        You can delete your account at any time from Your data. Accounts that break these terms may
        be suspended or deleted.
      </>
    ),
  },
  {
    title: "Law",
    body: <>These terms are governed by the laws of India.</>,
  },
];

export default function Terms() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <Link href="/" aria-label="Overturn home">
        <Logo />
      </Link>

      <h1 className="mt-10 font-serif text-4xl leading-tight">Terms of use</h1>
      <p className="mt-3 text-sm text-muted">Version {CONSENT_VERSION}</p>

      {TERMS.map((t) => (
        <section key={t.title} className="mt-10">
          <h2 className="font-serif text-2xl">{t.title}</h2>
          <p className="mt-3 text-sm leading-relaxed">{t.body}</p>
        </section>
      ))}

      <p className="mt-12 text-xs text-muted">
        <Link href="/privacy" className="underline-offset-2 hover:underline">
          Privacy policy
        </Link>{" "}
        · Contact: {CONTACT_EMAIL}
      </p>
    </main>
  );
}
