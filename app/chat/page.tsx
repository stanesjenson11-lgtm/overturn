export default function ChatIndex() {
  return (
    <main className="flex flex-1 items-center justify-center px-6">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-2xl">Start with a lease</h1>
        <p className="mt-3 text-muted">
          Drop a PDF into the panel on the left. Once it&apos;s indexed, pick it to open a
          conversation.
        </p>
        <p className="mt-6 text-sm text-muted">
          Nothing you upload is visible to anyone else — every query in this app is
          filtered by the account that made it.
        </p>
      </div>
    </main>
  );
}
