import type { NextConfig } from "next";

// Nothing to configure. That is the point of this rewrite: the frontend and the
// API are one origin, so there is no rewrite proxy, no CORS allowlist, and no
// NEXT_PUBLIC_API_URL to bake in at build time.
const config: NextConfig = {};

export default config;
