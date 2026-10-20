import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { defaultFavoriteFilters, filterFavorites } from '../js/favorites-search.js';
const rows = [
  {id:'a',title:'Alpha',charter_name:'Mapper',profiles:{charter_name:'Creator'},difficulty:'MASTER',rating:14,strip_path:'strip.png',youtube_url:'https://youtu.be/a',favorite_created_at:'2026-01-02'},
  {id:'b',title:'Bravo',charter_name:'Other',difficulty:'EXPERT',rating:12,strip_path:null,youtube_url:null,favorite_created_at:'2026-01-03'},
  {id:'c',title:'Charlie',profiles:{username:'Account'},difficulty:'WORLDS_END',we_star_level:3,rating:null,strip_path:'strip.png',youtube_url:'invalid',favorite_created_at:'2026-01-01'},
];
const ids = (changes={}) => filterFavorites(rows,{...defaultFavoriteFilters(),...changes}).map(c=>c.id);
for (const query of ['alpha','MAPPER',' creator ']) assert.deepEqual(ids({query}),['a']);
assert.deepEqual(ids({query:'account'}),['c']);
assert.deepEqual(ids({difficulties:['MASTER','EXPERT']}),['b','a']);
assert.deepEqual(ids({difficulties:['WORLDS_END'],weStarLevel:3,minRating:16}),['c']);
assert.deepEqual(ids({difficulties:['MASTER','WORLDS_END'],minRating:14,maxRating:15,weStarLevel:3}),['a','c']);
assert.deepEqual(ids({strip:'yes',video:'no'}),['c']);
assert.deepEqual(ids({strip:'no',video:'no',query:'bravo',difficulties:['EXPERT'],minRating:11,maxRating:13}),['b']);
assert.deepEqual(ids({video:'yes'}),['a']);
assert.deepEqual(ids({sortBy:'oldest'}),['c','a','b']);
assert.deepEqual(ids({sortBy:'title_asc'}),['a','b','c']);
assert.deepEqual(ids({sortBy:'title_desc'}),['c','b','a']);
assert.deepEqual(ids({weStarLevel:5,difficulties:['WORLDS_END']}),[]);

// Real API pagination: the match at offset 204 must be included, with owner scoping on every batch.
const all = Array.from({length:205},(_,i)=>({chart_id:'id-'+i,created_at:'2026-01-01',charts:{...rows[0],id:'id-'+i,title:i===204?'Beyond first page':'Song '+i}}));
const ranges=[];let filters={},operation;
const query={ select(value){assert.match(value,/charts!inner/);assert.match(value,/profiles:user_id/);return this;},eq(k,v){filters[k]=v;return this;},order(){return this;},async range(a,b){assert.equal(filters.user_id,'owner');ranges.push([a,b]);return {data:all.slice(a,b+1)};},delete(){operation='delete';return this;},then(resolve){assert.equal(operation,'delete');assert.equal(filters.user_id,'owner');assert.equal(filters.chart_id,'id-204');return Promise.resolve({error:null}).then(resolve);} };
const api = vm.createContext({currentUser:{id:'owner'},getStorageUrl:()=>null,supabase:{from(table){assert.equal(table,'favorites');filters={};return query;}}});
vm.runInContext(fs.readFileSync('js/api.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ',''),api);
const collection=await api.getAllMyFavorites();assert.equal(collection.length,205);assert.deepEqual(ranges,[[0,199],[200,399]]);
assert.equal(filterFavorites(collection,{...defaultFavoriteFilters(),query:'beyond'})[0].id,'id-204');
await api.removeMyFavorite('id-204');
api.currentUser=null;assert.equal((await api.getAllMyFavorites()).length,0);await assert.rejects(api.removeMyFavorite('id-204'));

// Actual page controller: filtering precedes 20-card pages; changing filters resets pagination.
const elements=new Map();const listeners={};
const el=id=>{if(!elements.has(id))elements.set(id,{value:'',hidden:false,style:{},innerHTML:'',textContent:'',replaceChildren(){this.innerHTML='';},insertAdjacentHTML(_,html){this.innerHTML+=html;},addEventListener(type,fn){listeners[id+':'+type]=fn;},querySelectorAll:()=>[],reset(){for(const key of ['favoriteQuery','favoriteMin','favoriteMax','favoriteStars','favoriteStrip','favoriteVideo'])el(key).value='';el('favoriteSort').value='newest';}});return elements.get(id);};
const events={};let removed;
const context=vm.createContext({defaultFavoriteFilters,filterFavorites,console,setTimeout,clearTimeout,location:{hash:'#favorites'},currentUser:{id:'owner'},window:{addEventListener:(type,fn)=>events[type]=fn},document:{addEventListener(){},getElementById:el,querySelectorAll:()=>[]},getAllMyFavorites:async()=>collection.filter(c=>c.id!==removed),removeMyFavorite:async id=>{removed=id;},escapeHtml:String});
vm.runInContext(fs.readFileSync('js/pages/index.js','utf8').replace(/^import .*;\r?\n/gm,''),context);
vm.runInContext('renderCard=chart=>`<card>${chart.id}</card>`',context);
context.updateListMode();context.initializeFavoriteSearch();
await context.loadCharts(true);assert.equal((el('chartGrid').innerHTML.match(/<card>/g)||[]).length,20);assert.equal(el('resultCount').textContent,'共 205 筆');
await context.loadCharts(false);assert.equal((el('chartGrid').innerHTML.match(/<card>/g)||[]).length,40);
el('favoriteQuery').value='beyond';listeners['favoriteSearchForm:change']();await new Promise(r=>setImmediate(r));
assert.match(el('chartGrid').innerHTML,/id-204/);assert.equal(el('resultCount').textContent,'共 1 筆');assert.equal(el('loadMoreBtn').style.display,'none');
const button={dataset:{removeFavorite:'id-204'},disabled:false};let stopped=false;
await listeners['chartGrid:click']({target:{closest:()=>button},preventDefault(){},stopPropagation(){stopped=true;}});
assert.equal(removed,'id-204');assert.ok(stopped);assert.equal(el('resultCount').textContent,'0 筆');assert.match(el('chartGrid').innerHTML,/清除篩選/);
listeners['clearFavoriteFilters:click']();await new Promise(r=>setImmediate(r));assert.equal(el('resultCount').textContent,'共 204 筆');
context.currentUser=null;events.authLogout();assert.match(el('chartGrid').textContent,/登入帳號/);
assert.equal(el('loadMoreBtn').style.display,'none');
console.log('PASS: complete owner-scoped collection beyond 200, creator/song/mapper search, OR difficulties, AND combinations, WE/constant separation, media, all sorts, pagination/reset, removal/count, clear and guest guard. DOM/Supabase mocked.');
