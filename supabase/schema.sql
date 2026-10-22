-- Erledigungen: Datenbank für den Geräte-Sync.
-- Einmal komplett im Supabase SQL-Editor ausführen (kann gefahrlos wiederholt werden).

create table if not exists public.notes (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id                text        not null,
  title             text        not null default '',
  body              text        not null default '',
  folder            text        not null default 'todo' check (folder in ('todo', 'doing', 'done')),
  created_at        bigint      not null,
  updated_at        bigint      not null,
  opened_at         bigint      not null default 0,
  deleted           boolean     not null default false,
  updated_by        text        not null default '',
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists notes_user_server_updated_idx
  on public.notes (user_id, server_updated_at);

-- Serverzeit bei jeder Änderung setzen (für das Nachladen verpasster Änderungen)
create or replace function public.notes_touch()
returns trigger
language plpgsql
as $$
begin
  new.server_updated_at := now();
  return new;
end;
$$;

drop trigger if exists notes_touch on public.notes;
create trigger notes_touch
  before insert or update on public.notes
  for each row execute function public.notes_touch();

-- Zugriff nur auf die eigenen Notizen
alter table public.notes enable row level security;

drop policy if exists "notes_select_own" on public.notes;
create policy "notes_select_own" on public.notes
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "notes_insert_own" on public.notes;
create policy "notes_insert_own" on public.notes
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "notes_update_own" on public.notes;
create policy "notes_update_own" on public.notes
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Gleiche Regel wie in der App: neuere Änderung gewinnt, bei Gleichstand entscheidet das Gerät.
create or replace function public.note_is_newer(a_at bigint, a_by text, b_at bigint, b_by text)
returns boolean
language sql
immutable
as $$
  select a_at > b_at or (a_at = b_at and (a_by collate "C") > (b_by collate "C"));
$$;

-- Mehrere Notizen auf einmal speichern, ohne je eine neuere Version zu überschreiben.
create or replace function public.upsert_notes(items jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.notes as n
    (user_id, id, title, body, folder, created_at, updated_at, opened_at, deleted, updated_by)
  select
    auth.uid(), x.id, coalesce(x.title, ''), coalesce(x.body, ''), coalesce(x.folder, 'todo'),
    x.created_at, x.updated_at, coalesce(x.opened_at, 0), coalesce(x.deleted, false), coalesce(x.updated_by, '')
  from jsonb_to_recordset(items) as x(
    id text, title text, body text, folder text, created_at bigint,
    updated_at bigint, opened_at bigint, deleted boolean, updated_by text
  )
  on conflict (user_id, id) do update set
    title      = case when public.note_is_newer(excluded.updated_at, excluded.updated_by, n.updated_at, n.updated_by) then excluded.title      else n.title      end,
    body       = case when public.note_is_newer(excluded.updated_at, excluded.updated_by, n.updated_at, n.updated_by) then excluded.body       else n.body       end,
    folder     = case when public.note_is_newer(excluded.updated_at, excluded.updated_by, n.updated_at, n.updated_by) then excluded.folder     else n.folder     end,
    deleted    = case when public.note_is_newer(excluded.updated_at, excluded.updated_by, n.updated_at, n.updated_by) then excluded.deleted    else n.deleted    end,
    updated_by = case when public.note_is_newer(excluded.updated_at, excluded.updated_by, n.updated_at, n.updated_by) then excluded.updated_by else n.updated_by end,
    updated_at = greatest(n.updated_at, excluded.updated_at),
    opened_at  = greatest(n.opened_at, excluded.opened_at)
  where public.note_is_newer(excluded.updated_at, excluded.updated_by, n.updated_at, n.updated_by)
     or excluded.opened_at > n.opened_at;
end;
$$;

revoke execute on function public.upsert_notes(jsonb) from public, anon;
grant execute on function public.upsert_notes(jsonb) to authenticated;

-- Live-Updates an alle Geräte
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notes'
  ) then
    alter publication supabase_realtime add table public.notes;
  end if;
end;
$$;
