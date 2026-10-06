import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const auth = fs.readFileSync('js/auth.js','utf8');
const avatarCode = auth.slice(auth.indexOf('export function getProviderAvatar'), auth.indexOf('function debugUser')).replaceAll('export ', '');
const avatarContext = vm.createContext({currentUser:null,currentProfile:null});
vm.runInContext(avatarCode,avatarContext);
for (const provider of ['google','discord']) {
  const user = {id:'owner',app_metadata:{provider},identities:[{provider,identity_data:{avatar_url:'https://provider.example/avatar'}}],user_metadata:{picture:'https://metadata.example/avatar'}};
  avatarContext.user = user;
  assert.equal(vm.runInContext('getProviderAvatar(user)',avatarContext),'https://provider.example/avatar');
  assert.equal(vm.runInContext("getUserDisplayData(user,{avatar_url:'https://custom.example/avatar'}).avatar",avatarContext),'https://custom.example/avatar');
}
const studio = fs.readFileSync('js/pages/charter_studio.js','utf8');
const save = studio.slice(studio.indexOf('window.saveDraft ='),studio.indexOf('// ── 管理後台'));
for (const status of ['published','draft']) {
  const chart = {status}; let tags;
  const ctx = vm.createContext({window:{},editingChartId:'chart',coverFile:null,stripFile:null, getVal:id=>({songTitle:'Updated',songComposer:'Composer',songBpm:'180',songDesc:'Description',musicCategory:'Original',ytUrl:''}[id]||''),getSelectedDiff:()=> 'EXPERT',document:{getElementById:()=>({textContent:'12.5'})},getSelectedTagIds:()=>[],setChartTags:async(id,values)=>{tags=values;}, updateChart:async(id,updates)=>{assert.ok(!('status' in updates));Object.assign(chart,updates);},showToast:()=>{},loadMyCharts:async()=>{}});
  vm.runInContext(save,ctx); await ctx.window.saveDraft();
  assert.equal(chart.status,status);assert.equal(chart.bpm,180);assert.equal(chart.rating,12.5);assert.equal(chart.title,'Updated');assert.equal(chart.difficulty,'EXPERT');assert.equal(tags.length,0);
}
const api = fs.readFileSync('js/api.js','utf8');
const ctx = vm.createContext({currentUser:{id:'owner'},supabase:{from:()=>({update:updates=>({eq:()=>({eq:()=>({select:()=>({single:async()=>({data:updates})})})})})})}});
vm.runInContext(api.replace(/^import .*;\r?\n/gm,'').replaceAll('export ',''),ctx);
await assert.rejects(vm.runInContext("updateChart('chart',{status:'draft'})",ctx));
const html = fs.readFileSync('index.html','utf8');
assert.ok(html.includes('href="charter_studio.html#profile"'));
assert.ok(html.includes('</a><button class="btn-login" onclick="event.stopPropagation();logout()"'));
console.log('PASS: Google/Discord provider avatar, custom avatar precedence, actual edit save preserves published/draft, BPM/rating/difficulty/tag clearing, status API guard, account link and isolated logout. Mocked persistence; live OAuth/RLS not tested.');
