import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { difficultyMetadata } from '../js/chart-metadata.js';
const source=fs.readFileSync('js/pages/charter_studio.js','utf8');
const nodes=new Map();
const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false});return nodes.get(id);};
let diff='MASTER'; const writes=[],errors=[];
const ctx=vm.createContext({window:{},document:{getElementById:el},getSelectedDiff:()=>diff,
  getVal:id=>String(el(id).value).trim(),difficultyMetadata,editingChartId:'chart',coverFile:null,stripFile:null,
  getSelectedTagNames:()=>['custom'],setChartTags:async()=>{},loadMyCharts:async()=>{},
  updateChart:async(id,payload)=>writes.push(payload),showToast:(text,type)=>{if(type==='error')errors.push(text);}});
vm.runInContext(source.slice(source.indexOf('function syncDifficultyFields()')),ctx);
vm.runInContext(source.slice(source.indexOf('window.saveDraft ='),source.indexOf('// ── 管理後台')),ctx);
el('songTitle').value='Song';el('songComposer').value='Composer';el('ratingInput').value='17.0';
el('weStarLevel').value='3';el('weAttribute').value='狂';
vm.runInContext('syncDifficultyFields()',ctx);
assert.equal(el('normalMetadata').hidden,false);assert.equal(el('weMetadata').hidden,true);
await ctx.window.saveDraft();assert.equal(writes.at(-1).rating,17);assert.equal(writes.at(-1).we_attribute,null);
diff='WORLDS_END';vm.runInContext('syncDifficultyFields()',ctx);
assert.equal(el('normalMetadata').hidden,true);assert.equal(el('ratingInput').disabled,true);
await ctx.window.saveDraft();assert.equal(writes.at(-1).rating,null);assert.equal(writes.at(-1).we_star_level,3);assert.equal(writes.at(-1).we_attribute,'狂');
diff='MASTER';await ctx.window.saveDraft();assert.equal(writes.at(-1).we_star_level,null);assert.equal(writes.at(-1).we_attribute,null);
for(const write of writes) assert.ok(!('status' in write));assert.deepEqual(errors,[]);
console.log('PASS: real studio save handler and mode switching, 17.0, WE 3 stars, stale metadata cleared in both directions, no status writes. DOM/database mocked.');
