import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const sql=fs.readFileSync('supabase/migrations/20261006_chart_views_review_reactions.sql','utf8');
assert.match(sql,/PRIMARY KEY \(chart_id, user_id\)/);
assert.match(sql,/ON CONFLICT \(chart_id, user_id\) DO NOTHING/);
assert.match(sql,/GET DIAGNOSTICS inserted = ROW_COUNT/);
assert.match(sql,/IF inserted = 1 THEN/);
assert.match(sql,/SET view_count = coalesce\(view_count, 0\) \+ 1/);
assert.match(sql,/viewer uuid := auth.uid\(\)/);
assert.match(sql,/SET search_path = ''/);
assert.match(sql,/DEFAULT 'like'/);
assert.match(sql,/ON CONFLICT ON CONSTRAINT review_helpful_pkey DO UPDATE/);
assert.match(sql,/FOR UPDATE OF r/);
assert.match(sql,/GRANT INSERT \(review_id, reaction\), UPDATE \(reaction\)/);
assert.doesNotMatch(sql,/TRUNCATE|DROP TABLE|DROP COLUMN|view_count\s*=\s*0|service_role|storage\.buckets/i);
const html=fs.readFileSync('chart_detail.html','utf8');
const page=fs.readFileSync('js/pages/chart-detail.js','utf8');
assert.doesNotMatch(html+page,/measureNum|measure_number|measure-tag|小節（選填）/);
assert.doesNotMatch(page,/helpfulState/);
assert.match(page,/getReviewReactions\(reviews.map/);
assert.match(page,/data-reaction="dislike"/);
assert.match(page,/aria-pressed/);

// Test actual frontend API against a persisted, serialized mock RPC ledger.
// This validates integration behavior, not PostgreSQL concurrency/RLS execution.
const charts=new Map(['chart1','chart2','chart3'].map(id=>[id,{id,status:'published',view_count:125}]));
const ledger=new Set();let calls=0, pending=false;
const context=vm.createContext({currentUser:null,getStorageUrl:()=>null});
context.supabase={from(table){assert.equal(table,'charts');let id;return {
  select(){return this;},eq(key,value){id=value;return this;},async single(){return {data:{...charts.get(id)},error:null};}
};},async rpc(name,args){
  calls++;assert.equal(name,'record_chart_view');assert.deepEqual(Object.keys(args),['chart_uuid']);
  if(pending)return {error:{code:'PGRST202'}};
  const key=context.currentUser.id+':'+args.chart_uuid;
  if(!ledger.has(key)){ledger.add(key);charts.get(args.chart_uuid).view_count++;}
  return {data:charts.get(args.chart_uuid).view_count,error:null};
}};
const api=fs.readFileSync('js/api.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'');
vm.runInContext(api,context);
const get=id=>vm.runInContext(`getChart('${id}')`,context);
assert.equal((await get('chart1')).view_count,125);assert.equal(calls,0);
context.currentUser={id:'a'};
assert.equal((await get('chart1')).view_count,126);
assert.equal((await get('chart1')).view_count,126);
assert.equal((await get('chart1')).view_count,126);
assert.equal((await get('chart2')).view_count,126);
context.currentUser={id:'b'};
assert.equal((await get('chart1')).view_count,127);
assert.equal((await get('chart1')).view_count,127);
context.currentUser=null;assert.equal((await get('chart1')).view_count,127);
context.currentUser={id:'a'};await Promise.all([get('chart3'),get('chart3')]);
assert.equal(charts.get('chart3').view_count,126);
pending=true;const undeployed=await get('chart1');
assert.equal(undeployed.view_count,127);assert.match(undeployed.view_notice,/migration/);
console.log('PASS: unique-view frontend account/guest/revisit/concurrent-request cases, preserved historical counts, pending migration handling, SQL security/uniqueness structural checks. PostgreSQL/live RLS execution not performed.');
