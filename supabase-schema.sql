
-- Owners are fixed by public.is_owner() below. The legacy owner_allowlist
-- table from earlier setup is intentionally not used for access anymore.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null default '',
  role text not null default 'player',
  is_banned boolean not null default false,
  created_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('player', 'moderator', 'admin', 'vip'))
);

alter table public.profiles
  add column if not exists role text not null default 'player';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_role_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('player', 'moderator', 'admin', 'vip'));
  end if;
end;
$$;

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

create table if not exists public.game_sessions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  score integer not null check (score >= 0),
  wave integer not null check (wave >= 1),
  duration_seconds integer not null check (duration_seconds >= 0),
  created_at timestamptz not null default now()
);

create index if not exists game_sessions_user_created_idx
  on public.game_sessions (user_id, created_at desc);

alter table public.game_sessions enable row level security;
revoke all on public.game_sessions from anon, authenticated;
grant select, insert on public.game_sessions to authenticated;

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(btrim(coalesce(auth.jwt() ->> 'email', ''))) in (
    'bigfanoe@gmail.com',
    '952976@omardblairk8.com'
  );
$$;

revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

drop policy if exists "profiles are visible to their player or an owner" on public.profiles;
create policy "profiles are visible to their player or an owner"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_owner()));

drop policy if exists "players can update their own display name" on public.profiles;
create policy "players can update their own display name"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()) and not is_banned)
  with check (id = (select auth.uid()) and not is_banned);

drop policy if exists "players and owners can read match records" on public.game_sessions;
create policy "players and owners can read match records"
  on public.game_sessions for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_owner()));

drop policy if exists "players can add their own match records" on public.game_sessions;
create policy "players can add their own match records"
  on public.game_sessions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and score >= 0
    and wave >= 1
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid()) and not p.is_banned
    )
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    lower(new.email),
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user();
revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.owner_dashboard_metrics()
returns table (
  player_count bigint,
  session_count bigint,
  average_score numeric,
  best_score integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Owner access required';
  end if;

  return query
  select
    (select count(*) from public.profiles),
    count(*),
    coalesce(round(avg(score)::numeric, 1), 0),
    coalesce(max(score), 0)
  from public.game_sessions;
end;
$$;

drop function if exists public.owner_list_players();
create function public.owner_list_players()
returns table (
  player_id uuid,
  email text,
  display_name text,
  role text,
  is_banned boolean,
  created_at timestamptz,
  total_sessions bigint,
  best_score integer,
  last_seen timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Owner access required';
  end if;

  return query
  select
    p.id,
    p.email,
    p.display_name,
    case
      when lower(p.email) in ('bigfanoe@gmail.com', '952976@omardblairk8.com') then 'owner'
      else p.role
    end,
    p.is_banned,
    p.created_at,
    count(gs.id),
    coalesce(max(gs.score), 0),
    max(gs.created_at)
  from public.profiles p
  left join public.game_sessions gs on gs.user_id = p.id
  group by p.id
  order by p.created_at desc;
end;
$$;

create or replace function public.owner_set_player_role(
  target_player_id uuid,
  new_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Owner access required';
  end if;
  if new_role is null or new_role not in ('player', 'moderator', 'admin', 'vip') then
    raise exception 'Invalid player role';
  end if;

  update public.profiles
  set role = new_role
  where id = target_player_id
    and lower(email) not in ('bigfanoe@gmail.com', '952976@omardblairk8.com');

  if not found then
    raise exception 'Player not found or owner roles cannot be changed';
  end if;
end;
$$;

create or replace function public.owner_set_player_banned(
  target_player_id uuid,
  should_ban boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Owner access required';
  end if;
  if target_player_id = (select auth.uid()) and should_ban then
    raise exception 'Owners cannot suspend their own account';
  end if;

  update public.profiles
  set is_banned = should_ban
  where id = target_player_id
    and lower(email) not in ('bigfanoe@gmail.com', '952976@omardblairk8.com');

  if not found then
    raise exception 'Player not found or owner accounts cannot be suspended';
  end if;
end;
$$;

revoke all on function public.owner_dashboard_metrics() from public, anon;
revoke all on function public.owner_list_players() from public, anon;
revoke all on function public.owner_set_player_role(uuid, text) from public, anon;
revoke all on function public.owner_set_player_banned(uuid, boolean) from public, anon;
grant execute on function public.owner_dashboard_metrics() to authenticated;
grant execute on function public.owner_list_players() to authenticated;
grant execute on function public.owner_set_player_role(uuid, text) to authenticated;
grant execute on function public.owner_set_player_banned(uuid, boolean) to authenticated;
