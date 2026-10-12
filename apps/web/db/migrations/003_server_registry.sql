-- Server-side registry: an append-only, hash-chained log of experiment commitments,
-- each entry signed with the server's ed25519 registry key. Replaces the on-chain program.
create table if not exists registry_keys (
  id text primary key,                 -- 'k1', 'k2', ... (rotation keeps old keys for verification)
  public_key text not null unique,     -- hex, 32 bytes
  secret_seed text,                    -- hex, 32 bytes; null when the key comes from REGISTRY_SIGNING_KEY
  created_at timestamptz not null default now()
);

create table if not exists registry_entries (
  seq bigint primary key,              -- 1, 2, 3, ... with no gaps
  experiment_id uuid not null unique references experiments(id),
  owner_wallet text not null,
  result_hash text not null,
  artifact_hash text not null,
  metadata_hash text not null,
  prev_hash text not null,             -- entry_hash of seq-1 (64 zeros for seq 1)
  entry_hash text not null unique,     -- sha256 of the canonical entry body, including prev_hash
  key_id text not null references registry_keys(id),
  signature text not null,             -- ed25519(entry_hash) by key_id, hex
  created_at timestamptz not null default now()
);
create index if not exists registry_entries_created on registry_entries (created_at desc);

-- the log is append-only: no updates or deletes, even by the app
create or replace function registry_entries_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'registry_entries is append-only';
end $$;
drop trigger if exists registry_entries_no_change on registry_entries;
create trigger registry_entries_no_change before update or delete on registry_entries
  for each row execute function registry_entries_append_only();

-- daily credit claims replace token purchases when no mint is configured
alter table credit_events drop constraint if exists credit_events_kind_check;
alter table credit_events add constraint credit_events_kind_check
  check (kind in ('purchase','reserve','consume','release','refund','grant','claim'));
