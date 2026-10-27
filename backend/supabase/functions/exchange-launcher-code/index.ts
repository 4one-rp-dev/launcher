// Лаунчер: { code } -> { token, ...профиль }. Код одноразовый, живёт 10 минут.
import { admin, body, err, ok, preflight, rateLimit, normCode, sha256, randomToken, loadProfile, toProfile } from "../_shared/lib.ts";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  if (!(await rateLimit(req))) return err("busy", 429);
  const b = await body(req);
  const code = normCode(b.code);
  if (!/^[A-Z0-9]{4,24}$/.test(code)) return err("invalid_code");

  const { data: row } = await admin.from("launcher_codes").select("id, auth_user_id, expires_at, used_at").eq("code_hash", await sha256(code)).maybeSingle();
  if (!row) return err("invalid_code");
  if (row.used_at) return err("code_already_used");
  if (new Date(row.expires_at) < new Date()) return err("expired_code");

  // «погашаем» условным апдейтом: если два запроса пришли одновременно, второй получит 0 строк
  const { data: burned } = await admin.from("launcher_codes").update({ used_at: new Date().toISOString() }).eq("id", row.id).is("used_at", null).select("id");
  if (!burned?.length) return err("code_already_used");

  const profile = await loadProfile(row.auth_user_id);
  if (!profile) return err("profile_not_found", 404);
  if (profile.launcher_access === false || profile.account_status === "banned") return err("launcher_access_denied", 403);

  const token = randomToken();
  await admin.from("launcher_sessions").insert({ token_hash: await sha256(token), auth_user_id: row.auth_user_id, device_label: String(b.device ?? "").slice(0, 80) });
  return ok({ token, profile: toProfile(profile) });
});
