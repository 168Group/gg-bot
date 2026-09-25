import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../../packages/core/src/config.js';
import { accessFor, canMutate, HttpError } from '../../../packages/core/src/access.js';
import { TokenVault, hash, opaque } from '../../../packages/core/src/crypto.js';
import type { StorageDriver } from '../../../packages/db/src/contracts.js';
import type { GuildStore } from '../../../packages/db/src/index.js';
import type { UserSession } from '../../../packages/module-sdk/src/browser.js';

export interface OAuthTokens { access_token: string; refresh_token: string; expires_at: number }
export interface IdentityProvider {
  exchange(code: string): Promise<OAuthTokens>;
  identity(tokens: OAuthTokens): Promise<{ id: string; username: string }>;
  membership(tokens: OAuthTokens): Promise<{ roles: string[]; tokens: OAuthTokens }>;
}
async function discordRequest(path: string, init: RequestInit) {
  const response = await fetch(`https://discord.com/api/v10${path}`, { ...init, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new HttpError(401, 'DISCORD_ACCESS', 'Discord could not confirm your access. Sign in again.');
  return response.json();
}
export function discordIdentity(config: Config, clientId: string, clientSecret: string): IdentityProvider {
  const token = async (params: Record<string, string>): Promise<OAuthTokens> => {
    const response = await discordRequest('/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    const parsed = z.object({ access_token: z.string(), refresh_token: z.string(), expires_in: z.number() }).parse(response);
    return { access_token: parsed.access_token, refresh_token: parsed.refresh_token, expires_at: Date.now() + parsed.expires_in * 1000 };
  };
  return {
    exchange: code => token({ grant_type: 'authorization_code', code, redirect_uri: `${config.DASHBOARD_ORIGIN}/auth/discord/callback` }),
    async identity(tokens) { return z.object({ id: z.string(), username: z.string() }).parse(await discordRequest('/users/@me', { headers: { authorization: `Bearer ${tokens.access_token}` } })); },
    async membership(previous) {
      const tokens = previous.expires_at <= Date.now() + 30000 ? await token({ grant_type: 'refresh_token', refresh_token: previous.refresh_token }) : previous;
      const member = z.object({ roles: z.array(z.string()) }).parse(await discordRequest(`/users/@me/guilds/${config.DISCORD_GUILD_ID}/member`, { headers: { authorization: `Bearer ${tokens.access_token}` } }));
      return { roles: member.roles, tokens };
    }
  };
}
export class Auth {
  private store: GuildStore;
  constructor(db: StorageDriver, private config: Config, private vault: TokenVault, private identity: IdentityProvider, readonly demo = false) {
    this.store = db.scope(config.DISCORD_GUILD_ID);
    if (demo && config.NODE_ENV === 'production') throw new Error('Fixture authentication is forbidden in production.');
  }
  private cookieOptions() { return { httpOnly: true, secure: this.config.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/', maxAge: 604800 }; }
  async createSession(reply: FastifyReply, user: { id: string; username: string }, tokens: OAuthTokens): Promise<string> {
    const member = await this.identity.membership(tokens);
    const access = accessFor(this.config, user.id, member.roles, true);
    if (!access) throw new HttpError(403, 'FORBIDDEN', 'Your account does not have dashboard access.');
    const id = opaque();
    await this.store.call('sessionCreate', { id_hash: hash(id), user_id: user.id, label: user.username, tokens: this.vault.encrypt(member.tokens), csrf_hash: hash(this.vault.csrf(id)), access });
    reply.setCookie('omo_session', id, this.cookieOptions());
    return id;
  }
  async authorize(request: FastifyRequest, mutation = false): Promise<UserSession> {
    const id = request.cookies.omo_session;
    if (!id) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in with Discord to continue.');
    const session = await this.store.call('sessionGet', { hash: hash(id) });
    if (!session) throw new HttpError(401, 'SESSION_EXPIRED', 'Your session expired. Sign in again.');
    if (mutation && (request.headers.origin !== this.config.DASHBOARD_ORIGIN || typeof request.headers['x-csrf-token'] !== 'string' || hash(request.headers['x-csrf-token']) !== session.csrf_hash)) {
      throw new HttpError(403, 'CSRF', 'This request could not be verified. Reload and try again.');
    }
    let access = session.access;
    if (mutation || !session.checked_at || Date.now() - new Date(session.checked_at).getTime() >= 60000) {
      try {
        const result = await this.identity.membership(this.vault.decrypt<OAuthTokens>(session.tokens));
        access = accessFor(this.config, session.user_id, result.roles, true);
        if (!access) throw new Error('Access revoked.');
        await this.store.call('sessionRefresh', { hash: session.id_hash, tokens: this.vault.encrypt(result.tokens), access });
      } catch {
        await this.store.call('sessionDelete', { hash: session.id_hash });
        throw new HttpError(403, 'ACCESS_REVOKED', 'Your Discord membership or dashboard access could not be confirmed.');
      }
    }
    if (!access || (mutation && !canMutate(access))) throw new HttpError(403, 'FORBIDDEN', 'Administrator access is required.');
    await this.store.call('sessionTouch', { hash: session.id_hash });
    return { userId: session.user_id, label: session.label, access, csrf: this.vault.csrf(id), guildId: this.config.DISCORD_GUILD_ID,
      communityName: this.config.COMMUNITY_NAME, botName: this.config.BOT_NAME, demo: this.demo };
  }
  register(app: FastifyInstance, clientId: string) {
    app.get('/auth/discord', async (_request, reply) => {
      const state = opaque();
      await this.store.call('oauthCreate', { hash: hash(state) });
      reply.setCookie('omo_oauth', state, { ...this.cookieOptions(), maxAge: 600 });
      const params = new URLSearchParams({ client_id: clientId, response_type: 'code', scope: 'identify guilds.members.read', state,
        redirect_uri: `${this.config.DASHBOARD_ORIGIN}/auth/discord/callback` });
      return reply.redirect(`https://discord.com/oauth2/authorize?${params}`);
    });
    app.get('/auth/discord/callback', async (request, reply) => {
      const query = z.object({ code: z.string().min(1).max(2048), state: z.string().min(40).max(100) }).parse(request.query);
      if (request.cookies.omo_oauth !== query.state) throw new HttpError(403, 'OAUTH_STATE', 'Login expired. Please try again.');
      const state = await this.store.call('oauthConsume', { hash: hash(query.state) });
      reply.clearCookie('omo_oauth', { path: '/' });
      if (!state) throw new HttpError(403, 'OAUTH_STATE', 'Login expired. Please try again.');
      const tokens = await this.identity.exchange(query.code);
      if (request.cookies.omo_session) await this.store.call('sessionDelete', { hash: hash(request.cookies.omo_session) });
      await this.createSession(reply, await this.identity.identity(tokens), tokens);
      return reply.redirect('/');
    });
    app.post('/auth/logout', async (request, reply) => {
      // Viewers may log out; apply CSRF without requiring administrator privileges.
      const user = await this.authorize(request);
      if (request.headers.origin !== this.config.DASHBOARD_ORIGIN || request.headers['x-csrf-token'] !== user.csrf) throw new HttpError(403, 'CSRF', 'This request could not be verified.');
      await this.store.call('sessionDelete', { hash: hash(request.cookies.omo_session!) });
      reply.clearCookie('omo_session', { path: '/' }); return { data: { loggedOut: true } };
    });
  }
}
