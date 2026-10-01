-- Maru Pulse: append-only audit log of every AI generation (analysis, trade ideas, position reviews).
-- Kept for audit and record, separate from per-user data: users can't read it, rows are never edited,
-- and they outlive the account (user_id is recorded but deliberately has no foreign key / cascade).

create table public.ai_generations (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('analysis', 'trade_ideas', 'position_review')),
  symbol text not null,
  user_id uuid,                      -- who asked (no FK on purpose: the record survives account deletion)
  model text,
  lang text,
  request jsonb not null default '{}'::jsonb,   -- user inputs: question, risk profile, deep think, positions
  messages jsonb,                    -- exact prompt sent to the model (system + user)
  output text,                       -- raw model text as returned
  result jsonb,                      -- parsed / enriched result returned to the browser (JSON features)
  usage jsonb,                       -- tokens and cost reported by OpenRouter
  status text not null check (status in ('ok', 'error', 'cancelled')),
  error text,
  duration_ms integer
);
create index ai_generations_created_idx on public.ai_generations (created_at desc);
create index ai_generations_symbol_idx on public.ai_generations (symbol, created_at desc);
create index ai_generations_user_idx on public.ai_generations (user_id, created_at desc);

comment on table public.ai_generations is
  'Append-only audit log of AI generations. Written by the server (secret key) only; not readable by app users.';

-- Server-only: RLS on with no policies, and no grants for browser roles. The secret key (service_role) bypasses RLS.
alter table public.ai_generations enable row level security;
revoke all on public.ai_generations from anon, authenticated;

-- Append-only: block edits and deletes so the record can't be rewritten.
create function public.ai_generations_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ai_generations is append-only';
end;
$$;

create trigger ai_generations_no_update_delete
  before update or delete on public.ai_generations
  for each row execute function public.ai_generations_append_only();

create trigger ai_generations_no_truncate
  before truncate on public.ai_generations
  for each statement execute function public.ai_generations_append_only();
