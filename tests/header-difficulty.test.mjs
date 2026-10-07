import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const headerSource=fs.readFileSync('js/site-header.js','utf8');
const handlers={},menu={className:'',innerHTML:'',addEventListener(type,fn){handlers[type]=fn;},contains:()=>false};
const header={append(node){assert.equal(node,menu);}};
let login=0,logout=0;
const context=vm.createContext({document:{querySelector:()=>header,createElement:()=>menu,addEventListener(){}},window:{openLoginModal(){login++;},logout(){logout++;}}});
vm.runInContext(headerSource,context);
const items=Array.from(menu.innerHTML.matchAll(/<(a|button)\b([^>]*)>([^<]+)<\/(?:a|button)>/g),m=>({tagName:m[1].toUpperCase(),attrs:m[2],text:m[3],style:{display:m[2].includes('data-auth="user"')?'none':''}}));
assert.match(items.find(i=>i.text==='已收藏譜面').attrs,/href="index.html#favorites"/);
assert.match(items.find(i=>i.text==='我的譜面').attrs,/href="charter_studio.html#manage"/);
assert.match(items.find(i=>i.text==='帳號資料').attrs,/href="charter_studio.html#profile"/);
const account={tagName:'SPAN',style:{},textContent:''};
const authContext=vm.createContext({URL,window:{},document:{readyState:'loading',addEventListener(){},querySelectorAll(selector){
  if(selector==='[data-auth="guest"]')return items.filter(i=>i.attrs.includes('data-auth="guest"'));
  if(selector==='[data-auth="user"]')return [...items.filter(i=>i.attrs.includes('data-auth="user"')),account];
  return [];
}}});
vm.runInContext(fs.readFileSync('js/auth.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ',''),authContext);
const visible=()=>items.filter(i=>i.style.display!=='none').map(i=>i.text);
vm.runInContext('updateAllAuthUI()',authContext);
assert.deepEqual(visible(),['探索譜面','登入帳號']);assert.equal(account.style.display,'none');
vm.runInContext("currentUser={id:'a',user_metadata:{}};updateAllAuthUI()",authContext);
assert.deepEqual(visible(),['探索譜面','已收藏譜面','我的譜面','帳號資料','登出']);
assert.equal(account.style.display,'inline-flex');
vm.runInContext('currentUser=null;updateAllAuthUI()',authContext);
assert.deepEqual(visible(),['探索譜面','登入帳號']);
for(const action of ['login','logout'])handlers.click({target:{closest:()=>({dataset:{menuAction:action}})}});
assert.equal(login,1);assert.equal(logout,1);assert.equal(menu.open,false);
const order=['BASIC','ADVANCED','EXPERT','MASTER','ULTIMA',"WORLD'S END"];
for(const [file,cls] of [['index.html','diff-tag'],['charter_studio.html','diff-opt']]) {
  const html=fs.readFileSync(file,'utf8');
  const names=Array.from(html.matchAll(new RegExp('<button class="'+cls+'[^>]*>([^<]+)</button>','g')),m=>m[1]);
  assert.deepEqual(names,order);
}
for(const file of ['index.html','chart_detail.html','charter_studio.html']) {
  const html=fs.readFileSync(file,'utf8');
  assert.match(html,/src="js\/site-header.js"/);
  const accountHtml=html.match(/<span class="header-account"[\s\S]*?<\/span>\s*<\/span>/)[0];
  assert.doesNotMatch(accountHtml,/<a\b|onclick|data-account-link|dropdown/);
  assert.doesNotMatch(html,/工具與教學|官方 Discord 社群/);
}
const studio=fs.readFileSync('js/pages/charter_studio.js','utf8');
const diffContext=vm.createContext({document:{querySelector:()=>({textContent:diffContext.selected})}});
vm.runInContext(studio.match(/function getSelectedDiff\(\) \{[\s\S]*?\n\}/)[0],diffContext);
for(const name of order){diffContext.selected=name;assert.equal(diffContext.getSelectedDiff(),name==="WORLD'S END"?'WORLDS_END':name);}
const apiContext=vm.createContext({supabase:{rpc:async(name,args)=>({data:[],error:null})}});
vm.runInContext(fs.readFileSync('js/api.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ',''),apiContext);
for(const difficulty of ['BASIC','ADVANCED']) {
  apiContext.supabase.rpc=async(name,args)=>{assert.equal(name,'search_charts');assert.equal(args.diff,difficulty);assert.equal(args.query,'song');assert.equal(args.tag_filter,7);return {data:[]};};
  await apiContext.searchCharts({difficulty,query:'song',tagId:7});
}
const sql=fs.readFileSync('supabase/migrations/20261007_add_basic_advanced_difficulties.sql','utf8');
assert.equal((sql.match(/ALTER TYPE/g)||[]).length,2);assert.doesNotMatch(sql,/CREATE TABLE|DROP|UPDATE|DELETE/);
console.log('PASS: shared menu guest/login/logout visibility, correct routes/actions, inert account identity, six selectors/save values and real RPC difficulty arguments; enum migration additive only. Auth/DB mocked.');
