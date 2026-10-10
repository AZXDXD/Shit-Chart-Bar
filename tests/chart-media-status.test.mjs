import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {renderChartMediaStatus,hasChartVideo} from '../js/chart-media-status.js';
import {chartLevel,renderWeAttribute} from '../js/chart-metadata.js';
for(const strip of [false,true])for(const video of [false,true]) {
 const html=renderChartMediaStatus({strip_path:strip?'strips/chart.png':null,youtube_url:video?'https://youtu.be/abc':null});
 assert.match(html,new RegExp(strip?'有展示譜':'無展示譜'));assert.match(html,new RegExp(video?'有影片':'無影片'));
 assert.equal((html.match(/class="media-status /g)||[]).length,2);
 assert.ok(html.indexOf('展示譜')<html.indexOf('影片'));
}
for(const value of [null,'','   ','garbage','javascript:alert(1)','data:text/html,x'])assert.equal(hasChartVideo(value),false);
assert.equal(hasChartVideo('https://www.youtube.com/watch?v=abc'),true);
assert.match(renderChartMediaStatus({strip_path:'   ',youtube_url:'bad'}),/無展示譜/);
const source=fs.readFileSync('js/pages/index.js','utf8');
const ctx=vm.createContext({renderChartMediaStatus,chartLevel,renderWeAttribute,window:{addEventListener(){}},document:{addEventListener(){}},renderChartCover:()=>'',escapeHtml:String});
vm.runInContext(source.replace(/^import .*;\r?\n/gm,''),ctx);
const card=ctx.renderCard({id:'true-uuid',title:'T',difficulty:'WORLDS_END',we_star_level:3,we_attribute:'狂',avg_rating:0,strip_path:'strip.png',youtube_url:'https://youtu.be/abc'});
assert.match(card,/chart_detail.html\?id=true-uuid/);assert.match(card,/★★★/);assert.match(card,/>狂</);
assert.doesNotMatch(card,/<button|card-hover/);assert.match(card,/有展示譜/);assert.match(card,/有影片/);
assert.doesNotMatch(source,/handleDownload|downloadChart|card-hover-actions|btn-dl/);
assert.match(fs.readFileSync('index.html','utf8'),/chart-card:hover .card-cover-img/);
// The search RPC has no video field: ensure one batched SELECT hydrates real IDs.
let batched=0;
const apiCtx=vm.createContext({getStorageUrl:()=>null,supabase:{
 rpc:async()=>({data:{charts:[{id:'a',strip_path:'existing'},{id:'b',strip_path:null}],total_count:2}}),
 from(table){assert.equal(table,'charts');return {select(fields){assert.equal(fields,'id, strip_path, youtube_url');return {in:async(key,ids)=>{batched++;assert.equal(key,'id');assert.deepEqual(Array.from(ids),['a','b']);return {data:[{id:'a',strip_path:'real',youtube_url:'https://youtu.be/abc'},{id:'b',strip_path:null,youtube_url:null}]};}};}};}
}});
vm.runInContext(fs.readFileSync('js/api.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ',''),apiCtx);
const result=await apiCtx.searchCharts({difficulties:[]});assert.equal(batched,1);assert.equal(result.totalCount,2);
assert.match(renderChartMediaStatus(result[0]),/有影片/);assert.match(renderChartMediaStatus(result[1]),/無影片/);
assert.equal(result[0].strip_path,'real');
for(const file of ['js/pages/charter_studio.js','js/pages/chart-detail.js'])assert.match(fs.readFileSync(file,'utf8'),/renderChartMediaStatus\(/);
console.log('PASS: four strip/video combinations, invalid URLs, shared card rendering, UUID navigation, preserved WE badges/hover, removed card controls, batched real-field hydration and total metadata.');
