import { body, ok, preflight, requireSession, toProfile } from "../_shared/lib.ts";
Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const r = await requireSession(req, await body(req));
  if (r.error) return r.error;
  return ok({ profile: toProfile(r.profile) });
});
