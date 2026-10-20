import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { defaultMyChartFilters, filterMyCharts, createMyChartSearch } from '../js/my-charts-search.js';
const rows = [
  {id:'a',user_id:'owner',title:'Alpha',charter_name:'Mapper',chart_tags:[{tags:{name:'速度'}}],difficulty:'MASTER',rating:14,status:'published',strip_path:'strip.png',youtube_url:'https://youtu.be/a',created_at:'2026-01-02',updated_at:'2026-01-04'},
  {id:'b',user_id:'owner',title:'Bravo',difficulty:'EXPERT',rating:12,status:'draft',created_at:'2026-01-03',updated_at:'2026-01-03'},
  {id:'c',user_id:'owner',title:'Charlie',difficulty:'WORLDS_END',we_star_level:3,status:'unpublished',strip_path:'strip.png',created_at:'2026-01-01',updated_at:'2026-01-05'},
];
const ids = changes => filterMyCharts(rows,{...defaultMyChartFilters(),...changes}).map(chart=>chart.id);
for (const query of ['alpha','MAPPER','速度']) assert.deepEqual(ids({query}),['a']);
assert.deepEqual(ids({difficulties:['MASTER','EXPERT']}),['b','a']);
assert.deepEqual(ids({difficulties:['WORLDS_END'],weStarLevel:3,minRating:16}),['c']);
assert.deepEqual(ids({difficulties:['WORLDS_END'],weStarLevel:5}),[]);
assert.deepEqual(ids({status:'unpublished'}),['b','c']);
assert.deepEqual(ids({status:'published',query:'速度',minRating:13,maxRating:15,strip:'yes',video:'yes'}),['a']);
assert.deepEqual(ids({strip:'yes',video:'no'}),['c']);
assert.deepEqual(ids({sortBy:'oldest'}),['c','a','b']);
assert.deepEqual(ids({sortBy:'updated'}),['c','a','b']);
assert.deepEqual(ids({sortBy:'title_asc'}),['a','b','c']);

// Exercise real controller events, list pagination, post-mutation reload and stale auth handling.
const nodes=new Map(), listeners={};
const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',style:{},hidden:false,disabled:false,innerHTML:'',textContent:'',addEventListener(type,fn){listeners[id+':'+type]=fn;},querySelectorAll:()=>[],reset(){for(const id of ['myChartQuery','myChartMin','myChartMax','myChartStars','myChartStatus','myChartStrip','myChartVideo'])el(id).value='';el('myChartSort').value='newest';}});return nodes.get(id);};
globalThis.document={getElementById:el};
let user={id:'owner'}, data=Array.from({length:45},(_,i)=>({...rows[0],id:String(i),title:'Song '+i}));let stats;
const controller=createMyChartSearch({getUser:()=>user,fetchCharts:async()=>data,renderItem:chart=>`<row>${chart.id}</row>`,updateStats:charts=>stats=charts.length});
await controller.load();assert.equal(stats,45);assert.equal(el('myChartResultCount').textContent,'共 45 筆');assert.equal((el('myChartList').innerHTML.match(/<row>/g)||[]).length,20);
listeners['myChartNext:click']();assert.equal(el('myChartPageLabel').textContent,'第 2 / 3 頁');
el('myChartQuery').value='Song 44';listeners['myChartSearchForm:input']({target:{id:'myChartQuery'}});assert.equal(el('myChartResultCount').textContent,'共 1 筆');assert.match(el('myChartList').innerHTML,/>44</);assert.equal(el('myChartPagination').hidden,true);
// Edit result no longer matches; then clear, delete and reload.
data=data.map(chart=>chart.id==='44'?{...chart,title:'Edited'}:chart);await controller.load();assert.match(el('myChartList').innerHTML,/沒有符合搜尋/);
listeners['clearMyChartFilters:click']();assert.equal(el('myChartPageLabel').textContent,'第 1 / 3 頁');
data=data.filter(chart=>chart.id!=='44');await controller.load();assert.equal(el('myChartResultCount').textContent,'共 44 筆');
user=null;controller.reset();assert.match(el('myChartList').textContent,/請先登入/);assert.equal(el('myChartPagination').hidden,true);
let resolve;
const stale=createMyChartSearch({getUser:()=>user,fetchCharts:()=>new Promise(r=>resolve=r),renderItem:()=> 'SECRET',updateStats(){}});
user={id:'owner'};const request=stale.load();user={id:'other'};stale.reset();resolve(data);await request;assert.doesNotMatch(el('myChartList').innerHTML,/SECRET/);
delete globalThis.document;

// Fetch every owner's row, including drafts/tags beyond the first 200. No caller-supplied user ID.
const ranges=[],filters=[];const all=Array.from({length:205},(_,i)=>({...rows[i%3],id:'id-'+i}));
const api=vm.createContext({currentUser:{id:'owner'},getStorageUrl:()=>null,supabase:{from(table){assert.equal(table,'charts');return {select(value){assert.match(value,/chart_tags.*tags/);return this;},eq(key,value){assert.equal(key,'user_id');assert.equal(value,'owner');filters.push(value);return this;},order(){return this;},range:async(a,b)=>{ranges.push([a,b]);return {data:all.slice(a,b+1)};}};}}});
vm.runInContext(fs.readFileSync('js/api.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ',''),api);
assert.equal((await api.getMyChartsForManagement()).length,205);assert.deepEqual(ranges,[[0,199],[200,399]]);assert.equal(filters.length,2);
api.currentUser=null;assert.equal((await api.getMyChartsForManagement()).length,0);
const source=fs.readFileSync('js/pages/charter_studio.js','utf8');
for(const action of ['saveDraft','removeChart','unpublishChart','publishExisting']) assert.match(source.slice(source.indexOf('window.'+action+' ='),source.indexOf('window.'+action+' =')+2000),/loadMyCharts/);
assert.match(source,/renderChartMediaStatus\(chart, 'inline'\)/);
console.log('PASS: song/mapper/tags, OR difficulties, WE/constant, status includes draft/unpublished, media/AND, all sorts, 45-row pagination/reset/clear, edit/delete reload, guest/stale account guard, complete 205-row owner query. DOM/DB mocked.');
