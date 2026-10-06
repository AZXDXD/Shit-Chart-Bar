import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const page=fs.readFileSync('js/pages/chart-detail.js','utf8');
const code=page.slice(page.indexOf('async function loadReviews('),page.indexOf('async function loadTags('));
const cards=[];const elements={reviewList:{replaceChildren(){cards.length=0;},append(card){cards.push(card);}},moreReviews:{}};
const makeButton=reaction=>({dataset:{reaction},textContent:reaction==='like'?'👍 —':'👎 —',attrs:{},disabled:false,classList:{toggle(name,value){this[name]=value;}},setAttribute(name,value){this.attrs[name]=value;}});
const votes=new Map();let reviewQueries=0,reactionQueries=0,writes=0,loginPrompts=0;
const reviews=Array.from({length:20},(_,i)=>({id:'review'+i,rating:5,body:'body',created_at:'date',profiles:{username:'player'}}));
const context=vm.createContext({reviewRevision:0,reviewPage:0,currentUser:{id:'a'},id:'chart',
  el:id=>elements[id],avatar:()=>'',esc:String,nameOf:p=>p.username,date:String,message:()=>{},
  document:{createElement(){const buttons=[makeButton('like'),makeButton('dislike')];return {buttons,querySelectorAll:()=>buttons};}},
  getReviews:async()=>{reviewQueries++;return reviews;},
  getReviewReactions:async ids=>{reactionQueries++;assert.equal(ids.length,20);return ids.map(review_id=>({review_id,like_count:votes.get(review_id)==='like'?1:0,dislike_count:votes.get(review_id)==='dislike'?1:0,my_reaction:votes.get(review_id)||null}));},
  loginRequired:()=>{if(context.currentUser)return false;loginPrompts++;return true;},
  toggleReviewReaction:async(review_id,reaction)=>{writes++;if(votes.get(review_id)===reaction)votes.delete(review_id);else votes.set(review_id,reaction);return {review_id,like_count:votes.get(review_id)==='like'?1:0,dislike_count:votes.get(review_id)==='dislike'?1:0,my_reaction:votes.get(review_id)||null};},
});
vm.runInContext(code,context);
const load=()=>vm.runInContext('loadReviews()',context);
await load();assert.equal(cards.length,20);assert.equal(reviewQueries,1);assert.equal(reactionQueries,1);
await cards[0].buttons[0].onclick();assert.equal(cards[0].buttons[0].attrs['aria-pressed'],'true');
await load();assert.equal(cards[0].buttons[0].attrs['aria-pressed'],'true','Fresh page query restores selected reaction');
await cards[0].buttons[1].onclick();assert.equal(cards[0].buttons[0].textContent,'👍 0');assert.equal(cards[0].buttons[1].textContent,'👎 1');
await cards[0].buttons[1].onclick();assert.equal(cards[0].buttons[1].attrs['aria-pressed'],'false');
context.currentUser=null;await load();
const before=writes;await cards[0].buttons[0].onclick();assert.equal(writes,before);assert.equal(loginPrompts,1);
assert.equal(cards[0].buttons[0].textContent,'👍 0');
context.getReviewReactions=async()=>{throw new Error('migration absent');};await load();
assert.equal(cards.length,20,'Reviews remain readable before migration');assert.equal(cards[0].buttons[0].disabled,true);
assert.equal(cards[0].buttons[0].textContent,'👍 —','Unavailable counts are not fabricated zeros');
console.log('PASS: actual review renderer batch queries, active state after reload, counts on switch/cancel, guest login prompt/no write and undeployed-migration state. DOM and Supabase mocked.');
