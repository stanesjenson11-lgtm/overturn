import { z } from "zod";
import { badRequest } from "../http";

const Credentials = z.object({
  // trim/lowercase run before the email check, so "  Tenant@Example.com " and
  // "tenant@example.com" are one account rather than two that can't both log in.
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(200),
  // Length beats character classes: a 12-character passphrase survives more
  // guesses than "P@ss1!" and people actually remember it.
  password: z.string().min(10, "Use at least 10 characters.").max(200),
});

export function parseCredentials(body: unknown): { email: string; password: string } {
  const parsed = Credentials.safeParse(body);
  if (!parsed.success)
    throw badRequest(parsed.error.issues[0]?.message ?? "Check your email and password.");
  return parsed.data;
}
