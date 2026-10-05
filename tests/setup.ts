// Deterministic environment for every suite. No .env is read: a test that
// depends on a developer's local secrets is a test that fails in CI.
process.env.SESSION_SECRET = "test-secret-that-is-comfortably-long-enough-32";
process.env.GOOGLE_API_KEY ??= "test-not-used";
// Field encryption key for the suite: fixed, so a failure reproduces.
process.env.DATA_KEY = Buffer.alloc(32, 7).toString("base64");
delete process.env.TURNSTILE_SECRET_KEY; // the bot check skips outside production
