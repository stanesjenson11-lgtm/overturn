// The session cookie's name, alone in a file with no imports: the edge
// middleware reads it, and importing it from session.ts would drag that file's
// database code (and node:crypto) into the edge bundle.
export const COOKIE = "ls_session";
