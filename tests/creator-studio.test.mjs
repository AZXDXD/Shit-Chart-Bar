import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { inspectEntries } from '../js/package-validation.js';
const entry = (name, bytes) => ({ name, async: async () => Uint8Array.from(bytes) });
const files = [entry('nested/map.UGC',[65]), entry('audio.wav',[82,73,70,70,0,0,0,0,87,65,86,69]), entry('jacket.png',[137,80,78,71,13,10,26,10])];
assert.equal((await inspectEntries(files)).missing.length,0);
for (const [index,message] of [[0,'譜面'],[1,'音源'],[2,'曲繪']]) {
  const result = await inspectEntries(files.filter((_,i) => i !== index));
  assert.equal(result.missing.length,1); assert.ok(result.missing[0].includes(message));
}
assert.equal((await inspectEntries([entry('fake.mp3',[1]),entry('fake.png',[1]),entry('empty.ugc',[])])).missing.length,3);
const rows = []; let savedProfile; let filters, operation, payload, table;
const query = {
  select() { return this; }, eq(k,v) { filters[k] = v; return this; }, order() { return this; },
  insert(v) { operation='insert'; payload=v; return this; }, update(v) { operation='update'; payload=v; return this; },
  upsert(v) { operation='upsert'; payload=v; return this; }, delete() { operation='delete'; return this; },
  single() { return this; },
  then(resolve) {
    if (table === 'profiles') { savedProfile={...savedProfile,...payload}; return Promise.resolve({data:savedProfile}).then(resolve); }
    if (operation === 'insert') { rows.push({id:'chart-1',...payload}); return Promise.resolve({data:rows.at(-1)}).then(resolve); }
    const matches = rows.filter(r => Object.entries(filters).every(([k,v]) => r[k]===v));
    if (operation === 'delete') for (const row of matches) rows.splice(rows.indexOf(row),1);
    return Promise.resolve({data:matches}).then(resolve);
  },
};
const context = vm.createContext({ currentUser: {id:'google-uuid',user_metadata:{name:'Google Name'}}, setCurrentProfile(p) { savedProfile=p; }, getStorageUrl() {return null;}, supabase: { from(t) { table=t; filters={}; operation='select'; return query; } } });
vm.runInContext(fs.readFileSync(new URL('../js/api.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,''),context);
const run = expr => vm.runInContext(expr,context);
assert.equal((await run("getChartsByUser('google-uuid',true)")).length,0);
await run("createChart({title:'Real submission',user_id:'forged'})");
assert.equal(rows[0].user_id,'google-uuid');
assert.equal((await run("getChartsByUser('google-uuid',true)")).length,1);
await run("updateProfile({charter_name:'Custom',avatar_url:'https://example.com/custom.png'})");
assert.equal(savedProfile.id,'google-uuid'); assert.equal(savedProfile.charter_name,'Custom');
context.currentUser={id:'discord-uuid',user_metadata:{name:'Discord Name'}};
assert.equal((await run("getChartsByUser('discord-uuid',true)")).length,0);
await assert.rejects(run("getChartsByUser('google-uuid',true)"));
await run("deleteChart('chart-1')"); assert.equal(rows.length,1);
context.currentUser={id:'google-uuid'}; await run("deleteChart('chart-1')"); assert.equal(rows.length,0);
context.currentUser=null; await assert.rejects(run('createChart({})')); await assert.rejects(run("deleteChart('chart-1')"));
const html=fs.readFileSync(new URL('../charter_studio.html',import.meta.url),'utf8');
for (const title of ['Calamity Fortune','End Time','Arcaea (WIP)','Kagami (鏡)','ci-meta','dlData']) assert.ok(!html.includes(title),title);
assert.ok(html.includes('js/pages/charter_studio.js')); assert.ok(html.includes('id="myChartList"'));
console.log('PASS: missing files, byte signatures, empty/new account, UUID submission binding, account isolation, profile persistence payload, deletion refresh queries, guest guards, demo removal. Database calls mocked; live RLS/OAuth not tested.');
