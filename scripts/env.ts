import { config } from "dotenv";

// Same precedence Next.js uses, so a script and `npm run dev` never disagree
// about which database they are pointed at.
config({ path: ".env.local" });
config();

export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env.local first.`);
  return value;
}
