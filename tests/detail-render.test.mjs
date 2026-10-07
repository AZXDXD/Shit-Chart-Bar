import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync('chart_detail.html','utf8');
const ids=new Set(Array.from(html.matchAll(/\bid="([^"]+)"/g),m=>m[1]));
assert.doesNotMatch(html,/<nav class="breadcrumb"/);
const source=fs.readFileSync('js/pages/chart-detail.js','utf8')
  .replace(/^import[^;]*;\r?\n/gm,'').replace("await import('./chart-download.js');",'');
const chartId='588ab3bc-14a4-4cf1-b6f5-b6598371196b';
async function runCase(difficulty,status,user,error=null) {
  const nodes=new Map(),errors=[],queries=[];
  const make=()=>({style:{},hidden:false,textContent:'',innerHTML:'',value:'',
    classList:{remove(){},toggle(){}},setAttribute(){},append(){},replaceChildren(){},
  });
  const el=id=>{assert.ok(ids.has(id),`Renderer requested missing id ${id}`);if(!nodes.has(id))nodes.set(id,make());return nodes.get(id);};
  const chart={id:chartId,title:'Real chart',composer:'Composer',charter_name:'Charter',difficulty,status,rating:14,
    user_id:'owner',profiles:{id:'owner',username:'Owner',charter_name:'Custom'},package_path:`owner/${chartId}/package.zip`,
    strip_url:'https://example.test/strip.png',view_count:3,download_count:2};
  let strip;
  const query={select(){return this;},eq(){return this;},order(){return this;},range:async()=>({data:[],error:null}),maybeSingle:async()=>({data:null,error:null}),
    then(resolve){return Promise.resolve({data:[],count:0,error:null}).then(resolve);}};
  const ctx=vm.createContext({URL,URLSearchParams,console:{error(...values){errors.push(values);}},
    location:{search:`?id=${chartId}`,hostname:'127.0.0.1'},currentUser:user,
    document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[],createElement:make,createTextNode:text=>({textContent:text})},
    window:{addEventListener(){}},initAuth:async()=>{},getChart:async id=>{queries.push(id);if(error)throw error;return chart;},
    getStripViewer:()=>({setSource(value){strip=value;}}),supabase:{from:()=>query},
    isFavorited:async()=>false,getReviews:async()=>[],getReviewReactions:async()=>[],searchCharts:async()=>[],
  });
  await vm.runInContext(`(async()=>{${source}})()`,ctx);
  assert.deepEqual(queries,[chartId]);
  if(error){assert.equal(el('chartDetail').hidden,true);const detail=JSON.parse(errors[0][1]);
    assert.equal(detail.code,error.code);assert.equal(detail.message,error.message);assert.equal(detail.details,error.details);assert.equal(detail.hint,error.hint);return;}
  assert.equal(el('chartDetail').hidden,false);assert.equal(el('detailStatus').hidden,true);
  assert.equal(el('chartTitle').textContent,'Real chart');assert.equal(el('creatorName').textContent,'Custom');
  assert.match(el('metadata').innerHTML,new RegExp(difficulty==='WORLDS_END'?'WORLD&#39;S END':difficulty));
  assert.match(el('chartStats').innerHTML,/下載/);assert.match(el('chartStats').innerHTML,/瀏覽/);
  assert.equal(strip,chart.strip_url);assert.equal(el('favBtn').disabled,false);
  assert.equal(el('packageDownloadBtn').disabled,false);assert.match(el('chartTags').textContent,/尚未設定標籤/);
  assert.match(el('reviewList').textContent,/尚無評論/);assert.deepEqual(errors,[]);
}
for(const diff of ['BASIC','ADVANCED','EXPERT','MASTER','ULTIMA','WORLDS_END'])await runCase(diff,'published',null);
await runCase('MASTER','draft',{id:'owner'});
await runCase('MASTER','unpublished',{id:'owner'});
await runCase('ULTIMA','published',{id:'owner'});
await runCase('MASTER','published',null,{code:'PGRST116',message:'No visible chart',details:'0 rows',hint:'Check access'});
console.log('PASS: actual detail page renders all six difficulties with current HTML and absent breadcrumb; guest published/owner draft, UUID, viewer source, stats, tags, reviews, favorite, download controls and error diagnostics. Supabase mocked.');
