// Промокод из лаунчера (или с сайта): активируется атомарно в SQL-функции launcher_redeem_promo.
import { admin, body, err, ok, preflight, requireSession, normCode } from "../_shared/lib.ts";
const KNOWN = ["promo_not_found", "promo_expired", "promo_used", "promo_limit", "profile_not_found"];
Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const b = await body(req);
  const r = await requireSession(req, b);
  if (r.error) return r.error;
  const code = normCode(b.code);
  if (!/^[A-Z0-9]{4,24}$/.test(code)) return err("promo_not_found");
  const { data, error } = await admin.rpc("launcher_redeem_promo", { p_user: r.session.auth_user_id, p_code: code });
  if (error) { const m = KNOWN.find((k) => error.message.includes(k)); return err(m ?? "unknown", m ? 400 : 500); }
  return ok(data);
});
