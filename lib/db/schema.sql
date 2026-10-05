-- Applied idempotently on every `npm run migrate` and by the test harness.
-- One database holds vectors, the keyword index, users and chat history, so
-- tenant scoping is a single predicate rather than a per-store problem.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  filename   text NOT NULL,
  page_count int,
  status     text NOT NULL DEFAULT 'pending',
  error      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- user_id is denormalized onto chunks and messages on purpose: every scoped
-- query becomes a single-table filter with no join to get wrong.
-- Added after launch, so ALTER rather than in the CREATE: an existing database
-- gets the column on its next migrate. Null means extraction failed or never
-- ran; an empty array means it ran and nothing survived grounding.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS key_terms jsonb;

CREATE TABLE IF NOT EXISTS chunks (
  id           bigserial PRIMARY KEY,
  document_id  uuid NOT NULL REFERENCES documents ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  ordinal      int  NOT NULL,
  heading_path text,
  page_start   int,
  page_end     int,
  content      text NOT NULL,
  embedding    vector(768) NOT NULL,
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE TABLE IF NOT EXISTS chats (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  document_id uuid REFERENCES documents ON DELETE SET NULL,
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id         bigserial PRIMARY KEY,
  chat_id    uuid NOT NULL REFERENCES chats ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  role       text NOT NULL,
  content    text NOT NULL,
  citations  jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage (
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  day        date NOT NULL,
  queries    int    NOT NULL DEFAULT 0,
  in_tokens  bigint NOT NULL DEFAULT 0,
  out_tokens bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS traces (
  id         bigserial PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  chat_id    uuid,
  spans      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_tenant_idx ON chunks (user_id, document_id);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx    ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS documents_user_idx ON documents (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chats_user_idx     ON chats (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_chat_idx  ON messages (user_id, chat_id, id);
CREATE INDEX IF NOT EXISTS traces_user_idx    ON traces (user_id, created_at DESC);

-- Last, and separately: HNSW build is the one statement that can fail on a
-- Postgres whose pgvector predates it. migrate.ts tolerates a failure here and
-- nowhere else — a sequential scan over one tenant's chunks is correct, just
-- slower, and correctness never depends on an index existing.
CREATE INDEX IF NOT EXISTS chunks_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops);
