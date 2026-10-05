export default function CasesIndex() {
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-2xl">Start a case</h1>
        <p className="mt-3 text-muted">
          One case per rejected claim. Open a new case on the left, then add your policy
          wording and the insurer&apos;s rejection letter.
        </p>
        <p className="mt-6 text-sm text-muted">
          Nothing you upload is visible to anyone else — every query in this app is
          filtered by the account that made it.
        </p>
      </div>
    </main>
  );
}
