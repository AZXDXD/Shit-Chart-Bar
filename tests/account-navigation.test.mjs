import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync('js/account-navigation.js', 'utf8');
for (const hash of ['', '#invalid', '#profile', '#manage', '#upload']) {
  const nodes = ['profile', 'manage', 'upload'].map(id => ({ id: 'page-' + id, dataset: { accountTab: id }, active: false, classList: { toggle(name, value) { nodes.find(n => n.classList === this).active = value; } }, setAttribute() {} }));
  const handlers = {};
  const context = vm.createContext({ URL, Set, location: { hash, pathname: '/repo/charter_studio.html', search: '', href: 'https://example.com/repo/charter_studio.html' }, document: { getElementById: () => ({}), querySelectorAll: selector => selector === '[data-account-link]' ? [] : nodes }, history: { replaceState(a,b,url) { context.location.hash = url.slice(url.indexOf('#')); }, pushState(a,b,url) { this.replaceState(a,b,url); } }, CustomEvent: class { constructor(type, opts) { this.type=type; this.detail=opts.detail; } }, window: { addEventListener(type, fn) { handlers[type]=fn; }, dispatchEvent() {} } });
  vm.runInContext(source, context);
  const check = id => { assert.equal(context.location.hash, '#' + id); assert.equal(nodes.filter(n => n.active).length, 1); assert.equal(nodes.find(n => n.active).id, 'page-' + id); };
  check(['#profile','#manage','#upload'].includes(hash) ? hash.slice(1) : 'profile');
  for (const id of ['manage','profile','upload','manage','profile']) { context.window.switchPage(id); check(id); }
  context.location.hash='#upload'; handlers.hashchange(); check('upload');
}
for (const page of ['index.html','chart_detail.html','charter_studio.html']) {
  const html=fs.readFileSync(page,'utf8');
  assert.ok(html.includes('src="js/site-header.js"'));
  assert.ok(!html.includes('data-account-link'));
  assert.equal((html.match(/src="js\/account-navigation.js"/g)||[]).length,1);
}
console.log('PASS: navigation without auth/modules, fallback, every tab, history/hash restore, shared header links.');
