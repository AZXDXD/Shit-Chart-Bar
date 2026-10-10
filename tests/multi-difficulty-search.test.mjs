import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const calls=[];
const ctx=vm.createContext({supabase:{rpc:async(name,args)=>{calls.push({name,args});return {data:name==='search_charts_multi'?{charts:[],total_count:36}:[],error:null};}}});
vm.runInContext(fs.readFileSync('js/api.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ',''),ctx);
const six=['BASIC','ADVANCED','EXPERT','MASTER','ULTIMA','WORLDS_END'];
for(const selected of [[],['MASTER'],['EXPERT','MASTER'],six,['MASTER','WORLDS_END'],['WORLDS_END']]) {
  await ctx.searchCharts({difficulties:selected,query:'song',minRating:12,maxRating:14,tagId:7,sortBy:'avg_rating',page:2,limit:5,weStarLevel:3,weAttribute:'狂'});
  const {name,args}=calls.at(-1);
  assert.equal(name,'search_charts_multi');assert.equal('diff' in args,false);
  assert.deepEqual(JSON.parse(JSON.stringify(args.diffs)),selected.length?selected:null);
  assert.equal(args.page_offset,10);assert.equal(args.page_limit,5);
  assert.equal(args.query,'song');assert.equal(args.tag_filter,7);assert.equal(args.sort_by,'avg_rating');
  const onlyWe=selected.length===1&&selected[0]==='WORLDS_END';
  assert.equal(args.min_r,onlyWe?null:12);assert.equal(args.max_r,onlyWe?null:14);
  assert.equal(args.we_star_filter,!selected.length||selected.includes('WORLDS_END')?3:null);
}
await ctx.searchCharts({difficulty:'MASTER'});assert.equal(calls.at(-1).name,'search_charts');assert.equal(calls.at(-1).args.diff,'MASTER');
const emptyPage=await ctx.searchCharts({difficulties:[],page:99});assert.equal(emptyPage.length,0);assert.equal(emptyPage.totalCount,36);
await assert.rejects(ctx.searchCharts({difficulties:['INVALID']}));
ctx.supabase.rpc=async()=>({error:{code:'PGRST202'}});
await assert.rejects(ctx.searchCharts({difficulties:[]}),/尚未部署/);

// Execute the actual home handlers and loading flow with delayed responses.
const elements=new Map();
function el(id){if(!elements.has(id))elements.set(id,{value:'',style:{},innerHTML:'',textContent:'',insertAdjacentHTML(_,html){this.innerHTML+=html;}});return elements.get(id);}
const homeCalls=[];let resolve;
function rowsWithTotal(rows,total){Object.defineProperty(rows,'totalCount',{value:total});return rows;}
const home=vm.createContext({console,location:{hash:''},currentUser:null,window:{addEventListener(){}},
 document:{addEventListener(){},getElementById:el,querySelectorAll:()=>[]},
 searchCharts:options=>{homeCalls.push(JSON.parse(JSON.stringify(options)));return new Promise(r=>{resolve=r;});},escapeHtml:String});
vm.runInContext(fs.readFileSync('js/pages/index.js','utf8').replace(/^import .*;\r?\n/gm,''),home);
vm.runInContext("renderCard=chart=>chart.id; currentFilter.query='song';currentFilter.tagId=7;currentFilter.minRating=12;currentFilter.maxRating=14;currentFilter.sortBy='avg_rating';currentFilter.weStarLevel=3;currentFilter.weAttribute='狂';currentPage=3;",home);
function button(){return {active:false,classList:{toggle(){return this.owner.active=!this.owner.active;}},setAttribute(k,v){this[k]=v;}};}
const expert=button(),master=button();expert.classList.owner=expert;master.classList.owner=master;
home.window.filterDifficulty(expert,'EXPERT');
assert.equal(expert['aria-pressed'],'true');assert.equal(homeCalls[0].page,0);
home.window.filterDifficulty(master,'MASTER');resolve([{id:'obsolete',total_count:99}]);
await new Promise(r=>setImmediate(r));
assert.doesNotMatch(el('chartGrid').innerHTML,/obsolete/);
assert.deepEqual(homeCalls[1].difficulties,['EXPERT','MASTER']);assert.equal(homeCalls[1].page,0);
assert.equal(homeCalls[1].query,'song');assert.equal(homeCalls[1].tagId,7);assert.equal(homeCalls[1].weStarLevel,3);
resolve(rowsWithTotal(Array.from({length:20},(_,i)=>({id:String(i)})),23));
await new Promise(r=>setImmediate(r));assert.equal(el('resultCount').textContent,'共 23 筆');
const more=home.loadCharts(false);assert.equal(homeCalls.at(-1).page,1);
resolve(rowsWithTotal([{id:'20'},{id:'21'},{id:'22'}],23));await more;
assert.equal(el('loadMoreBtn').style.display,'none');assert.equal(el('resultCount').textContent,'共 23 筆');
// A shrinking result set can invalidate the current page; recover to page zero.
const outside=home.loadCharts(false);assert.equal(homeCalls.at(-1).page,2);
resolve(rowsWithTotal([],3));await new Promise(r=>setImmediate(r));
assert.equal(homeCalls.at(-1).page,0);assert.equal(homeCalls.at(-1).query,'song');
assert.deepEqual(homeCalls.at(-1).difficulties,['EXPERT','MASTER']);
resolve(rowsWithTotal([{id:'fresh'}],3));await outside;
assert.equal(el('chartGrid').innerHTML,'fresh');assert.equal(el('resultCount').textContent,'共 3 筆');
const emptied=home.loadCharts(false);resolve(rowsWithTotal([],0));await emptied;
assert.equal(el('resultCount').textContent,'0 筆');assert.doesNotMatch(el('chartGrid').innerHTML,/fresh/);
home.window.filterDifficulty(expert,'EXPERT');resolve(rowsWithTotal([],0));await new Promise(r=>setImmediate(r));
home.window.filterDifficulty(master,'MASTER');assert.deepEqual(homeCalls.at(-1).difficulties,[]);
resolve(rowsWithTotal([],0));await new Promise(r=>setImmediate(r));assert.equal(el('resultCount').textContent,'0 筆');
assert.equal(master['aria-pressed'],'false');assert.equal(el('weFilters').hidden,false);

const sql=fs.readFileSync('supabase/migrations/20261008_multi_difficulty_search.sql','utf8');
assert.doesNotMatch(sql,/DROP FUNCTION|ALTER TABLE|CREATE POLICY|SECURITY DEFINER|UPDATE public|DELETE FROM/);
assert.match(sql,/prosecdef/);assert.match(sql,/aclexplode\(old_acl\)/);
assert.match(sql,/cardinality\(diffs\),0\)=0 OR c.difficulty = ANY\(diffs\)/);
assert.match(sql,/SELECT count\(\*\) FROM matched/);assert.match(sql,/c.id ASC/);
assert.match(sql,/matches<>1/);assert.match(sql,/BEGIN;[\s\S]*COMMIT;/);
const html=fs.readFileSync('index.html','utf8');assert.equal((html.match(/aria-pressed="false"/g)||[]).length,6);
console.log('PASS: legacy RPC preserved; multi/none/all/WE payloads, combined filters, invalid/deployment errors, actual UI toggles/stale requests/page reset/total counts, empty-page metadata and range recovery. Mocked API/DOM; actual PostgreSQL verification is in multi-difficulty-postgres.cjs.');
