// Live diagnostic: starts OAuth and cancels it; never signs in or prints state/tokens.
const site = 'https://azxdxd.github.io/Shit-Chart-Bar/';
const project = 'https://wnjmtgefhgoshgmxmxbd.supabase.co';
const pages = await fetch('https://api.github.com/repos/AZXDXD/Shit-Chart-Bar/pages', { headers: { 'User-Agent': 'OAuth-redirect-diagnostic' } });
const pagesData = await pages.json();
console.log('GitHub Pages configuration:', pages.status, pagesData.html_url ?? pagesData.message);
const source = await (await fetch(new URL('js/auth.js', site))).text();
const helper = source.match(/export function getOAuthRedirectUrl\(\) \{[\s\S]*?\n\}/)?.[0];
if (!helper) throw new Error('Deployed redirect helper not found');
const redirectTo = Function('window', helper.replace('export ', '') + '; return getOAuthRedirectUrl();')({ location: { href: site } });
console.log('Deployed helper redirectTo:', redirectTo);
for (const provider of ['google', 'discord']) {
  const authorize = new URL('/auth/v1/authorize', project);
  authorize.searchParams.set('provider', provider);
  authorize.searchParams.set('redirect_to', redirectTo);
  const response = await fetch(authorize, { redirect: 'manual' });
  const destination = new URL(response.headers.get('location'));
  console.log(JSON.stringify({ provider, authorizeRequest: authorize.href, status: response.status, providerEndpoint: destination.origin + destination.pathname, providerCallback: destination.searchParams.get('redirect_uri') }));
  const state = destination.searchParams.get('state');
  if (!state) throw new Error('Provider state missing');
  const callback = new URL('/auth/v1/callback', project);
  callback.searchParams.set('state', state);
  callback.searchParams.set('error', 'access_denied');
  callback.searchParams.set('error_description', 'OAuth redirect diagnostic cancelled');
  const cancelled = await fetch(callback, { redirect: 'manual' });
  const finalUrl = new URL(cancelled.headers.get('location'));
  console.log(JSON.stringify({ provider, callbackStatus: cancelled.status, callbackLocation: finalUrl.origin + finalUrl.pathname, note: 'Cancellation callback; query/fragment withheld' }));
}
