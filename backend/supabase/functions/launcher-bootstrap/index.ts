// Одним запросом: профиль, серверы, новости, версия клиента, объявление и флаги.
import { admin, body, ok, preflight, requireSession, toProfile } from "../_shared/lib.ts";
Deno.serve(async (req) => {
  const pre = preflight(req); if (pre) return pre;
  const r = await requireSession(req, await body(req));
  if (r.error) return r.error;
  const [servers, news, release, cfg] = await Promise.all([
    admin.from("launcher_servers").select("*").eq("published", true).order("sort"),
    admin.from("launcher_news").select("*").eq("published", true).order("published_at", { ascending: false }).limit(30),
    admin.from("launcher_client_releases").select("version, manifest_url, notes").eq("active", true).eq("channel", "stable").maybeSingle(),
    admin.from("launcher_config").select("key, value"),
  ]);
  const c = Object.fromEntries((cfg.data ?? []).map((x) => [x.key, x.value]));
  return ok({
    profile: toProfile(r.profile),
    servers: (servers.data ?? []).map((s) => ({ id: s.id, name: s.name, tag: s.tag, status: s.status, online: s.online, max: s.max_players, address: s.address, version: s.version, description: s.description, recommended: s.recommended })),
    news: (news.data ?? []).map((n) => ({ id: n.id, title: n.title, excerpt: n.excerpt, category: n.category, date: String(n.published_at).slice(0, 10), cover: n.cover, url: n.url })),
    client: release.data ? { version: release.data.version, manifestUrl: release.data.manifest_url, notes: release.data.notes } : null,
    notice: c.notice ?? null, flags: c.flags ?? {},
  });
});
