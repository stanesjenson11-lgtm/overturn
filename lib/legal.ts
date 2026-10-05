/**
 * What the privacy notice and terms depend on, in one place.
 *
 * CONSENT_VERSION is stored beside each user's consent. Bump it whenever the
 * privacy notice changes what is collected or who it goes to, so the database
 * can say who agreed to which version.
 */
export const CONSENT_VERSION = "2026-10-05";

/** Grievance and privacy contact (DPDP Rules 2025, rule 9). Set in the
 *  deployment, not committed: it's a real person's inbox. */
export const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "the contact address in the project README";

/**
 * Google's free Gemini tier may use prompts to improve its products, with
 * human review, and its terms say not to send personal information to it. Only
 * a billing-enabled key keeps uploads out of that. Until then this is a demo
 * for sample documents, and the app says so.
 */
export const PAID_TIER = process.env.LLM_PAID_TIER === "true";
