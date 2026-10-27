import { admin, body, ok, preflight, requireSession } from "../_shared/lib.ts";
Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const r = await requireSession(req, await body(req));
  if (r.error) return r.error;
  const { data } = await admin.from("promo_redemptions").select("id, code, at, promo_codes(title, reward_kind, reward_amount, reward_name, reward_image)")
    .eq("auth_user_id", r.session.auth_user_id).order("at", { ascending: false }).limit(50);
  return ok((data ?? []).map((x: any) => ({ id: x.id, code: x.code, title: x.promo_codes?.title ?? x.code, at: x.at,
    reward: { kind: x.promo_codes?.reward_kind, amount: x.promo_codes?.reward_amount ?? undefined, name: x.promo_codes?.reward_name || undefined, image: x.promo_codes?.reward_image || undefined } })));
});
