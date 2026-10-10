import { renderChartMediaStatus } from '../js/chart-media-status.js';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { chartLevel, renderWeAttribute } from '../js/chart-metadata.js';
const elements=new Map();
function element(id){
  if(!elements.has(id))elements.set(id,{style:{},innerHTML:'',textContent:'',replaceChildren(){this.innerHTML='';this.textContent='';},insertAdjacentHTML(position,html){this.innerHTML+=html;}});
  return elements.get(id);
}
const events={},calls=[];
let reply;
const ctx=vm.createContext({renderChartMediaStatus,chartLevel,renderWeAttribute,console,location:{hash:'#favorites'},currentUser:{id:'a'},
  window:{addEventListener(name,fn){events[name]=fn;}},
  document:{addEventListener(){},getElementById:element,querySelectorAll:()=>[]},
  renderChartCover:()=>'',escapeHtml:value=>String(value??''),
  getMyFavorites:async options=>{calls.push(options);return new Promise(resolve=>{reply=resolve;});},
  searchCharts:async()=>{throw Error('Favorites must not search public charts');},
});
vm.runInContext(fs.readFileSync('js/pages/index.js','utf8').replace(/^import .*;\r?\n/gm,''),ctx);
ctx.updateListMode();
assert.equal(element('searchSection').hidden,true);
assert.equal(element('chartSectionTitle').textContent,'已收藏譜面');
const pending=ctx.loadCharts(true);
assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{page:0,limit:20});
ctx.currentUser=null;events.authLogout();
reply([{id:'private-a',title:'Old account favorite',avg_rating:0}]);
await pending;
assert.doesNotMatch(element('chartGrid').innerHTML,/Old account favorite/);
assert.match(element('chartGrid').textContent,/登入帳號/);
assert.equal(element('loadMoreBtn').style.display,'none');
ctx.currentUser={id:'b'};
const next=ctx.loadCharts(true);reply([]);await next;
assert.match(element('chartGrid').innerHTML,/目前沒有已收藏譜面/);
const filled=ctx.loadCharts(true);
reply([{id:'588ab3bc-14a4-4cf1-b6f5-b6598371196b',title:'Saved chart',avg_rating:0,difficulty:'ULTIMA',rating:14.7}]);
await filled;
assert.match(element('chartGrid').innerHTML,/chart_detail.html\?id=588ab3bc-14a4-4cf1-b6f5-b6598371196b/);
assert.doesNotMatch(element('chartGrid').innerHTML,/id=undefined|id=null/);
ctx.location.hash='';ctx.updateListMode();assert.equal(element('searchSection').hidden,false);
assert.equal(element('chartSectionTitle').textContent,'所有自製譜面');
const apiCtx=vm.createContext({currentUser:{id:'b'},getStorageUrl:()=>null,supabase:{from(table){assert.equal(table,'favorites');return {
  select(value){assert.match(value,/charts!inner/);return this;},eq(key,value){assert.equal(key,'user_id');assert.equal(value,'b');return this;},order(){return this;},range:async()=>({data:[{charts:null},{charts:{id:'chart-b',title:'B'}}]})
};}}});
vm.runInContext(fs.readFileSync('js/api.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ',''),apiCtx);
const charts=await apiCtx.getMyFavorites();assert.equal(charts.length,1);assert.equal(charts[0].id,'chart-b');
console.log('PASS: existing favorites query scopes current user, hides inaccessible charts, reuses home list and rejects stale account responses after logout. Mocked DOM/Supabase.');
