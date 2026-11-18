// ─── send-call-confirmation ───────────────────────────────────────────────────
// E-mail à UN étudiant au sujet de son appel avec un P2 : confirmation, report
// ou annulation. Envoyé depuis l'onglet « Appels » de l'admin.
// À déployer comme Edge Function nommée « send-call-confirmation » (JWT vérifié).
//
// Réservé aux administrateurs (app_metadata.role === "admin" dans le jeton).
// Corps JSON : { request_id: "<uuid de call_requests>", kind?: "confirm" | "reschedule" | "cancel",
//                previous_slot_at?: "<date ISO de l'ancien créneau>" }
//   confirm / reschedule : la demande doit être « scheduled » avec un créneau.
//   cancel               : la demande doit être « cancelled » avec le créneau annulé.
// L'adresse de l'étudiant est lue côté serveur (accounts), jamais fournie par le navigateur.
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
const KINDS = ["confirm", "reschedule", "cancel"];
const SITE = (Deno.env.get("SITE_URL") || "https://myflashcard.fr").replace(/\/+$/, "");
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  });

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
  const kind = KINDS.includes(String(body.kind)) ? String(body.kind) : "confirm";
  const prevRaw = body.previous_slot_at ? new Date(String(body.previous_slot_at)) : null;
  const prev = prevRaw && !isNaN(prevRaw.getTime()) ? prevRaw.toISOString() : null;

  try {
    // 2. La demande doit exister et être dans l'état attendu pour ce type de mail.
    const { data: r, error } = await admin.from("call_requests").select("*").eq("id", id).maybeSingle();
    if (error || !r) return json({ error: "demande introuvable" }, 404);
    if (!r.slot_at) return json({ error: "aucun créneau sur cette demande" }, 409);
    if (kind === "cancel" ? r.status !== "cancelled" : r.status !== "scheduled") {
      return json({ error: "état de la demande incompatible" }, 409);
    }

    // 3. Adresse de l'étudiant, lue côté serveur.
    const { data: acc } = await admin.from("accounts").select("email,username").eq("user_id", r.user_id).maybeSingle();
    const to = String(acc?.email || acc?.username || "").trim().toLowerCase();
    if (!EMAIL_RE.test(to)) return json({ error: "adresse de l'étudiant introuvable" }, 404);

    // 4. Mail (transactionnel : pas de lien de désinscription).
    const when = fmtDate(r.slot_at);
    const phone = String(r.phone || "");
    const CALLER = r.caller === "Paul" ? "Paul" : "Martin";
    const FROM_PHONE = CALLER_PHONES[CALLER];
    const callLine = `${CALLER} t'appellera au ${phone}, depuis le ${FROM_PHONE}.`;

    let subject = "", lines: string[] = [];
    if (kind === "cancel") {
      subject = "Ton appel avec un P2 est annulé";
      lines = [
        `Nous devons annuler ton appel avec un P2 prévu ${when}. Désolé pour le dérangement.`,
        `Si tu veux toujours un appel, tu peux redemander un créneau en une minute : ${SITE}/?appel=1`,
        "Tu peux aussi répondre simplement à ce mail.",
      ];
    } else if (kind === "reschedule") {
      subject = "Ton appel avec un P2 est déplacé";
      lines = [
        `Ton appel avec un P2 est déplacé : ${when}${prev ? ` (au lieu de ${fmtDate(prev)})` : ""}.`,
        callLine,
        "Si ce nouveau créneau ne te convient pas, réponds simplement à ce mail ou écris-nous dans tes messages privés sur le site.",
      ];
    } else {
      subject = "Ton appel avec un P2 est confirmé";
      lines = [
        `Ton appel avec un P2 est confirmé : ${when}.`,
        callLine,
        "Si le créneau ne te convient plus, réponds simplement à ce mail ou écris-nous dans tes messages privés sur le site.",
      ];
    }
    const text = `Bonjour,\n\n${lines.join("\n\n")}\n\nÀ bientôt,\nL'équipe MyFlashCard`;
    const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f4ef">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1a1917">
<p>Bonjour,</p>
${lines.map((l) => `<p>${esc(l).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" style="color:#2c4a7c">$1</a>')}</p>`).join("\n")}
<p>À bientôt,<br>L'équipe MyFlashCard</p>
</div></body></html>`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `call-${kind}-${r.id}-${r.slot_at}`,
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
    return json({ sent: 1, kind });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
