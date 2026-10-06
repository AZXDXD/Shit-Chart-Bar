import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Exercise persisted favorite toggles, composite-key ratings/reviews and denied writes.
const userId='a0861250-261e-4886-8150-c13fd90658be';
const chartId='ba98df6b-7fd4-4a28-98ab-044933ab7759';
const tables={favorites:[],community_ratings:[],reviews:[],review_helpful:[],chart_tag_votes:[]};
let denied=false, writes=0;
const client={async rpc(name,args) {
  assert.equal(name,'toggle_review_reaction');
  assert.deepEqual(Object.keys(args).sort(),['requested_reaction','review_uuid']);
  if(denied)return {data:null,error:new Error('RLS denied')};
  const existing=tables.review_helpful.find(row=>row.review_id===args.review_uuid && row.user_id===context.currentUser.id);
  if(existing?.reaction===args.requested_reaction)tables.review_helpful=tables.review_helpful.filter(row=>row!==existing);
  else if(existing)existing.reaction=args.requested_reaction;
  else tables.review_helpful.push({review_id:args.review_uuid,user_id:context.currentUser.id,reaction:args.requested_reaction});
  return {data:[{review_id:args.review_uuid,like_count:tables.review_helpful.filter(row=>row.reaction==='like').length,dislike_count:tables.review_helpful.filter(row=>row.reaction==='dislike').length,my_reaction:tables.review_helpful.find(row=>row.user_id===context.currentUser.id)?.reaction || null}],error:null};
},from(table) {
  const filters=[]; let operation='select', payload, conflict;
  const query={
    select(){return this;}, eq(key,value){filters.push([key,value]);return this;},
    insert(value){operation='insert';payload=value;return this;},
    upsert(value,options){operation='upsert';payload=value;conflict=options.onConflict;return this;},
    delete(){operation='delete';return this;},
    maybeSingle(){return this.execute(true);}, single(){return this.execute(true);},
    then(resolve,reject){return this.execute(false).then(resolve,reject);},
    async execute(single) {
      const matches=row=>filters.every(([key,value])=>row[key]===value);
      if(operation!=='select') {
        writes++;
        if(denied)return {data:null,error:new Error('RLS denied')};
        if(operation==='delete')tables[table]=tables[table].filter(row=>!matches(row));
        else if(operation==='upsert') {
          assert.equal(conflict,'chart_id,user_id');
          const existing=tables[table].find(row=>row.chart_id===payload.chart_id && row.user_id===payload.user_id);
          if(existing)Object.assign(existing,payload); else tables[table].push({...payload});
        } else tables[table].push({...payload});
      }
      const data=operation==='upsert'?{...payload}:single?tables[table].find(matches) || null:tables[table].filter(matches);
      return {data,error:null};
    },
  }; return query;
}};
const api=fs.readFileSync(new URL('../js/api.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'');
const context=vm.createContext({supabase:client,currentUser:null}); vm.runInContext(api,context);
const run=code=>vm.runInContext(code,context);
for(const operation of [`toggleFavorite('${chartId}')`,`submitCommunityRating('${chartId}',14.5)`,`upsertReview('${chartId}',{rating:5,body:'評論'})`,`toggleReviewReaction('review-id','like')`])await assert.rejects(run(operation),/登入/);
assert.equal(writes,0,'Guests cannot write');
context.currentUser={id:userId};
assert.equal(await run(`isFavorited('${chartId}')`),false);
assert.equal(await run(`toggleFavorite('${chartId}')`),true);
assert.equal(await run(`isFavorited('${chartId}')`),true,'Fresh query reads persisted favorite');
denied=true;await assert.rejects(run(`toggleFavorite('${chartId}')`),/RLS denied/);
assert.equal(await run(`isFavorited('${chartId}')`),true,'Denied deletion cannot report success');
denied=false;
assert.equal(await run(`toggleFavorite('${chartId}')`),false);
await run(`submitCommunityRating('${chartId}',14.5)`);await run(`submitCommunityRating('${chartId}',15.1)`);
assert.equal(tables.community_ratings.length,1);assert.equal(tables.community_ratings[0].rating,15.1);
await run(`upsertReview('${chartId}',{rating:4,body:'第一則',measureNumber:32})`);
await run(`upsertReview('${chartId}',{rating:5,body:'修改評論',measureNumber:null})`);
assert.equal(tables.reviews.length,1);assert.equal(tables.reviews[0].body,'修改評論');assert.equal(tables.reviews[0].user_id,userId);
assert.equal('measure_number' in tables.reviews[0],false);
assert.equal((await run("toggleReviewReaction('review-id','like')")).my_reaction,'like');
assert.equal(tables.review_helpful.length,1);
assert.equal((await run("toggleReviewReaction('review-id','like')")).my_reaction,null);
assert.equal(tables.review_helpful.length,0);
await run("toggleReviewReaction('review-id','dislike')");
assert.equal((await run("toggleReviewReaction('review-id','dislike')")).dislike_count,0);
await run("toggleReviewReaction('review-id','like')");
let switched=await run("toggleReviewReaction('review-id','dislike')");
assert.equal(switched.like_count,0);assert.equal(switched.dislike_count,1);
switched=await run("toggleReviewReaction('review-id','like')");
assert.equal(switched.like_count,1);assert.equal(switched.dislike_count,0);
context.currentUser={id:'user-b'};await run("toggleReviewReaction('review-id','like')");
context.currentUser={id:'user-c'};
const combined=await run("toggleReviewReaction('review-id','dislike')");
assert.equal(combined.like_count,2);assert.equal(combined.dislike_count,1);
denied=true;await assert.rejects(run(`submitCommunityRating('${chartId}',14.1)`),/RLS denied/);

// Run the actual page for invalid URLs; it must never query charts or expose actions.
const source=fs.readFileSync(new URL('../js/pages/chart-detail.js',import.meta.url),'utf8')
  .replace(/^import[^;]*;\r?\n/gm,'').replace("await import('./chart-download.js');",'');
for(const search of ['', '?id=broken', `?id=${chartId}`]) {
  const elements=new Map();
  const element=name=>{if(!elements.has(name))elements.set(name,{hidden:false,textContent:'',disabled:false,onclick:null,append(){},classList:{remove(){},toggle(){}},setAttribute(){}});return elements.get(name);};
  const document={getElementById:element,querySelectorAll:()=>[],createElement:()=>({})};
  let chartQueries=0;
  const page=vm.createContext({document,location:{search},URL,URLSearchParams,currentUser:null,
    window:{addEventListener(){}},initAuth:async()=>{},getChart:async()=>{chartQueries++;throw {code:'PGRST116'};}});
  await vm.runInContext(`(async()=>{${source}})()`,page);
  assert.equal(chartQueries,search.includes(chartId)?1:0);
  assert.equal(element('chartDetail').hidden,true);
  assert.match(element('detailStatus').textContent,/選擇|格式|權限/);
}
console.log('PASS: guest guards, favorites, review upserts without measure, reaction toggle/switch/three accounts, invalid detail URLs. Supabase writes use mocks; live RLS not tested.');
