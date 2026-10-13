-- Runtime settings edited from /admin. Each row overrides the matching environment variable
-- for every web and worker process within a second (LISTEN/NOTIFY, with polling as a fallback).
create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists app_settings_audit (
  id bigserial primary key,
  key text not null,
  old_value text,
  new_value text,
  wallet text,
  created_at timestamptz not null default now()
);
create index if not exists app_settings_audit_created on app_settings_audit (created_at desc);
