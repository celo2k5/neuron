-- NEURON schema v1. All timestamps UTC. Token amounts are exact integers (numeric(39,0)).
-- gen_random_uuid() is built into PostgreSQL 13+

create table users (
  id uuid primary key default gen_random_uuid(),
  wallet text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table auth_challenges (
  nonce text primary key,
  wallet text not null,
  intent text not null,
  message text not null,
  payload_hash text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index auth_challenges_wallet_idx on auth_challenges (wallet, created_at desc);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  cluster text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  user_agent text
);
create index sessions_user_idx on sessions (user_id);

-- content-addressed immutable blobs (weights, checkpoints, activation traces)
create table artifacts (
  hash text primary key check (hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('model','checkpoint','activations','network_snapshot','dataset')),
  size_bytes integer not null check (size_bytes >= 0),
  storage_key text not null,
  created_at timestamptz not null default now()
);

create table models (
  id text primary key,                       -- "M-" + configHash[0:12]
  owner_id uuid references users(id) on delete set null,
  name text not null,
  seed text not null,
  architecture text not null,
  config jsonb not null,
  config_hash text not null unique,
  presentation jsonb not null default '{"form":"CONSTELLATION","palette":"theme"}',
  forked_from text references models(id) on delete set null,
  visibility text not null default 'public' check (visibility in ('public','unlisted')),
  neuron_count integer not null,
  edge_count integer not null,
  param_count integer not null,
  created_at timestamptz not null default now()
);
create index models_owner_idx on models (owner_id, created_at desc);
create index models_created_idx on models (created_at desc, id);
create index models_arch_idx on models (architecture);

create table model_versions (
  id uuid primary key default gen_random_uuid(),
  model_id text not null references models(id) on delete cascade,
  version integer not null check (version >= 1),
  artifact_hash text not null references artifacts(hash),
  parent_artifact_hash text,
  trained boolean not null default false,
  training_job_id uuid,
  engine text not null,
  metrics jsonb,
  created_at timestamptz not null default now(),
  unique (model_id, version),
  unique (model_id, artifact_hash)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('experiment','training','index_registry','reconcile_payment','governance_execute')),
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled','dead')),
  idempotency_key text unique,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  run_after timestamptz not null default now(),
  locked_by text,
  locked_at timestamptz,
  heartbeat_at timestamptz,
  cancel_requested boolean not null default false,
  result jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index jobs_ready_idx on jobs (status, run_after) where status = 'queued';

create table experiments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references users(id) on delete set null,
  model_version_id uuid not null references model_versions(id),
  model_id text not null references models(id),
  network_version_id uuid,
  status text not null default 'queued' check (status in ('queued','running','completed','failed')),
  input_source text not null check (input_source in ('manual','seeded','dataset')),
  input jsonb not null,
  input_seed text,
  output jsonb,
  activations_hash text references artifacts(hash),
  activation_summary jsonb,
  result_hash text,
  metadata_hash text,
  engine text,
  elapsed_ms double precision,
  error text,
  job_id uuid references jobs(id),
  reproduced_from uuid references experiments(id),
  repro jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index experiments_model_idx on experiments (model_id, created_at desc);
create index experiments_owner_idx on experiments (owner_id, created_at desc);
create index experiments_created_idx on experiments (created_at desc, id);

create table training_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  model_id text not null references models(id),
  base_version_id uuid not null references model_versions(id),
  dataset text not null,
  dataset_hash text not null,
  options jsonb not null,
  status text not null default 'queued' check (status in ('queued','running','paused','completed','failed','cancelled')),
  epoch integer not null default 0,
  history jsonb not null default '[]',
  baseline jsonb,
  credits_reserved integer not null default 0,
  job_id uuid references jobs(id),
  error text,
  resource jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index training_jobs_model_idx on training_jobs (model_id, created_at desc);

create table checkpoints (
  id uuid primary key default gen_random_uuid(),
  training_job_id uuid not null references training_jobs(id) on delete cascade,
  model_version_id uuid not null references model_versions(id),
  epoch integer not null,
  metrics jsonb not null,
  artifact_hash text not null references artifacts(hash),
  created_at timestamptz not null default now(),
  unique (training_job_id, epoch)
);

-- shared community network
create table networks (
  id text primary key,
  name text not null,
  policy jsonb not null,
  current_version integer not null default 0,
  created_at timestamptz not null default now()
);
create table neurons (
  id text primary key,
  network_id text not null references networks(id),
  owner_id uuid references users(id),
  owner_wallet text not null,
  layer smallint not null check (layer in (1,2)),
  bias double precision not null check (bias between -2 and 2),
  seed text not null check (length(seed) between 1 and 64),
  scale double precision not null check (scale > 0 and scale <= 2),
  status text not null default 'active' check (status in ('active','retired')),
  registration_signature text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index neurons_network_idx on neurons (network_id, status);
create table network_versions (
  id uuid primary key default gen_random_uuid(),
  network_id text not null references networks(id),
  version integer not null,
  snapshot_hash text not null,
  artifact_hash text not null references artifacts(hash),
  model_id text not null,
  neuron_count integer not null,
  change jsonb not null,
  created_at timestamptz not null default now(),
  unique (network_id, version)
);

-- token payments & credits
create table payment_intents (
  id text primary key,
  user_id uuid not null references users(id),
  purpose text not null check (purpose in ('credits')),
  credits integer not null check (credits > 0),
  mint text not null,
  decimals smallint not null,
  token_program text not null,
  amount numeric(39,0) not null check (amount > 0),
  recipient_owner text not null,
  sender text not null,
  reference text not null unique,
  status text not null default 'pending' check (status in ('pending','submitted','confirmed','failed','expired')),
  signature text unique,
  failure_reason text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table token_payments (
  signature text primary key,
  intent_id text not null unique references payment_intents(id),
  slot bigint not null,
  amount numeric(39,0) not null,
  mint text not null,
  payer text not null,
  verified_at timestamptz not null default now()
);
create table credit_accounts (
  user_id uuid primary key references users(id),
  available integer not null default 0 check (available >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  consumed integer not null default 0 check (consumed >= 0),
  refunded integer not null default 0 check (refunded >= 0),
  updated_at timestamptz not null default now()
);
create table credit_events (
  id bigserial primary key,
  user_id uuid not null references users(id),
  kind text not null check (kind in ('purchase','reserve','consume','release','refund','grant')),
  amount integer not null check (amount > 0),
  ref_type text not null,
  ref_id text not null,
  created_at timestamptz not null default now(),
  unique (kind, ref_type, ref_id)
);

-- on-chain commitments (indexed + client-submitted)
create table commitments (
  id uuid primary key default gen_random_uuid(),
  experiment_id uuid not null unique references experiments(id),
  owner_wallet text not null,
  program_id text not null,
  pda text not null,
  signature text,
  ix_index integer,
  slot bigint,
  status text not null default 'pending' check (status in ('pending','confirmed','verified','mismatch','not_found')),
  cluster text not null,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (signature, ix_index)
);
create table indexer_state (
  id text primary key,
  last_signature text,
  last_slot bigint,
  updated_at timestamptz not null default now()
);

-- governance (advisory + bounded policy changes; never treasury)
create table proposals (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references users(id),
  kind text not null check (kind in ('advisory','policy')),
  title text not null check (length(title) between 4 and 120),
  body text not null check (length(body) <= 4000),
  change jsonb,
  snapshot_rule text not null,
  quorum numeric(39,0) not null,
  approval_bps integer not null check (approval_bps between 5000 and 10000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  execute_after timestamptz,
  status text not null default 'active' check (status in ('active','passed','rejected','executed','cancelled')),
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create table votes (
  proposal_id uuid not null references proposals(id) on delete cascade,
  user_id uuid not null references users(id),
  wallet text not null,
  choice text not null check (choice in ('for','against','abstain')),
  weight numeric(39,0) not null check (weight >= 0),
  signature text not null unique,
  nonce text not null unique,
  created_at timestamptz not null default now(),
  primary key (proposal_id, user_id)
);

create table activity_events (
  id bigserial primary key,
  topic text not null,
  ref_id text not null,
  user_id uuid,
  data jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_events_topic_idx on activity_events (topic, id);

create table rate_limits (
  key text primary key,
  window_start timestamptz not null,
  count integer not null
);

create table schema_migrations (version text primary key, applied_at timestamptz not null default now());
