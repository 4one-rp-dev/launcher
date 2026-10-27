// Общие утилиты edge-функций лаунчера (Deno). Ответ: { data } при успехе, { error: "<код>" } при ошибке — коды совпадают с src/core/contract.js.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const PEPPER = Deno.env.get("LAUNCHER_PEPPER") ?? "";            // supabase secrets set LAUNCHER_PEPPER=<случайная строка>
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-launcher-session" };

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
export const ok = (data: unknown = {}) => json(200, { data });
export const err = (code: string, status = 400) => json(status, { error: code });
export const preflight = (req: Request) => (req.method === "OPTIONS" ? new Response(null, { status: 204, headers: CORS }) : null);

export async function sha256(s: string): Promise<string> {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(PEPPER + s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const randomToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, "0")).join("");
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";                 // без O/0/I/1
export const randomCode = (n = 8) => [...crypto.getRandomValues(new Uint8Array(n))].map((x) => ALPHABET[x % ALPHABET.length]).join("");
export const normCode = (s: unknown) => String(s ?? "").toUpperCase().replace(/[\s-]+/g, "");

export async function body(req: Request): Promise<Record<string, unknown>> { try { return await req.json(); } catch { return {}; } }

/** Профиль в форме, которую ждёт лаунчер (src/main/api/backend.js toProfile) */
export function toProfile(p: Record<string, any>) {
  return {
    authUserId: p.auth_user_id, username: p.username, email: p.email ?? "", nickname: p.username, gameName: p.game_name ?? "",
    role: p.role ?? "Игрок", accountId: p.account_id ?? "", accountStatus: p.account_status ?? "active", authMethod: p.auth_method ?? "",
    balance4c: Number(p.balance4c ?? 0), level: p.level ?? null, faction: p.faction ?? "", hours: Math.floor((p.play_minutes ?? 0) / 60),
    launcherAccess: p.launcher_access !== false,
  };
}
export async function loadProfile(userId: string) {
  const { data } = await admin.from("launcher_profile_v").select("*").eq("auth_user_id", userId).maybeSingle();
  return data;
}

/** Проверка сессии лаунчера: токен из заголовка X-Launcher-Session или поля sessionToken */
export async function requireSession(req: Request, b: Record<string, unknown>) {
  const token = req.headers.get("x-launcher-session") || String(b.sessionToken ?? "");
  if (!token) return { error: err("invalid_session", 401) };
  const { data: s } = await admin.from("launcher_sessions").select("id, auth_user_id, expires_at, revoked_at").eq("token_hash", await sha256(token)).maybeSingle();
  if (!s) return { error: err("invalid_session", 401) };
  if (s.revoked_at) return { error: err("session_revoked", 401) };
  if (new Date(s.expires_at) < new Date()) return { error: err("session_expired", 401) };
  const profile = await loadProfile(s.auth_user_id);
  if (!profile) return { error: err("profile_not_found", 404) };
  if (profile.launcher_access === false || profile.account_status === "banned") return { error: err("launcher_access_denied", 403) };
  await admin.from("launcher_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", s.id);
  return { session: s, profile, token };
}

/** Не больше 10 попыток входа в минуту с одного IP (хэш). */
export async function rateLimit(req: Request): Promise<boolean> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  const h = await sha256("ip:" + ip);
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await admin.from("launcher_auth_attempts").select("id", { count: "exact", head: true }).eq("ip_hash", h).gte("at", since);
  await admin.from("launcher_auth_attempts").insert({ ip_hash: h });
  return (count ?? 0) < 10;
}
