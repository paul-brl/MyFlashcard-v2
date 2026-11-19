-- Demandes d'appel avec un P2 (suivi étudiant avant les concours).
-- À exécuter UNE FOIS dans l'éditeur SQL de Supabase. Ajout seul : ne touche à aucune table existante.
-- L'étudiant crée et voit sa demande ; seuls les administrateurs voient les autres et les modifient.

create table if not exists public.call_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  username      text,
  phone         text not null check (char_length(phone) between 6 and 30),
  availability  text not null check (char_length(availability) between 3 and 1000),
  topic         text check (topic is null or char_length(topic) <= 1000),
  status        text not null default 'new' check (status in ('new','scheduled','done','cancelled')),
  slot_at       timestamptz,
  caller        text check (caller is null or caller in ('Martin','Paul')),
  admin_note    text check (admin_note is null or char_length(admin_note) <= 2000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Une seule demande ouverte (nouvelle ou planifiée) par étudiant.
create unique index if not exists call_requests_one_open
  on public.call_requests (user_id) where status in ('new','scheduled');

alter table public.call_requests enable row level security;

drop policy if exists call_student_select on public.call_requests;
create policy call_student_select on public.call_requests
  for select to authenticated using (user_id = auth.uid());

drop policy if exists call_student_insert on public.call_requests;
create policy call_student_insert on public.call_requests
  for insert to authenticated
  with check (user_id = auth.uid() and status = 'new' and slot_at is null and caller is null and admin_note is null);

drop policy if exists call_admin_select on public.call_requests;
create policy call_admin_select on public.call_requests
  for select to authenticated using (is_admin());

drop policy if exists call_admin_update on public.call_requests;
create policy call_admin_update on public.call_requests
  for update to authenticated using (is_admin()) with check (is_admin());

drop policy if exists call_admin_delete on public.call_requests;
create policy call_admin_delete on public.call_requests
  for delete to authenticated using (is_admin());
