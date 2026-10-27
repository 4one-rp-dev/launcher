'use strict';
const crypto = require('crypto');
const { fail, ok } = require('../../core/contract');
const config = require('../config');
const { createHttp } = require('./http');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Клиент OAuth 2.0 (Authorization Code + PKCE, RFC 7636/8252) к Core API.
 * Пароль вводится только на странице входа в системном браузере и в лаунчер не попадает:
 * лаунчер получает одноразовый код по ссылке gta4one://auth/callback и меняет его на токены.
 */
function createOAuthClient(opts) {
  const o = opts || {};
  const base = (o.url || config.core.url).replace(/\/+$/, '');
  const clientId = o.clientId || config.core.clientId;
  const redirectUri = o.redirectUri || config.core.redirectUri;
  const timeoutMs = o.timeoutMs || config.core.timeoutMs;
  const doFetch = o.fetch || globalThis.fetch;
  const log = o.log;

  /** Новая попытка входа: verifier остаётся в лаунчере, challenge уходит на сайт. */
  function newFlow(deviceName) {
    const verifier = b64url(crypto.randomBytes(48));
    const state = b64url(crypto.randomBytes(24));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const q = new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state,
      code_challenge: challenge, code_challenge_method: 'S256',
    });
    if (deviceName) q.set('device_name', String(deviceName).slice(0, 80));
    return { verifier, state, url: `${base}/oauth/authorize?${q}` };
  }

  const { request } = createHttp({ url: base, timeoutMs, fetch: doFetch, log });

  const form = (obj) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: new URLSearchParams(obj).toString() });
  const toTokens = (d) => (d && d.access_token && d.refresh_token
    ? ok({ access: d.access_token, refresh: d.refresh_token, expiresAt: Date.now() + (Number(d.expires_in) || 900) * 1000 })
    : fail('login_failed'));

  return {
    newFlow,
    async exchangeCode(code, verifier) {
      const r = await request('/oauth/token', form({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier }));
      return r.ok ? toTokens(r.data) : (r.code === 'invalid_session' ? fail('login_failed') : r);
    },
    async refresh(refreshToken) {
      const r = await request('/oauth/token', form({ grant_type: 'refresh_token', client_id: clientId, refresh_token: refreshToken }));
      return r.ok ? toTokens(r.data) : r;
    },
    async me(access) {
      const r = await request('/v1/me', { headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' } });
      if (!r.ok) return r;
      return r.data && r.data.data ? ok(r.data.data) : fail('profile_lookup_failed');
    },
    async revoke(token) { return request('/oauth/revoke', form({ token, client_id: clientId })); },
  };
}

module.exports = { createOAuthClient };
