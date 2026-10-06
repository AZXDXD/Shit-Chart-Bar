import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../js/login-controls.js', import.meta.url), 'utf8').replace("import('./auth.js')", 'loadAuth()');
async function scenario(fail = false) {
  let listener, imports = 0;
  const calls = [], logs = [];
  const message = { style: {} };
  const context = vm.createContext({
    document: { querySelectorAll() { return []; }, addEventListener(event, fn) { assert.equal(event,'click'); listener = fn; }, getElementById(id) { return id === 'authError' ? message : null; } },
    console: { log(...args) { logs.push(args); }, error(...args) { logs.push(args); } },
    setTimeout() { return 1; }, clearTimeout() {},
    async loadAuth() { imports++; if(fail) throw new Error('CDN blocked'); return { async loginWithGoogle() { calls.push('google'); }, async loginWithDiscord() { calls.push('discord'); } }; },
  });
  vm.runInContext(source, context);
  await listener({target:{closest(){return null;}}});
  for (const provider of ['google','discord']) await listener({target:{closest(){return {dataset:{oauth:provider}};}},preventDefault(){}});
  assert.equal(imports, 2);
  assert.ok(logs.some(args=>args[0]==='Google login clicked'));
  assert.ok(logs.some(args=>args[0]==='Discord login clicked'));
  if(fail) { assert.deepEqual(calls,[]); assert.match(message.textContent,/CDN blocked/); assert.equal(message.hidden,false); }
  else assert.deepEqual(calls,['google','discord']);
}
await scenario(); await scenario(true);
console.log('PASS: delegated Google/Discord click handlers, missing buttons, module failure feedback and retry.');
