import { supabase } from './supabase.js';
export let currentUser = null;
export let currentProfile = null;
let initialization, revision = 0, signingIn = false;

function applySession(session, event = 'INITIAL_SESSION') {
  const previousId = currentUser?.id;
  currentUser = session?.user ?? null;
  const userChanged = previousId !== currentUser?.id;
  if (userChanged) currentProfile = null;
  const version = userChanged ? ++revision : revision;
  updateAllAuthUI();
  if (currentUser) {
    closeLoginModal();
    if (previousId !== currentUser.id) onLoginSuccess(currentUser, null);
    if (event === 'SIGNED_IN' || (event === 'INITIAL_SESSION' && userChanged)) debugUser(currentUser, event);
    if (!userChanged) return;
    const id = currentUser.id;
    // Defer database requests outside the synchronous auth callback to avoid deadlock.
    setTimeout(async () => {
      const profile = await fetchProfile(id);
      if (version !== revision) return;
      currentProfile = profile;
      updateAllAuthUI();
    }, 0);
  } else if (previousId) onLogout();
}

export function initAuth() {
  if (initialization) return initialization;
  initialization = (async () => {
    const url = new URL(location.href);
    const hash = new URLSearchParams(url.hash.slice(1));
    const errorMessage = url.searchParams.get('error_description') || hash.get('error_description') || url.searchParams.get('error') || hash.get('error');
    if (errorMessage) {
      showAuthError('登入未完成：' + errorMessage);
      for (const key of ['error', 'error_code', 'error_description']) url.searchParams.delete(key);
      url.hash = '';
      history.replaceState(null, '', url.pathname + url.search);
    }
    supabase.auth.onAuthStateChange((event, session) => {
      if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) applySession(session, event);
    });
    const version = revision;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      if (version === revision) applySession(data.session);
    } catch (error) {
      console.error('[Auth] session:', error);
      showAuthError('無法確認登入狀態：' + error.message);
    }
  })();
  return initialization;
}

export async function fetchProfile(id) {
  try {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle();
    if (error) console.warn('[Auth] profile unavailable:', error.message);
    return data ?? null;
  } catch (error) {
    console.warn('[Auth] profile unavailable:', error.message);
    return null;
  }
}

export function getOAuthRedirectUrl() {
  // Use the page where login starts in every environment. Keeping pathname
  // preserves GitHub Pages /Shit-Chart-Bar/ and keeping search preserves chart ids.
  // Never fall back to a development URL or use origin alone.
  const url = new URL(window.location.href);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('請使用 localhost 或正式 HTTPS 網址，不能使用 file:// 開啟網站');
  url.hash = '';
  for (const key of ['code', 'error', 'error_code', 'error_description', 'access_token', 'refresh_token', 'provider_token', 'provider_refresh_token', 'token_type', 'expires_in', 'expires_at']) url.searchParams.delete(key);
  return url.href;
}
async function login(provider) {
  if (signingIn) return;
  signingIn = true;
  const buttons = document.querySelectorAll('[data-oauth]');
  buttons.forEach(el => { el.disabled = true; });
  const errorEl = document.getElementById('authError');
  if (errorEl) { errorEl.hidden = true; errorEl.style.display = 'none'; }
  try {
    const redirectTo = getOAuthRedirectUrl();
    console.log('[Auth] signInWithOAuth:', provider);
    console.log('[Auth] OAuth redirectTo:', redirectTo);
    const { error } = await supabase.auth.signInWithOAuth({ provider,
      // Supabase's Discord provider already requests identify + email.
      options: { redirectTo },
    });
    if (error) throw error;
  } catch (error) {
    console.error('[Auth] OAuth failed (' + provider + '):', error);
    showAuthError('登入失敗：' + error.message);
  } finally {
    signingIn = false;
    buttons.forEach(el => { el.disabled = false; });
  }
}
export function loginWithGoogle() { return login('google'); }
export function loginWithDiscord() { return login('discord'); }
export async function logout() {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    applySession(null);
    document.getElementById('userDropdown')?.classList.remove('open');
  } catch (error) {
    console.error('[Auth] signOut:', error);
    showAuthError('登出失敗：' + error.message);
  }
}
export function getUserDisplayData(user = currentUser, profile = currentProfile) {
  const metadata = user?.user_metadata ?? {};
  const issuer = metadata.iss || '';
  const provider = issuer.includes('discord.com') ? 'discord' : issuer.includes('accounts.google.com') ? 'google' : user?.app_metadata?.provider || '';
  const discordName = metadata.custom_claims?.global_name || metadata.global_name || metadata.full_name || metadata.preferred_username || metadata.username || metadata.name;
  return {
    id: user?.id ?? null,
    email: user?.email || metadata.email || '',
    provider,
    name: profile?.charter_name || profile?.username || (provider === 'discord' ? discordName : metadata.full_name || metadata.name) || user?.email || '使用者',
    avatar: profile?.avatar_url || metadata.avatar_url || metadata.picture || '',
  };
}
function debugUser(user, event) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(location.href).hostname)) return;
  // Only a whitelist of basic identity fields; never log raw user/session objects.
  const metadata = user.user_metadata ?? {};
  const safeMetadata = {};
  for (const key of ['sub', 'provider_id', 'iss', 'email', 'email_verified', 'full_name', 'name', 'username', 'preferred_username', 'global_name', 'avatar_url', 'picture']) {
    if (['string', 'boolean'].includes(typeof metadata[key])) safeMetadata[key] = metadata[key];
  }
  if (typeof metadata.custom_claims?.global_name === 'string') safeMetadata.custom_claims = { global_name: metadata.custom_claims.global_name };
  console.debug('[Auth] user (safe fields)', { event, ...getUserDisplayData(user, null), user_metadata: safeMetadata });
}
export function updateAllAuthUI() {
  const loggedIn = !!currentUser;
  document.querySelectorAll('[data-auth="guest"]').forEach(el => { el.style.display = loggedIn ? 'none' : ''; });
  document.querySelectorAll('[data-auth="user"]').forEach(el => { el.style.display = loggedIn ? (el.tagName === 'SPAN' ? 'inline-flex' : '') : 'none'; });
  const { name, avatar, email, provider } = getUserDisplayData();
  document.querySelectorAll('[data-user="name"]').forEach(el => { el.textContent = loggedIn ? name : ''; el.title = loggedIn ? [provider, email].filter(Boolean).join(' · ') : ''; });
  document.querySelectorAll('[data-user="email"]').forEach(el => { el.textContent = loggedIn ? email : ''; });
  document.querySelectorAll('[data-user="avatar"]').forEach(el => {
    if (loggedIn && avatar && /^https?:\/\//i.test(avatar)) { el.src = avatar; el.style.display = ''; }
    else { el.removeAttribute('src'); el.style.display = 'none'; }
  });
  document.querySelectorAll('[data-user="platform"]').forEach(el => { el.textContent = loggedIn ? (provider === 'discord' ? 'Discord 帳號' : provider === 'google' ? 'Google 帳號' : '已登入') : ''; });
}
export function requireAuth(callback) { if (currentUser) return callback(currentUser, currentProfile); openLoginModal(); }
export function openLoginModal() {
  const modal = document.getElementById('loginModal') || document.getElementById('modalOverlay');
  modal?.classList.add('open');
  if (modal?.id === 'loginModal') modal.style.display = 'flex';
}
export function closeLoginModal() {
  const modal = document.getElementById('loginModal') || document.getElementById('modalOverlay');
  modal?.classList.remove('open');
  if (modal?.id === 'loginModal') modal.style.display = 'none';
}
function showAuthError(message) {
  openLoginModal();
  const modal = document.getElementById('loginModal') || document.getElementById('modalOverlay');
  if (!modal) { alert(message); return; }
  let el = document.getElementById('authError');
  if (!el) {
    el = document.createElement('p'); el.id = 'authError'; el.setAttribute('role', 'alert');
    el.style.cssText = 'color:#ff9999;font-size:13px;overflow-wrap:anywhere;';
    modal.firstElementChild.appendChild(el);
  }
  el.textContent = message; el.hidden = false; el.style.display = 'block';
}
export function onLoginSuccess(user, profile) { window.dispatchEvent(new CustomEvent('authLogin', { detail: { user, profile } })); }
export function onLogout() { window.dispatchEvent(new CustomEvent('authLogout')); }
Object.assign(window, { loginWithGoogle, loginWithDiscord, logout, openLoginModal, closeLoginModal, requireAuth });
function start() { initAuth().catch(error => console.error('[Auth] initialization:', error)); }
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
