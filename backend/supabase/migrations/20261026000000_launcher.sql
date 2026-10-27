-- 4ONE Launcher: единая система логинов (код с сайта -> сессия лаунчера), серверы, новости, промокоды.
-- ВАЖНО: схема сайта нам неизвестна. Точки стыковки с БД сайта помечены TODO(site-db) — их и нужно подогнать:
--   1) launcher_profile_v      — откуда брать профиль игрока (сейчас: auth.users + launcher_accounts)
--   2) launcher_credit_4coin() — как зачислять 4Coin (сейчас: launcher_accounts.balance4c)
-- Все таблицы закрыты RLS без политик: читают и пишут только edge-функции с service_role. Исключение — публичное чтение серверов и новостей.

create extension if not exists pgcrypto;

-- ===== игровой аккаунт (TODO(site-db): заменить на реальную таблицу сайта/игры) =====
create table if not exists public.launcher_accounts (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique,
  game_name    text not null default '',
  role         text not null default 'Игрок',
  account_id   bigint generated always as identity,
  account_status text not null default 'active' check (account_status in ('active','banned','pending')),
  auth_method  text not null default '',
  balance4c    bigint not null default 0 check (balance4c >= 0),
  level        int,
  faction      text not null default '',
  play_minutes int not null default 0,
  launcher_access boolean not null default true,
  created_at   timestamptz not null default now()
);

create or replace view public.launcher_profile_v as
select a.auth_user_id, a.username, u.email, a.game_name, a.role, a.account_id::text as account_id,
       a.account_status, a.auth_method, a.balance4c, a.level, a.faction, a.play_minutes, a.launcher_access
from public.launcher_accounts a join auth.users u on u.id = a.auth_user_id;

create or replace function public.launcher_credit_4coin(p_user uuid, p_amount bigint, p_reason text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  update public.launcher_accounts set balance4c = balance4c + p_amount where auth_user_id = p_user returning balance4c into v;
  if v is null then raise exception 'profile_not_found'; end if;
  return v;
end $$;

-- ===== коды входа: сайт выдаёт -> лаунчер обменивает один раз =====
create table if not exists public.launcher_codes (
  id           uuid primary key default gen_random_uuid(),
  code_hash    text not null unique,                 -- sha256(pepper || код); сам код не хранится
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '10 minutes',
  used_at      timestamptz
);
create index if not exists launcher_codes_user_idx on public.launcher_codes(auth_user_id, created_at desc);

-- ===== сессии лаунчера (токен хранится у игрока в safeStorage; здесь только хэш) =====
create table if not exists public.launcher_sessions (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  device_label text not null default '',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '60 days',
  revoked_at   timestamptz
);
create index if not exists launcher_sessions_user_idx on public.launcher_sessions(auth_user_id);

-- ===== защита от перебора кода: по хэшу IP =====
create table if not exists public.launcher_auth_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null, at timestamptz not null default now(), ok boolean not null default false
);
create index if not exists launcher_auth_attempts_idx on public.launcher_auth_attempts(ip_hash, at desc);

-- ===== серверы и новости (публичное чтение) =====
create table if not exists public.launcher_servers (
  id text primary key, name text not null, tag text not null default '',
  status text not null default 'offline' check (status in ('online','offline','maintenance')),
  online int not null default 0, max_players int not null default 0,
  address text not null default '' check (address = '' or address ~ '^[^:\s]+:\d{1,5}$'),
  version text not null default '', description text not null default '',
  recommended boolean not null default false,       -- блок «Рекомендуем новичкам» в лаунчере
  sort int not null default 0, published boolean not null default true, updated_at timestamptz not null default now()
);
create table if not exists public.launcher_news (
  id uuid primary key default gen_random_uuid(), title text not null, excerpt text not null default '',
  category text not null default 'news' check (category in ('news','events','updates','laws','rules','announce')),
  cover text not null default '',                    -- имя из assets/news (sultan) или https-ссылка
  url text not null default '', published_at timestamptz not null default now(), published boolean not null default true
);

-- ===== клиент игры: версия и адрес манифеста =====
create table if not exists public.launcher_client_releases (
  version text primary key, manifest_url text not null, notes text not null default '',
  channel text not null default 'stable', created_at timestamptz not null default now(), active boolean not null default false
);
create unique index if not exists launcher_client_one_active on public.launcher_client_releases(channel) where active;

-- ===== флаги и объявление в шапке лаунчера =====
create table if not exists public.launcher_config (key text primary key, value jsonb not null);
insert into public.launcher_config(key, value) values ('notice', 'null'::jsonb), ('flags', '{}'::jsonb) on conflict do nothing;

-- ===== промокоды =====
create table if not exists public.promo_codes (
  code text primary key check (code ~ '^[A-Z0-9]{4,24}$'),
  title text not null, reward_kind text not null check (reward_kind in ('coins','vehicle','item')),
  reward_amount bigint, reward_name text not null default '', reward_image text not null default '',
  max_uses int, uses int not null default 0, per_user int not null default 1,
  starts_at timestamptz, expires_at timestamptz, active boolean not null default true
);
create table if not exists public.promo_redemptions (
  id uuid primary key default gen_random_uuid(), code text not null references public.promo_codes(code),
  auth_user_id uuid not null references auth.users(id) on delete cascade, at timestamptz not null default now()
);
create index if not exists promo_redemptions_user_idx on public.promo_redemptions(auth_user_id, at desc);

-- Атомарная активация: блокировка строки кода, проверки, зачисление, запись в историю. Ошибки — коды из лаунчера.
create or replace function public.launcher_redeem_promo(p_user uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.promo_codes; n int; rid uuid;
begin
  select * into c from public.promo_codes where code = p_code for update;
  if not found or not c.active then raise exception 'promo_not_found'; end if;
  if c.starts_at is not null and c.starts_at > now() then raise exception 'promo_not_found'; end if;
  if c.expires_at is not null and c.expires_at < now() then raise exception 'promo_expired'; end if;
  if c.max_uses is not null and c.uses >= c.max_uses then raise exception 'promo_limit'; end if;
  select count(*) into n from public.promo_redemptions where code = p_code and auth_user_id = p_user;
  if n >= c.per_user then raise exception 'promo_used'; end if;
  if c.reward_kind = 'coins' then perform public.launcher_credit_4coin(p_user, c.reward_amount, 'promo:' || p_code); end if;
  update public.promo_codes set uses = uses + 1 where code = p_code;
  insert into public.promo_redemptions(code, auth_user_id) values (p_code, p_user) returning id into rid;
  -- TODO(site-db): для vehicle/item — выдать предмет в игре (очередь выдачи или таблица инвентаря)
  return jsonb_build_object('id', rid, 'code', p_code, 'title', c.title, 'at', now(),
    'reward', jsonb_strip_nulls(jsonb_build_object('kind', c.reward_kind, 'amount', c.reward_amount,
      'name', nullif(c.reward_name,''), 'image', nullif(c.reward_image,''))));
end $$;
revoke all on function public.launcher_redeem_promo(uuid, text) from public, anon, authenticated;
revoke all on function public.launcher_credit_4coin(uuid, bigint, text) from public, anon, authenticated;

-- ===== RLS: всё закрыто, кроме публичного чтения витрины =====
alter table public.launcher_accounts enable row level security;
alter table public.launcher_codes enable row level security;
alter table public.launcher_sessions enable row level security;
alter table public.launcher_auth_attempts enable row level security;
alter table public.launcher_servers enable row level security;
alter table public.launcher_news enable row level security;
alter table public.launcher_client_releases enable row level security;
alter table public.launcher_config enable row level security;
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
create policy "public read servers" on public.launcher_servers for select using (published);
create policy "public read news" on public.launcher_news for select using (published);
-- игрок может смотреть свой аккаунт на сайте (по auth.uid()); запись — только сервер
create policy "own account" on public.launcher_accounts for select using (auth.uid() = auth_user_id);
create policy "own redemptions" on public.promo_redemptions for select using (auth.uid() = auth_user_id);

-- ===== демо-данные для первого запуска (удалите в продакшене) =====
insert into public.launcher_servers(id, name, tag, status, online, max_players, address, version, description, sort)
values ('main', '4ONE RP', 'DEV', 'online', 0, 500, '127.0.0.1:22005', '1.0.3889.0', 'Основной сервер. Тестовый период.', 0)
on conflict do nothing;
