import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const sql=fs.readFileSync('supabase/migrations/20261007_unique_chart_downloads.sql','utf8');
assert.match(sql,/LOCK TABLE public.downloads IN ACCESS EXCLUSIVE MODE/);
assert.match(sql,/DROP TRIGGER IF EXISTS downloads_count_trigger/);
assert.match(sql,/CREATE UNIQUE INDEX[\s\S]*ON public.downloads\(user_id, chart_id\)/);
assert.match(sql,/ON CONFLICT \(user_id, chart_id\) DO NOTHING/);
assert.match(sql,/GET DIAGNOSTICS inserted = ROW_COUNT/);
assert.match(sql,/IF inserted = 1 THEN/);
assert.match(sql,/downloader uuid := auth.uid\(\)/);
assert.match(sql,/SET search_path = ''/);
assert.match(sql,/FOR UPDATE/);
assert.match(sql,/downloader IS NULL OR chart_status <> 'published'/);
assert.match(sql,/REVOKE ALL ON public.downloads FROM PUBLIC, anon, authenticated/);
assert.doesNotMatch(sql,/TRUNCATE|DROP TABLE|download_count\s*=\s*0|storage\.|record_chart_view|review_helpful|search_charts/i);

// Persisted mock RPC ledger: validates actual frontend integration, not PostgreSQL locks/RLS.
const counts=new Map([['x',125],['y',40],['z',7]]),ledger=new Set(['a:x']);
let calls=0,downloads=0,signs=0,unavailable=false,signError=false;
const events=[];
const context=vm.createContext({currentUser:{id:'new-a'},console:{warn(){}},
  document:{createElement:()=>({click(){downloads++;}}),body:{appendChild(){},removeChild(){}}},
  window:{dispatchEvent:event=>events.push(event)},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options?.detail;}},
  supabase:{async rpc(name,args){
    calls++;assert.equal(name,'record_chart_download');assert.deepEqual(Object.keys(args),['target_chart']);
    if(unavailable)return {error:new Error('RPC migration not deployed')};
    const id=args.target_chart,user=context.currentUser?.id;
    if(user){const key=user+':'+id;if(!ledger.has(key)){ledger.add(key);counts.set(id,counts.get(id)+1);}}
    return {data:counts.get(id),error:null};
  },from(table){assert.equal(table,'charts');let id;return {
    select(){return this;},eq(key,value){id=value;return this;},async single(){return {data:{id,user_id:'owner',title:'Chart',difficulty:'MASTER',rating:14,status:'published',package_path:`owner/${id}/package.zip`},error:null};}
  };},storage:{from(bucket){assert.equal(bucket,'chart-packages');return {async createSignedUrl(path,expires,options){
    signs++;assert.equal(expires,60);assert.equal(options.download,true);
    return signError?{error:new Error('Storage denied')}:{data:{signedUrl:'https://example.com/signed?token=short-lived'},error:null};
  }};}}}
});
const api=fs.readFileSync('js/api.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'');
vm.runInContext(api,context);
const storage=fs.readFileSync('js/storage.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'')
  .replace("const { recordDownload } = await import('./api.js');",'');
vm.runInContext(storage,context);
const download=id=>vm.runInContext(`downloadChart('${id}')`,context);
await download('x');assert.equal(counts.get('x'),126);
await download('x');assert.equal(counts.get('x'),126);
// Reload/relogin create a fresh identity object, retaining only server ledger state.
context.currentUser={id:'new-a'};await download('x');assert.equal(counts.get('x'),126);
context.currentUser=null;context.currentUser={id:'new-a'};await download('x');assert.equal(counts.get('x'),126);
await download('y');assert.equal(counts.get('y'),41);
context.currentUser={id:'b'};await download('x');assert.equal(counts.get('x'),127);
await download('x');assert.equal(counts.get('x'),127);
context.currentUser=null;const priorDownloads=downloads;await download('x');
assert.equal(downloads,priorDownloads+1);assert.equal(counts.get('x'),127);
context.currentUser={id:'c'};await Promise.all([download('z'),download('z')]);assert.equal(counts.get('z'),8);
context.currentUser={id:'a'};await download('x');assert.equal(counts.get('x'),127,'Retained historical account record prevents recount');
assert.equal(signs,downloads,'Every repeated download receives a new signed URL');
assert.equal(events.at(-1).detail.downloadCount,127,'Event uses database total');
const callsBefore=calls;signError=true;await assert.rejects(download('x'),/Storage denied/);assert.equal(calls,callsBefore,'Signing failure cannot record a download');
signError=false;unavailable=true;const before=downloads;await download('x');assert.equal(downloads,before+1,'Missing migration cannot block signed download');
assert.ok(events.some(event=>event.type==='chartDownloadStatsFailed'));assert.equal(counts.get('x'),127);
const detail=fs.readFileSync('js/pages/chart-detail.js','utf8');
assert.match(detail,/chartDownloaded[\s\S]*getChart\(id,\{countView:false\}\)/,'Detail refetches true count without adding views');
console.log('PASS: unique download API and signed-flow integration: A/B repeated/relogin/reload, guest, concurrent mocked requests, historical ledger, signing failure, pending migration and real-count refresh. Supabase/Storage mocked; SQL uniqueness/security checked structurally, not executed.');
