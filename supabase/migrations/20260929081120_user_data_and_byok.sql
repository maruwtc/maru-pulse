-- Maru Pulse: per-user data (watchlist, positions, settings) and BYOK API keys.

-- ------------------------------------------------------------------ user settings
create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------------ watchlist
create table public.watchlist_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9.^=-]{1,12}$'),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, symbol)
);

-- ------------------------------------------------------------------ positions
create table public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  symbol text not null check (symbol ~ '^[A-Z0-9.^=-]{1,12}$'),
  kind text not null check (kind in ('stock', 'option')),
  side text not null check (side in ('long', 'short')),
  qty numeric not null check (qty > 0),
  cost numeric not null check (cost >= 0),
  option_type text check (option_type in ('call', 'put')),
  strike numeric check (strike > 0),
  expiration date,
  created_at timestamptz not null default now(),
  constraint option_fields check (
    kind = 'stock' or (option_type is not null and strike is not null and expiration is not null)
  )
);
create index positions_user_symbol_idx on public.positions (user_id, symbol);

-- ------------------------------------------------------------------ BYOK keys (metadata only; secret lives in Vault)
create table public.user_api_keys (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('openrouter')),
  secret_id uuid not null,
  key_hint text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);

-- ------------------------------------------------------------------ row level security
alter table public.user_settings enable row level security;
alter table public.watchlist_items enable row level security;
alter table public.positions enable row level security;
alter table public.user_api_keys enable row level security;

revoke all on public.user_settings, public.watchlist_items, public.positions, public.user_api_keys from anon;

create policy "own settings" on public.user_settings
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own watchlist" on public.watchlist_items
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "own positions" on public.positions
  for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Users may see that a key exists (and its last 4 chars) but never write rows directly.
create policy "read own key metadata" on public.user_api_keys
  for select to authenticated
  using ((select auth.uid()) = user_id);
revoke insert, update, delete on public.user_api_keys from authenticated;

-- ------------------------------------------------------------------ BYOK functions
-- Save / replace the caller's key. The plaintext goes straight into Vault.
create function public.set_api_key(p_provider text, p_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  hint text;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  if p_provider is distinct from 'openrouter' then
    raise exception 'unsupported provider';
  end if;
  p_key := btrim(p_key);
  if p_key is null or length(p_key) < 20 or length(p_key) > 400 then
    raise exception 'invalid API key';
  end if;
  hint := right(p_key, 4);

  select k.secret_id into sid from public.user_api_keys k where k.user_id = uid and k.provider = p_provider;
  if sid is null then
    sid := vault.create_secret(p_key, 'byok_' || p_provider || '_' || uid::text, 'Maru Pulse BYOK key');
    insert into public.user_api_keys (user_id, provider, secret_id, key_hint) values (uid, p_provider, sid, hint);
  else
    perform vault.update_secret(sid, p_key);
    update public.user_api_keys set key_hint = hint, updated_at = now()
      where user_id = uid and provider = p_provider;
  end if;
  return hint;
end;
$$;

-- Remove the caller's key (row + Vault secret).
create function public.delete_api_key(p_provider text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  delete from public.user_api_keys k where k.user_id = uid and k.provider = p_provider returning k.secret_id into sid;
  if sid is not null then
    delete from vault.secrets s where s.id = sid;
  end if;
end;
$$;

-- Decrypt a user's key. Server-side only (service_role / secret key); never exposed to browsers.
create function public.get_api_key_for_user(p_user_id uuid, p_provider text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select d.decrypted_secret
  from public.user_api_keys k
  join vault.decrypted_secrets d on d.id = k.secret_id
  where k.user_id = p_user_id and k.provider = p_provider;
$$;

revoke all on function public.set_api_key(text, text) from public, anon;
revoke all on function public.delete_api_key(text) from public, anon;
revoke all on function public.get_api_key_for_user(uuid, text) from public, anon, authenticated;
grant execute on function public.set_api_key(text, text) to authenticated;
grant execute on function public.delete_api_key(text) to authenticated;
grant execute on function public.get_api_key_for_user(uuid, text) to service_role;
