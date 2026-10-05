import { clearedCookie } from "@/lib/auth/session";
import { route } from "@/lib/http";

export const POST = route(async () =>
  Response.json({ ok: true }, { headers: { "set-cookie": clearedCookie() } }),
);
