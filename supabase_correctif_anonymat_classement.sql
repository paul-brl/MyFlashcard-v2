-- Correctif : anonymat du classement (23/11/2026)
--
-- Avant : la vue daily_points_public renvoyait le user_id des anonymes. En le croisant avec
-- forum_posts_public (même user_id, vrai nom), on pouvait retrouver qui se cache derrière « Anonyme ».
--
-- Après : le user_id des anonymes est null, et une colonne is_me (calculée côté serveur) permet
-- au front de surligner la ligne de l'utilisateur connecté, anonyme ou non.
--
-- À appliquer AVANT le déploiement du front (index.html lit is_me). Le filtrage des lignes
-- (anonymes sous 50 points cachés, filtre par cursus) est inchangé. La colonne is_me est ajoutée
-- en dernier, ce que « create or replace view » accepte. Droits et propriétaire de la vue conservés.

create or replace view public.daily_points_public as
select
  case when d.anonymous then null else d.user_id end as user_id,
  d.day,
  d.points,
  d.cards,
  case when d.anonymous then 'Anonyme'::text else d.display_name end as display_name,
  d.anonymous,
  (d.user_id = auth.uid()) as is_me
from public.daily_points d
where (not d.anonymous or d.points >= 50)
  and coalesce(
        (select a.cursus from public.accounts a where a.user_id = d.user_id limit 1),
        'pass-grenoble'::text
      ) = public.mfc_my_cursus();
