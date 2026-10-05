// Deterministic environment for every suite. No .env is read: a test that
// depends on a developer's local secrets is a test that fails in CI.
process.env.SESSION_SECRET = "test-secret-that-is-comfortably-long-enough-32";
process.env.GOOGLE_API_KEY ??= "test-not-used";
