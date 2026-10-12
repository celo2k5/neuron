-- Artifact bytes stored in Postgres (ARTIFACT_STORE=db), for hosts without a persistent disk.
-- Keys are content-addressed, so rows are immutable and writes are idempotent.
create table if not exists artifact_blobs (
  storage_key text primary key,
  body bytea not null,
  created_at timestamptz not null default now()
);
