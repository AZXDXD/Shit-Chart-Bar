import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { chartLevel, difficultyMetadata } from '../js/chart-metadata.js';

for (const rating of [14.7,16,16.1,17,1234.5]) {
  const m=difficultyMetadata('MASTER',String(rating),3,'stale');
  assert.equal(m.rating,rating); assert.equal(m.we_star_level,null); assert.equal(m.we_attribute,null);
  assert.equal(chartLevel(m),String(rating));
}
for (const stars of [1,3,5]) for (const attribute of ['狂','招','任意新的自訂 Attribute']) {
  const m=difficultyMetadata('WORLDS_END','17',stars,` ${attribute} `);
  assert.equal(m.rating,null); assert.equal(m.we_attribute,attribute);
  assert.equal(chartLevel(m),'★'.repeat(stars));
}
for(const stars of [0,6,1.5,'']) assert.throws(()=>difficultyMetadata('WORLDS_END',null,stars,'狂'));
for(const attr of ['','   ','字'.repeat(21)]) assert.throws(()=>difficultyMetadata('WORLDS_END',null,3,attr));
for(const rating of ['',0,-1,Infinity,NaN,16.15]) assert.throws(()=>difficultyMetadata('MASTER',rating,1,''));
assert.equal(chartLevel({difficulty:'WORLDS_END',rating:14.7,we_attribute:null}),'星數待補');

const calls=[];
const api=fs.readFileSync('js/api.js','utf8').replace(/^import[^;]*;\r?\n/gm,'').replace(/\bexport /g,'');
const context=vm.createContext({supabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:[],error:null};}}});
vm.runInContext(api,context);
await vm.runInContext("searchCharts({difficulty:'MASTER',minRating:16.1,tagId:42,page:2,sortBy:'avg_rating'})",context);
assert.equal(calls[0].args.max_r,null);assert.equal(calls[0].args.min_r,16.1);
assert.equal(calls[0].args.tag_filter,42);assert.equal(calls[0].args.page_offset,40);assert.equal(calls[0].args.sort_by,'avg_rating');
await vm.runInContext("searchCharts({difficulty:'WORLDS_END',minRating:17,maxRating:20,weStarLevel:3,weAttribute:'狂',query:'song',tagId:42})",context);
assert.equal(calls[1].args.min_r,null);assert.equal(calls[1].args.max_r,null);
assert.equal(calls[1].args.we_star_filter,3);assert.equal(calls[1].args.we_attribute_filter,'狂');assert.equal(calls[1].args.query,'song');
await vm.runInContext("searchCharts({difficulty:'MASTER',weStarLevel:3,weAttribute:'stale'})",context);
assert.equal(calls[2].args.we_star_filter,null);assert.equal(calls[2].args.we_attribute_filter,null);
console.log('PASS: metadata validation, uncapped constants, WE stars/attributes, stale field clearing, legacy rendering, RPC constant/WE isolation, tags, keyword, sort, pagination. No live writes.');
