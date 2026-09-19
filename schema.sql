-- CADÁVER EXQUISITO COLECTIVO · esquema de Supabase (v2)
-- Executa este ficheiro enteiro no SQL Editor. Pódese volver executar sen perder partidas.
-- Usa o prefixo cx_ : se tiñas as táboas ce_ da versión anterior, podes borralas.
--
-- Idea de seguridade:
--   · cx_games e cx_tiles son públicas en lectura, pero NON conteñen nin debuxos nin sesións.
--     Dunha peza rematada só se publica o marco de 4 px (columna frame).
--   · cx_private_* gardan sesións, borradores e debuxos completos. Ninguén as pode ler.
--   · Todo cambio pasa por funcións SECURITY DEFINER que comproban as regras.
--   · O debuxo completo cópiase á columna pública art só cando a partida se revela.

create extension if not exists pgcrypto;

create table if not exists public.cx_games (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  creator_name text,
  board_size integer not null default 7 check (board_size in (3,5,7,9)),
  goal integer not null check (goal > 0),
  avoid_own boolean not null default true,
  status text not null default 'playing' check (status in ('playing','revealed')),
  revealed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.cx_tiles (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.cx_games(id) on delete cascade,
  row_no integer not null,
  col_no integer not null,
  ring_no integer not null,
  status text not null default 'open' check (status in ('open','editing','done')),
  editor_name text,
  lock_expires_at timestamptz,
  frame text,          -- marco público dunha peza rematada
  art text,            -- debuxo completo; só tras a revelación
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (game_id, row_no, col_no)
);
create index if not exists cx_tiles_game_idx on public.cx_tiles (game_id, ring_no, status);

create table if not exists public.cx_private_games (
  game_id uuid primary key references public.cx_games(id) on delete cascade,
  creator_session text not null
);
create table if not exists public.cx_private_tiles (
  tile_id uuid primary key references public.cx_tiles(id) on delete cascade,
  game_id uuid not null references public.cx_games(id) on delete cascade,
  editor_session text,
  draft text,
  pixels text
);
create index if not exists cx_private_tiles_idx on public.cx_private_tiles (game_id, editor_session);

alter table public.cx_games enable row level security;
alter table public.cx_tiles enable row level security;
alter table public.cx_private_games enable row level security;   -- sen políticas = sen acceso
alter table public.cx_private_tiles enable row level security;

drop policy if exists cx_games_read on public.cx_games;
create policy cx_games_read on public.cx_games for select to anon, authenticated using (true);
drop policy if exists cx_tiles_read on public.cx_tiles;
create policy cx_tiles_read on public.cx_tiles for select to anon, authenticated using (true);

revoke all on public.cx_games, public.cx_tiles, public.cx_private_games, public.cx_private_tiles from anon, authenticated;
grant select on public.cx_games, public.cx_tiles to anon, authenticated;

do $$ begin alter publication supabase_realtime add table public.cx_tiles;
exception when duplicate_object or undefined_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.cx_games;
exception when duplicate_object or undefined_object then null; end $$;

-- ── Auxiliares internas ──────────────────────────────────────────────
create or replace function public.cx_make_code()
returns text
language plpgsql
as $$
declare
  -- Solo letras sin I, O ni Q, para evitar confusiones.
  chars constant text := 'ABCDEFGHJKLMNPRSTUVWXYZ';
  result text := '';
  i integer;
begin
  for i in 1..6 loop
    result := result || substr(
      chars,
      1 + floor(random() * length(chars))::int,
      1
    );
  end loop;

  return result;
end;
$$;

-- Marco dunha peza de 40×40: conserva os 4 px exteriores e baleira o interior.
create or replace function public.cx_frame(p text) returns text language sql immutable as $$
  select string_agg(
    case when y < 4 or y >= 36 then substr(p, y*40+1, 40)
         else substr(p, y*40+1, 4) || repeat('.', 32) || substr(p, y*40+37, 4) end,
    '' order by y)
  from generate_series(0, 39) as y
$$;

-- A casilla toca por un lado unha peza rematada por esta mesma sesión?
create or replace function public.cx_touches_own(p_game uuid, p_row int, p_col int, p_session text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from cx_tiles t join cx_private_tiles p on p.tile_id = t.id
    where t.game_id = p_game and t.status = 'done' and p.editor_session = p_session
      and abs(t.row_no - p_row) + abs(t.col_no - p_col) = 1)
$$;

create or replace function public.cx_do_reveal(p_game uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update cx_tiles t set art = p.pixels, updated_at = now()
    from cx_private_tiles p where p.tile_id = t.id and t.game_id = p_game and t.status = 'done';
  update cx_tiles set status = 'open', editor_name = null, lock_expires_at = null, updated_at = now()
    where game_id = p_game and status = 'editing';
  update cx_games set status = 'revealed', revealed_at = now() where id = p_game;
end $$;

-- ── API ──────────────────────────────────────────────────────────────
create or replace function public.cx_create_game(
  p_title text, p_creator text, p_session text, p_size int, p_goal int, p_avoid_own boolean
) returns text language plpgsql security definer set search_path = public as $$
declare g uuid; c text; n int := coalesce(p_size, 7); m int;
begin
  if length(coalesce(p_session,'')) < 16 then raise exception 'bad session'; end if;
  if n not in (3,5,7,9) then n := 7; end if;
  m := (n - 1) / 2;
  loop c := cx_make_code(); exit when not exists (select 1 from cx_games where code = c); end loop;

  insert into cx_games (code, title, creator_name, board_size, goal, avoid_own)
  values (c, coalesce(nullif(trim(left(p_title, 60)), ''), 'Cadáver exquisito'), left(p_creator, 40),
          n, least(greatest(coalesce(p_goal, n*n), 1), n*n), coalesce(p_avoid_own, true))
  returning id into g;
  insert into cx_private_games values (g, p_session);

  insert into cx_tiles (game_id, row_no, col_no, ring_no)
  select g, r, k, greatest(abs(r - m), abs(k - m))
  from generate_series(0, n-1) r, generate_series(0, n-1) k;
  insert into cx_private_tiles (tile_id, game_id) select id, g from cx_tiles where game_id = g;
  return c;
end $$;

create or replace function public.cx_claim_tile(
  p_game uuid, p_row int, p_col int, p_session text, p_editor text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare g cx_games%rowtype; target cx_tiles%rowtype; ring int;
begin
  if length(coalesce(p_session,'')) < 16 then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  perform pg_advisory_xact_lock(hashtext(p_game::text));
  select * into g from cx_games where id = p_game;
  if not found or g.status <> 'playing' then return jsonb_build_object('ok', false, 'code', 'closed'); end if;

  -- Reservas caducadas: volven estar libres (o borrador pérdese).
  update cx_private_tiles p set editor_session = null, draft = null
    from cx_tiles t where t.id = p.tile_id and t.game_id = p_game and t.status = 'editing' and t.lock_expires_at < now();
  update cx_tiles set status = 'open', editor_name = null, lock_expires_at = null, updated_at = now()
    where game_id = p_game and status = 'editing' and lock_expires_at < now();

  if exists (select 1 from cx_tiles t join cx_private_tiles p on p.tile_id = t.id
             where t.game_id = p_game and t.status = 'editing' and p.editor_session = p_session) then
    return jsonb_build_object('ok', false, 'code', 'busy');
  end if;

  select * into target from cx_tiles where game_id = p_game and row_no = p_row and col_no = p_col for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  if target.status <> 'open' then return jsonb_build_object('ok', false, 'code', 'taken'); end if;

  select min(ring_no) into ring from cx_tiles where game_id = p_game and status <> 'done';
  if target.ring_no <> ring then return jsonb_build_object('ok', false, 'code', 'ring'); end if;

  if exists (select 1 from cx_tiles t where t.game_id = p_game and t.status = 'editing'
             and abs(t.row_no - p_row) <= 1 and abs(t.col_no - p_col) <= 1) then
    return jsonb_build_object('ok', false, 'code', 'neighbour');
  end if;

  -- Non debuxar pegado á túa propia peza, agás que xa non quede outra opción no anel.
  if g.avoid_own and cx_touches_own(p_game, p_row, p_col, p_session) and exists (
       select 1 from cx_tiles t where t.game_id = p_game and t.ring_no = ring and t.status <> 'done'
         and t.id <> target.id and not cx_touches_own(p_game, t.row_no, t.col_no, p_session)) then
    return jsonb_build_object('ok', false, 'code', 'own');
  end if;

  update cx_tiles set status = 'editing', editor_name = coalesce(nullif(trim(left(p_editor, 40)), ''), 'Anónimo'),
    lock_expires_at = now() + interval '20 minutes', updated_at = now() where id = target.id;
  update cx_private_tiles set editor_session = p_session, draft = null where tile_id = target.id;
  return jsonb_build_object('ok', true);
end $$;

-- O que lle corresponde a esta sesión: se creou a partida, a peza en curso e as súas pezas rematadas.
create or replace function public.cx_resume(p_game uuid, p_session text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'creator', exists (select 1 from cx_private_games where game_id = p_game and creator_session = p_session),
    'editing', (select jsonb_build_object('row', t.row_no, 'col', t.col_no, 'draft', p.draft)
                from cx_tiles t join cx_private_tiles p on p.tile_id = t.id
                where t.game_id = p_game and t.status = 'editing' and t.lock_expires_at > now()
                  and p.editor_session = p_session limit 1),
    'mine', coalesce((select jsonb_agg(jsonb_build_object('row', t.row_no, 'col', t.col_no, 'pixels', p.pixels))
                from cx_tiles t join cx_private_tiles p on p.tile_id = t.id
                where t.game_id = p_game and t.status = 'done' and p.editor_session = p_session), '[]'::jsonb))
$$;

create or replace function public.cx_save_draft(
  p_game uuid, p_row int, p_col int, p_session text, p_pixels text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if p_pixels is null or p_pixels !~ '^[0-9a-v.]{1600}$' then return jsonb_build_object('ok', false, 'code', 'invalid'); end if;
  select t.id into tid from cx_tiles t join cx_private_tiles p on p.tile_id = t.id
    where t.game_id = p_game and t.row_no = p_row and t.col_no = p_col
      and t.status = 'editing' and p.editor_session = p_session;
  if tid is null then return jsonb_build_object('ok', false, 'code', 'not_yours'); end if;
  update cx_private_tiles set draft = p_pixels where tile_id = tid;
  -- A reserva só se renova na táboa pública de cando en vez, para non encher o tempo real de avisos.
  update cx_tiles set lock_expires_at = now() + interval '20 minutes', updated_at = now()
    where id = tid and lock_expires_at < now() + interval '15 minutes';
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cx_finish_tile(
  p_game uuid, p_row int, p_col int, p_session text, p_pixels text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if p_pixels is null or p_pixels !~ '^[0-9a-v.]{1600}$' or length(replace(p_pixels, '.', '')) < 40 then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_game::text));
  select t.id into tid from cx_tiles t join cx_private_tiles p on p.tile_id = t.id
    where t.game_id = p_game and t.row_no = p_row and t.col_no = p_col
      and t.status = 'editing' and p.editor_session = p_session;
  if tid is null then return jsonb_build_object('ok', false, 'code', 'not_yours'); end if;

  update cx_private_tiles set pixels = p_pixels, draft = null where tile_id = tid;
  update cx_tiles set status = 'done', frame = cx_frame(p_pixels), lock_expires_at = null,
    finished_at = now(), updated_at = now() where id = tid;

  if not exists (select 1 from cx_tiles where game_id = p_game and status <> 'done') then
    perform cx_do_reveal(p_game);
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Soltar unha casilla: a persoa que a ten, ou quen creou a partida (para desatascar).
create or replace function public.cx_release_tile(
  p_game uuid, p_row int, p_col int, p_session text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select t.id into tid from cx_tiles t join cx_private_tiles p on p.tile_id = t.id
    where t.game_id = p_game and t.row_no = p_row and t.col_no = p_col and t.status = 'editing'
      and (p.editor_session = p_session
           or exists (select 1 from cx_private_games where game_id = p_game and creator_session = p_session));
  if tid is null then return jsonb_build_object('ok', false, 'code', 'not_yours'); end if;
  update cx_private_tiles set editor_session = null, draft = null where tile_id = tid;
  update cx_tiles set status = 'open', editor_name = null, lock_expires_at = null, updated_at = now() where id = tid;
  return jsonb_build_object('ok', true);
end $$;

-- Revelar antes de encher o taboleiro: só quen creou a partida.
create or replace function public.cx_reveal(p_game uuid, p_session text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext(p_game::text));
  if not exists (select 1 from cx_private_games where game_id = p_game and creator_session = p_session) then
    return jsonb_build_object('ok', false, 'code', 'not_creator');
  end if;
  if not exists (select 1 from cx_tiles where game_id = p_game and status = 'done') then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  perform cx_do_reveal(p_game);
  return jsonb_build_object('ok', true);
end $$;

-- Permisos: as auxiliares non se poden chamar desde fóra.
revoke execute on function public.cx_do_reveal(uuid) from public, anon, authenticated;
revoke execute on function public.cx_touches_own(uuid,int,int,text) from public, anon, authenticated;
grant execute on function public.cx_create_game(text,text,text,int,int,boolean) to anon, authenticated;
grant execute on function public.cx_claim_tile(uuid,int,int,text,text) to anon, authenticated;
grant execute on function public.cx_resume(uuid,text) to anon, authenticated;
grant execute on function public.cx_save_draft(uuid,int,int,text,text) to anon, authenticated;
grant execute on function public.cx_finish_tile(uuid,int,int,text,text) to anon, authenticated;
grant execute on function public.cx_release_tile(uuid,int,int,text) to anon, authenticated;
grant execute on function public.cx_reveal(uuid,text) to anon, authenticated;
