-- Applied idempotently on every `npm run migrate` and by the test harness.
-- One database holds vectors, the keyword index, users, cases and their
-- history, so tenant scoping is a single predicate rather than a per-store
-- problem.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- A case is one rejected claim: the documents that explain it and the
-- conversation about it.
CREATE TABLE IF NOT EXISTS cases (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  title      text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- user_id is denormalized onto every table below on purpose: every scoped
-- query becomes a single-table filter with no join to get wrong.
--
-- One document of each kind per case, enforced here rather than in a route:
-- a constraint can't be raced by two uploads in flight.
-- ponytail: one medical document per case; a list of them when a real case
-- needs a discharge summary AND bills.
CREATE TABLE IF NOT EXISTS documents (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  case_id    uuid NOT NULL REFERENCES cases ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('policy', 'rejection', 'medical')),
  filename   text NOT NULL,
  page_count int,
  status     text NOT NULL DEFAULT 'pending',
  error      text,
  key_terms  jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, kind)
);

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

CREATE TABLE IF NOT EXISTS messages (
  id         bigserial PRIMARY KEY,
  case_id    uuid NOT NULL REFERENCES cases ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  role       text NOT NULL,
  content    text NOT NULL,
  citations  jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The agent's structured output beside its prose: a verdict, or the
-- questionnaire it is waiting on. ALTER rather than in the CREATE so an
-- existing database picks it up on its next migrate.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS meta jsonb;

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
  case_id    uuid,
  spans      jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Public regulations: IRDAI circulars and rules every case is checked
-- against. Deliberately NOT a tenant table: there is no user_id because the
-- rows belong to nobody, and nothing a user uploads can land here (only
-- scripts/ingest-regulations.ts writes to it). Tenant data never moves the
-- other way either; the two corpora are fused only inside the agent.
CREATE TABLE IF NOT EXISTS reg_chunks (
  id           bigserial PRIMARY KEY,
  source       text NOT NULL,
  title        text NOT NULL,
  ordinal      int  NOT NULL,
  heading_path text,
  page_start   int,
  page_end     int,
  content      text NOT NULL,
  embedding    vector(768) NOT NULL,
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

CREATE INDEX IF NOT EXISTS chunks_tenant_idx  ON chunks (user_id, document_id);
CREATE INDEX IF NOT EXISTS reg_chunks_tsv_idx ON reg_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx     ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS cases_user_idx     ON cases (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_case_idx ON documents (user_id, case_id);
CREATE INDEX IF NOT EXISTS messages_case_idx  ON messages (user_id, case_id, id);
CREATE INDEX IF NOT EXISTS traces_user_idx    ON traces (user_id, created_at DESC);

-- Last, and separately: HNSW build is the one statement that can fail on a
-- Postgres whose pgvector predates it. migrate.ts tolerates a failure here and
-- nowhere else — a sequential scan over one tenant's chunks is correct, just
-- slower, and correctness never depends on an index existing.
CREATE INDEX IF NOT EXISTS chunks_hnsw_idx ON chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS reg_chunks_hnsw_idx ON reg_chunks USING hnsw (embedding vector_cosine_ops);
