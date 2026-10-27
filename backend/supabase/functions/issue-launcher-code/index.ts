// Вызывается САЙТОМ (кнопка «Получить код для лаунчера» в личном кабинете). Требует JWT пользователя сайта.
// Фронт сайта: const { data } = await supabase.functions.invoke('issue-launcher-code'); показать data.code и ссылку gta4one://auth?code=<code>
import { admin, ok, err, preflight, randomCode, sha256 } from "../_shared/lib.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
  const { data: u } = await userClient.auth.getUser(jwt);
  if (!u?.user) return err("invalid_session", 401);

  // не чаще одного кода в 15 секунд; старые неиспользованные коды гасим
  const { data: last } = await admin.from("launcher_codes").select("created_at").eq("auth_user_id", u.user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - new Date(last.created_at).getTime() < 15_000) return err("busy", 429);
  await admin.from("launcher_codes").update({ used_at: new Date().toISOString() }).eq("auth_user_id", u.user.id).is("used_at", null);

  const code = randomCode(8);
  const { error } = await admin.from("launcher_codes").insert({ code_hash: await sha256(code), auth_user_id: u.user.id });
  if (error) return err("unknown", 500);
  return ok({ code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresInSec: 600 });
});
