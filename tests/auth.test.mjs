import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const elements = new Map();
const element = () => ({ style: {}, classList: { add() {}, remove() {} }, removeAttribute() {}, setAttribute() {}, appendChild() {} });
const guest = element(), userUI = element(), name = element(), avatar = element(), platform = element();
const modal = element(); modal.id = 'modalOverlay'; modal.firstElementChild = element();
elements.set('modalOverlay', modal);
const selectors = { '[data-auth="guest"]': [guest], '[data-auth="user"]': [userUI], '[data-user="name"]': [name], '[data-user="avatar"]': [avatar], '[data-user="platform"]': [platform], '[data-oauth]': [] };
let listenerCount = 0; const debugLogs = []; let callback, oauthOptions, session = null, profileRequests = 0, signOutError = null;
const queued = [], events = [];
const supabase = {
  auth: {
    onAuthStateChange(fn) { listenerCount++; callback = fn; },
    async getSession() { return { data: { session }, error: null }; },
    async signInWithOAuth(options) { oauthOptions = options; return { error: null }; },
    async signOut() { if (!signOutError) { session = null; callback('SIGNED_OUT', null); } return { error: signOutError }; },
  },
  from() { profileRequests++; return { select() { return { eq() { return { async maybeSingle() { return { data: null, error: { message: 'profiles not installed' } }; } }; } }; } }; },
};
const context = vm.createContext({
  supabase, URL, URLSearchParams, console: { log() {}, error() {}, warn() {}, debug(...args) { debugLogs.push(args); } },
  location: { href: 'https://example.com/sub/chart_detail.html?id=42#charter' },
  history: { replaceState() {} }, alert(message) { throw new Error(message); },
  document: { readyState: 'loading', addEventListener() {}, getElementById(id) { return elements.get(id); }, querySelectorAll(selector) { return selectors[selector] || []; }, createElement() { return element(); } },
  setTimeout(fn) { queued.push(fn); }, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
  window: { dispatchEvent(event) { events.push(event); } },
});
context.window.location = context.location;
let source = fs.readFileSync(new URL('../js/auth.js', import.meta.url), 'utf8');
source = source.replace(/^import .*;\r?\n/m, '').replace(/\bexport /g, '');
vm.runInContext(source, context);
const run = expression => vm.runInContext(expression, context);
await run('initAuth()');
assert.equal(guest.style.display, ''); assert.equal(userUI.style.display, 'none');
assert.equal(run('getOAuthRedirectUrl()'), 'https://example.com/sub/chart_detail.html?id=42');
await run('loginWithGoogle()');
assert.equal(oauthOptions.provider, 'google'); assert.equal(oauthOptions.options.redirectTo, 'https://example.com/sub/chart_detail.html?id=42');
session = { user: { id: 'test-user', email: 'tester@example.com', user_metadata: { full_name: 'Google Tester', avatar_url: 'https://example.com/avatar.png' }, app_metadata: { provider: 'google' } } };
assert.equal(callback('SIGNED_IN', session), undefined);
assert.equal(profileRequests, 0, 'auth callback must not execute database requests');
assert.equal(name.textContent, 'Google Tester'); assert.equal(name.title, 'google · tester@example.com'); assert.equal(avatar.src, 'https://example.com/avatar.png');
assert.equal(guest.style.display, 'none'); assert.equal(userUI.style.display, '');
while (queued.length) await queued.shift()();
assert.equal(name.textContent, 'Google Tester', 'missing profiles must not break login');
callback('TOKEN_REFRESHED', session);
assert.equal(events.filter(e => e.type === 'authLogin').length, 1);
signOutError = new Error('network failure'); await run('logout()'); assert.equal(run('currentUser.id'), 'test-user');
signOutError = null; await run('logout()'); assert.equal(run('currentUser'), null); assert.equal(name.textContent, ''); assert.equal(userUI.style.display, 'none');
while (queued.length) await queued.shift()();
assert.equal(run('currentProfile'), null, 'stale profile must not restore signed-out state');
context.location.href = 'http://localhost:5500/index.html?error=denied&code=old#access_token=token';
assert.equal(run('getOAuthRedirectUrl()'), 'http://localhost:5500/index.html');
await run('initAuth()'); assert.equal(listenerCount, 1, 'initialization must reuse the listener');
context.location.href = 'http://localhost:5500/chart_detail.html?id=42';
await run('loginWithDiscord()');
assert.equal(oauthOptions.provider, 'discord');
assert.equal(oauthOptions.options.redirectTo, 'http://localhost:5500/chart_detail.html?id=42');
const discordUser = { id: 'discord-test', email: 'discord@example.com', app_metadata: { provider: 'discord' }, user_metadata: { iss: 'https://discord.com/api', full_name: 'discord_username', name: 'discord_username#0', custom_claims: { global_name: 'Discord Display', secret: 'must-not-log' }, provider_id: '123456', avatar_url: 'https://cdn.discordapp.com/avatar.png', access_token: 'must-not-log', refresh_token: 'must-not-log', secret: 'must-not-log' } };
session = { user: discordUser, access_token: 'must-not-log', refresh_token: 'must-not-log', provider_token: 'must-not-log' };
callback('INITIAL_SESSION', session);
assert.equal(name.textContent, 'Discord Display'); assert.equal(platform.textContent, 'Discord 帳號');
assert.equal(avatar.src, 'https://cdn.discordapp.com/avatar.png');
assert.equal(name.title, 'discord · discord@example.com');
while (queued.length) await queued.shift()();
const requestsBeforeRefresh = profileRequests;
callback('SIGNED_IN', session); callback('TOKEN_REFRESHED', session);
assert.equal(queued.length, 0); assert.equal(profileRequests, requestsBeforeRefresh);
assert.ok(debugLogs.length > 0); assert.equal(debugLogs.at(-1)[1].user_metadata.provider_id, '123456');
assert.ok(!JSON.stringify(debugLogs).includes('must-not-log'));
assert.equal(run('getUserDisplayData({id:"x",app_metadata:{provider:"discord"},user_metadata:{username:"username_only"}},null).name'), 'username_only');
assert.equal(run('getUserDisplayData({id:"x",app_metadata:{provider:"discord"},user_metadata:{iss:"https://accounts.google.com",full_name:"Google"}},null).provider'), 'google');
await run('logout()'); assert.equal(guest.style.display, '');
await run('loginWithGoogle()'); assert.equal(oauthOptions.provider, 'google');
callback('SIGNED_IN', {user:{...discordUser, id:'google-again',app_metadata:{provider:'google'},user_metadata:{full_name:'Google Again'}}});
assert.equal(name.textContent, 'Google Again'); assert.equal(platform.textContent, 'Google 帳號');
await run('logout()'); while (queued.length) await queued.shift()();
// Both providers must return to the exact starting page in Pages and local servers.
for (const startUrl of [
  'https://azxdxd.github.io/Shit-Chart-Bar/',
  'https://azxdxd.github.io/Shit-Chart-Bar/index.html',
  'https://azxdxd.github.io/Shit-Chart-Bar/chart_detail.html?id=42&sort=new',
  'https://azxdxd.github.io/Shit-Chart-Bar/charter_studio.html',
  'https://azxdxd.github.io/Shit-Chart-Bar/viewer.html?id=42',
  'http://localhost:5500/',
  'http://127.0.0.1:5500/chart_detail.html?id=42',
  'http://127.0.0.1:8080/Shit-Chart-Bar/viewer.html?id=42',
]) {
  context.location.href = startUrl;
  for (const provider of ['Google', 'Discord']) {
    await run(`loginWith${provider}()`);
    assert.equal(oauthOptions.provider, provider.toLowerCase());
    assert.equal(oauthOptions.options.redirectTo, startUrl);
  }
}
context.location.href = 'https://azxdxd.github.io/Shit-Chart-Bar/chart_detail.html?id=42&provider_token=old&provider_refresh_token=old&expires_in=3600&expires_at=1&token_type=bearer#access_token=old';
assert.equal(run('getOAuthRedirectUrl()'), 'https://azxdxd.github.io/Shit-Chart-Bar/chart_detail.html?id=42');
context.location.href = 'file:///index.html'; assert.throws(() => run('getOAuthRedirectUrl()'), /localhost/);

// A fresh page must recover Discord through getSession, without a new login redirect.
session = { user: discordUser };
context.location.href = 'http://localhost:5500/index.html';
const reloadContext = vm.createContext({ ...context });
vm.runInContext(source, reloadContext);
await vm.runInContext('initAuth()', reloadContext);
assert.equal(vm.runInContext('currentUser.id', reloadContext), 'discord-test');
assert.equal(name.textContent, 'Discord Display');
assert.equal(guest.style.display, 'none');
assert.equal(listenerCount, 2, 'one auth listener per page');
await vm.runInContext('initAuth()', reloadContext);
assert.equal(listenerCount, 2);
while (queued.length) await queued.shift()();

for (const file of ['index.html', 'chart_detail.html', 'charter_studio.html', 'viewer.html']) {
  const html = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  assert.equal((html.match(/src="js\/auth.js"/g) || []).length, 1, file + ': exactly one auth entry point');
  assert.equal((html.match(/src="js\/login-controls.js"/g) || []).length, 1, file + ': exactly one click entry point');
  assert.match(html, /data-oauth="google" onclick="loginWithGoogle\(\)"/);
  assert.match(html, /data-oauth="discord" onclick="loginWithDiscord\(\)"/);
  assert.match(html, /data-auth="guest"/); assert.match(html, /data-auth="user"/); assert.match(html, /logout\(\)/);
  for (const script of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(script[1], { filename: file });
}
const config = fs.readFileSync(new URL('../js/supabase.js', import.meta.url), 'utf8');
assert.match(config, /SUPABASE_URL\s*= 'https:\/\/wnjmtgefhgoshgmxmxbd.supabase.co'/);
const key = config.match(/SUPABASE_ANON\s*= '([^']+)'/)[1];
const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString());
assert.equal(claims.role, 'anon'); assert.equal(claims.ref, 'wnjmtgefhgoshgmxmxbd');
console.log('PASS: Google + Discord redirects, session restoration, one listener per page, auth events, safe debug metadata, profile fallback, logout errors, stale requests, all page buttons, inline syntax, public key claims.');
