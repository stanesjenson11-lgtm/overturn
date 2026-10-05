/** Errors a route is allowed to show a user. Anything else becomes a 500 with
 *  no detail — an error message is an information disclosure channel. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = "Not signed in.") => new HttpError(401, m);
export const tooMany = (m: string) => new HttpError(429, m);

/**
 * Cross-tenant access lands here, not on a 403. A 403 would confirm the
 * resource exists and belongs to someone — this says nothing at all.
 */
export const notFound = (m = "Not found.") => new HttpError(404, m);

export const json = (data: unknown, status = 200) =>
  Response.json(data as any, { status });

/**
 * Wraps a route handler so a thrown HttpError becomes its response — and so
 * every response carries a cache directive.
 *
 * The third tenancy failure mode, after "wrong SQL" and "wrong session": the
 * right bytes, stored and replayed to the wrong person. Every response from
 * this API is tenant-specific, and none of them carried Cache-Control, so a
 * browser was free to apply heuristic freshness to /api/chats and hand the
 * previous account's conversation list to the next one on a shared machine.
 * No `Vary: Cookie` either, so a shared proxy would do the same across users.
 *
 * Set here rather than in json(), because login/register build their own
 * Response to attach Set-Cookie and the SSE route returns a stream — all of
 * them come back through this wrapper, and only this wrapper.
 */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    let res: Response;
    try {
      res = await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.message }, e.status);
      else {
        console.error(e);
        res = json({ error: "Something went wrong." }, 500);
      }
    }
    // no-transform too: the SSE route sets it so proxies stream rather than
    // buffer, and overwriting it here would undo that. Harmless on JSON.
    res.headers.set("cache-control", "private, no-store, no-transform");
    // Belt and braces: no-store already forbids reuse, but a cache that
    // ignores it still must not key one user's response for another.
    res.headers.set("vary", [res.headers.get("vary"), "Cookie"].filter(Boolean).join(", "));
    return res;
  };
}
