// Единое состояние интерфейса. Экраны подписываются и перерисовывают только свои части.
export const S = {
  info: null,                                   // app:info
  auth: { authed: false, profile: null, offline: false, reason: '' },
  data: null,                                   // data:bootstrap { servers, news, client, selectedServerId, stale }
  game: null,                                   // game:state
  settings: {},
  update: { state: 'idle' },
  net: true,
  route: 'boot',
  booted: false,
};
const subs = new Set();
export function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }
export function patch(obj, what) { Object.assign(S, obj); subs.forEach((f) => { try { f(S, what); } catch (e) { console.error(e); } }); }

export const selectedServer = () => {
  const d = S.data; if (!d || !d.servers) return null;
  return d.servers.find((s) => s.id === d.selectedServerId) || d.servers[0] || null;
};
