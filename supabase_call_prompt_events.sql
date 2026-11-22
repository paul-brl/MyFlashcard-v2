-- Suivi de la fenêtre « appel avec un P2 » : vue, plus tard, non merci.
-- À exécuter UNE FOIS dans l'éditeur SQL de Supabase. Ajout seul : ne touche à aucune table existante.
-- L'étudiant écrit ses propres lignes ; seuls les administrateurs lisent.

create table if not exists public.call_prompt_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid(),
  username    text,
  event       text not null check (event in ('seen','later','no')),
  created_at  timestamptz not null default now()
);
create index if not exists call_prompt_events_user on public.call_prompt_events (user_id, created_at desc);
alter table public.call_prompt_events enable row level security;

drop policy if exists cpe_student_insert on public.call_prompt_events;
create policy cpe_student_insert on public.call_prompt_events
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists cpe_admin_select on public.call_prompt_events;
create policy cpe_admin_select on public.call_prompt_events
  for select to authenticated using (is_admin());
