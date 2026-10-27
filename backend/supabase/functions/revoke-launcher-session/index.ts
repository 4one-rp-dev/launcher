import { admin, body, ok, preflight, requireSession } from "../_shared/lib.ts";
Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const r = await requireSession(req, await body(req));
  if (r.error) return ok();                                      // уже недействительна — выход считаем успешным
  await admin.from("launcher_sessions").update({ revoked_at: new Date().toISOString() }).eq("id", r.session.id);
  return ok();
});
