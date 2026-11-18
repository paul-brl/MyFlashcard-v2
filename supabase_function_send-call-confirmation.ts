// ─── send-call-confirmation ───────────────────────────────────────────────────
// E-mail de confirmation d'un appel avec un P2, envoyé à UN étudiant quand
// l'administrateur fixe le créneau (onglet « Appels » de l'admin).
// À déployer comme Edge Function nommée « send-call-confirmation » (JWT vérifié).
//
// Réservé aux administrateurs (app_metadata.role === "admin" dans le jeton).
// Corps JSON attendu : { request_id: "<uuid d'une ligne de call_requests>" }
// La demande doit être au statut « scheduled » avec un créneau. L'adresse de
// l'étudiant est lue côté serveur (accounts), jamais fournie par le navigateur.
//
// Secrets déjà présents côté Supabase (aucun nouveau) :
//   RESEND_API_KEY  (à défaut, RESEND_API_KEY_NEWLETTER)
//   MAIL_FROM       (optionnel) "MyFlashCard <noreply@myflashcard.fr>" par défaut
//   MAIL_REPLY_TO   (optionnel) "contact@myflashcard.fr" par défaut
import { createClient } from "npm:@supabase/supabase-js@2";

const CALLER_PHONES: Record<string, string> = { Martin: "07 68 49 87 04", Paul: "07 66 11 91 11" };
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, prefer",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "méthode non autorisée" }, 405);

  // 1. Seul un administrateur peut appeler cette fonction.
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: auth } = await admin.auth.getUser(jwt);
  const me = auth?.user;
  if (!me || me.app_metadata?.role !== "admin") return json({ error: "réservé aux administrateurs" }, 403);

  const key = Deno.env.get("RESEND_API_KEY") || Deno.env.get("RESEND_API_KEY_NEWLETTER") || "";
  if (!key) return json({ error: "secret RESEND_API_KEY manquant côté Supabase" }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* corps vide */ }
  const id = String(body.request_id || "");
  if (!UUID_RE.test(id)) return json({ error: "request_id invalide" }, 400);

  try {
    // 2. La demande doit exister, être planifiée et avoir un créneau.
    const { data: r, error } = await admin.from("call_requests").select("*").eq("id", id).maybeSingle();
    if (error || !r) return json({ error: "demande introuvable" }, 404);
    if (r.status !== "scheduled" || !r.slot_at) return json({ error: "demande non planifiée" }, 409);

    // 3. Adresse de l'étudiant, lue côté serveur.
    const { data: acc } = await admin.from("accounts").select("email,username").eq("user_id", r.user_id).maybeSingle();
    const to = String(acc?.email || acc?.username || "").trim().toLowerCase();
    if (!EMAIL_RE.test(to)) return json({ error: "adresse de l'étudiant introuvable" }, 404);

    // 4. Mail de confirmation (transactionnel : pas de lien de désinscription).
    const when = new Date(r.slot_at).toLocaleString("fr-FR", {
      timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
    });
    const phone = String(r.phone || "");
    const CALLER = r.caller === "Paul" ? "Paul" : "Martin";
    const FROM_PHONE = CALLER_PHONES[CALLER];
    const subject = "Ton appel avec un P2 est confirmé";
    const text =
      `Bonjour,\n\nTon appel avec un P2 est confirmé : ${when}.\n` +
      `${CALLER} t'appellera au ${phone}, depuis le ${FROM_PHONE}.\n\n` +
      `Si le créneau ne te convient plus, réponds simplement à ce mail ou écris-nous dans tes messages privés sur le site.\n\n` +
      `À bientôt,\nL'équipe MyFlashCard`;
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f4ef">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1917">
<p>Bonjour,</p>
<p>Ton appel avec un P2 est confirmé : <b>${esc(when)}</b>.</p>
<p>${esc(CALLER)} t'appellera au <b>${esc(phone)}</b>, depuis le <b>${esc(FROM_PHONE)}</b>.</p>
<p>Si le créneau ne te convient plus, réponds simplement à ce mail ou écris-nous dans tes messages privés sur le site.</p>
<p>À bientôt,<br>L'équipe MyFlashCard</p>
</div></body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `call-${r.id}-${r.slot_at}`,
      },
      body: JSON.stringify({
        from: Deno.env.get("MAIL_FROM") || "MyFlashCard <noreply@myflashcard.fr>",
        to: [to],
        subject,
        html,
        text,
        reply_to: Deno.env.get("MAIL_REPLY_TO") || "contact@myflashcard.fr",
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return json({ error: d?.message || `Resend HTTP ${res.status}` }, 502);
    return json({ sent: 1 });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
