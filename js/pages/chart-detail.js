import { supabase } from '../supabase.js';
import { initAuth, currentUser, openLoginModal } from '../auth.js';
import { getStripViewer } from '../chart-strip-viewer.js';
import { getChart, getReviews, isFavorited, toggleFavorite, upsertReview,
  submitCommunityRating, toggleReviewReaction, getReviewReactions, searchCharts } from '../api.js';

const id = new URLSearchParams(location.search).get('id');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const el = name => document.getElementById(name);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nameOf = profile => profile?.charter_name || profile?.username || '使用者';
const date = value => value ? new Date(value).toLocaleString('zh-TW') : '未提供';
function safeUrl(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
function avatar(profile) {
  const url = safeUrl(profile?.avatar_url);
  return url ? `<img src="${esc(url)}" alt="${esc(nameOf(profile))}頭像" referrerpolicy="no-referrer" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" onerror="this.replaceWith(document.createTextNode('👤'))">` : esc(nameOf(profile).slice(0,1));
}
let chart = null, selectedStar = 0, reviewPage = 0, personalRevision = 0, authRevision = 0, reviewRevision = 0;
function message(text) { el('actionMessage').textContent = text; }
function fail(text) {
  chart = null;
  el('chartDetail').hidden = true;
  el('detailStatus').hidden = false;
  el('detailStatus').textContent = text;
  const link = document.createElement('a'); link.href = 'index.html'; link.textContent = ' 返回探索譜面';
  el('detailStatus').append(link);
}
function loginRequired() { if (currentUser) return false; message('請先登入後再操作。'); openLoginModal(); return true; }
async function action(button, callback) {
  if (!chart || button.disabled) return;
  button.disabled = true;
  try { await callback(); } catch (error) { message('操作失敗：' + error.message); }
  finally { button.disabled = false; }
}
function setStars(n) {
  selectedStar = n;
  document.querySelectorAll('[data-star]').forEach(button => button.classList.toggle('lit', Number(button.dataset.star) <= n));
}
function renderChart() {
  const profile = chart.profiles;
  if(chart.view_notice)message(chart.view_notice);
  el('chartTitle').textContent = chart.title;
  document.title = `${chart.title} — 大份吧`;
  document.querySelector('.breadcrumb span:last-child').textContent = chart.title;
  el('category').textContent = chart.music_category || '未分類';
  el('creators').innerHTML = `🎵 作曲家：${esc(chart.composer)}　|　🎼 譜面師：<a class="creator-link" href="#charter">${esc(profile?.charter_name || profile?.username || chart.charter_name || '未提供')}</a>`;
  const diffClass = {MASTER:'diff-master',EXPERT:'diff-expert',ULTIMA:'diff-ultima',WORLDS_END:'diff-we'}[chart.difficulty] || '';
  el('metadata').innerHTML = `<span class="diff-badge ${diffClass}">${esc(chart.difficulty)} ${esc(chart.rating)}</span><span class="meta-pill">BPM ${esc(chart.bpm ?? '未提供')}</span><span class="meta-pill">${esc({published:'已發布',draft:'草稿',unpublished:'已下架'}[chart.status] || chart.status)}</span>`;
  el('chartStats').innerHTML = [['⬇️ 下載',chart.download_count ?? 0],['👁️ 瀏覽',chart.view_count ?? 0],['建立',date(chart.created_at)],['發布',chart.published_at ? date(chart.published_at) : '尚未發布'],['更新',date(chart.updated_at)]].map(([label,value])=>`<div class="hero-stat">${label} <strong>${esc(value)}</strong></div>`).join('');
  el('description').textContent = chart.description || '尚未提供描述';
  el('packageSize').textContent = chart.package_size_mb == null ? '未提供檔案大小' : `${chart.package_size_mb} MB`;
  el('packageDownloadBtn').disabled = !chart.package_path || !(chart.status === 'published' || chart.user_id === currentUser?.id);
  el('creatorRating').textContent = chart.rating;
  el('creatorName').textContent = profile?.charter_name || profile?.username || chart.charter_name || '未提供';
  el('creatorAvatar').innerHTML = avatar(profile);
  el('creatorVerified').hidden = !profile?.is_verified;
  el('creatorBio').textContent = profile?.bio || '尚未提供創作者介紹';
  el('creatorLinks').replaceChildren();
  for (const [label,value] of [['YouTube',profile?.yt_channel],['Twitter / X',profile?.twitter_handle],['Discord',profile?.discord_invite]]) {
    const url = label === 'Twitter / X' && value && !safeUrl(value) ? safeUrl(`https://x.com/${encodeURIComponent(value.replace(/^@/,''))}`) : safeUrl(value);
    if (!url) continue;
    const link = document.createElement('a'); link.className='social-link'; link.href=url; link.textContent=label; link.target='_blank'; link.rel='noopener noreferrer'; el('creatorLinks').append(link);
  }
  el('coverArt').textContent = '🎵';
  if (chart.cover_url) {
    const img = document.createElement('img'); img.src=chart.cover_url; img.alt=chart.title; img.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:inherit;';
    img.onerror=()=>img.replaceWith(document.createTextNode('🎵')); el('coverArt').replaceChildren(img);
  }
  getStripViewer()?.setSource(chart.strip_url);
  el('stripDownload').hidden = !chart.strip_url;
  if (chart.strip_url) {
    el('stripDownload').href=chart.strip_url;
  }
  el('video').textContent='未提供有效的 YouTube 示範影片';
  try {
    const url=new URL(chart.youtube_url);
    let videoId;
    if (url.hostname==='youtu.be') videoId=url.pathname.slice(1);
    if (['youtube.com','www.youtube.com','m.youtube.com'].includes(url.hostname)) videoId=url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts)\/([^/]+)$/)?.[1];
    if (/^[\w-]{11}$/.test(videoId || '')) {
      const iframe=document.createElement('iframe'); iframe.src=`https://www.youtube-nocookie.com/embed/${videoId}`; iframe.title=`${chart.title} 示範影片`; iframe.style.cssText='width:100%;height:100%;border:0;'; iframe.allowFullscreen=true; el('video').replaceChildren(iframe);
    }
  } catch { /* Missing video is a normal empty state. */ }
}
async function refreshPersonal() {
  const version = ++personalRevision, userId=currentUser?.id;
  el('favBtn').disabled=true;
  el('favBtn').classList.remove('active'); el('favBtn').setAttribute('aria-pressed','false'); el('favText').textContent='收藏譜面';
  el('guestLock').hidden=!!userId; el('reviewCompose').hidden=!userId;
  el('reviewBody').value=''; el('cdVoteInput').value=''; setStars(0);
  el('myRating').textContent=userId ? '尚未投票' : '登入後可投票';
  if (!chart) return;
  if (!userId) { el('favBtn').disabled=false; return; }
  const results=await Promise.allSettled([
    isFavorited(id),
    supabase.from('community_ratings').select('rating').eq('chart_id',id).eq('user_id',userId).maybeSingle(),
    supabase.from('reviews').select('rating,body').eq('chart_id',id).eq('user_id',userId).maybeSingle(),
  ]);
  if (version!==personalRevision || userId!==currentUser?.id) return;
  for (const result of results) if (result.status==='rejected' || result.value?.error) message('部分個人資料載入失敗，請重新整理後再操作。');
  if (results[0].status==='fulfilled') {
    const favorite=results[0].value; el('favBtn').classList.toggle('active',favorite); el('favBtn').setAttribute('aria-pressed',String(favorite)); el('favText').textContent=favorite?'已收藏':'收藏譜面'; el('favBtn').disabled=false;
  }
  const rating=results[1].value?.data?.rating;
  if (rating!=null) { el('cdVoteInput').value=rating; el('myRating').textContent=`你的體感難度：${rating}`; }
  const review=results[2].value?.data;
  if (review) { setStars(review.rating); el('reviewBody').value=review.body || ''; }
}
async function refreshCommunity() {
  // Fetch every rating page: PostgREST's row cap must not silently truncate the average.
  let total=0, sum=0, offset=0;
  while (true) {
    const {data,error}=await supabase.from('community_ratings').select('rating,user_id').eq('chart_id',id).order('user_id').range(offset,offset+499);
    if(error) throw error;
    total+=data.length; sum+=data.reduce((value,row)=>value+Number(row.rating),0);
    if(data.length<500) break; offset+=500;
  }
  el('communityAverage').textContent=total?(sum/total).toFixed(1):'尚無評分'; el('communityCount').textContent=`${total} 人評分`;
}
async function reviewOverview() {
  const counts=await Promise.all([1,2,3,4,5].map(async rating=>{
    const {count,error}=await supabase.from('reviews').select('id',{count:'exact',head:true}).eq('chart_id',id).eq('rating',rating);
    if(error) throw error; return count;
  }));
  const total=counts.reduce((a,b)=>a+b,0);
  el('reviewAverage').textContent=total?(counts.reduce((a,b,i)=>a+b*(i+1),0)/total).toFixed(1):'—';
  el('reviewCount').textContent=`共 ${total} 則評論`;
  el('ratingBars').innerHTML=counts.map((count,i)=>`<div class="bar-row"><span class="bar-label">★${i+1}</span><div class="bar-track"><div class="bar-fill" style="width:${total?count/total*100:0}%"></div></div><span class="bar-count">${count}</span></div>`).reverse().join('');
}
async function loadReviews(reset=true) {
  const revision=++reviewRevision, userId=currentUser?.id, page=reset?0:reviewPage;
  const reviews=await getReviews(id,{page,limit:20});
  let states=[], unavailable=false;
  try { states=await getReviewReactions(reviews.map(review=>review.id)); }
  catch { unavailable=true; }
  if(revision!==reviewRevision || userId!==currentUser?.id)return;
  if(reset)el('reviewList').replaceChildren();
  if(!reviews.length && reset)el('reviewList').textContent='尚無評論，歡迎分享遊玩體驗。';
  if(unavailable)message('評論反應尚無法載入：請確認已執行新的 migration，或稍後重試。');
  const byId=new Map(states.map(state=>[state.review_id,state]));
  for(const review of reviews) {
    const card=document.createElement('div'); card.className='review-card';
    card.innerHTML=`<div class="review-meta"><div class="reviewer-avatar">${avatar(review.profiles)}</div><div><div class="reviewer-name">${esc(nameOf(review.profiles))} <span class="review-stars">${'★'.repeat(review.rating)}${'☆'.repeat(5-review.rating)}</span></div><div class="review-date">${esc(date(review.created_at))}</div></div></div><div class="review-text">${esc(review.body || '')}</div><div class="review-helpful"><button type="button" class="helpful-btn" data-reaction="like">👍 —</button><button type="button" class="helpful-btn" data-reaction="dislike">👎 —</button></div>`;
    const buttons=[...card.querySelectorAll('[data-reaction]')];
    const render=state=>buttons.forEach(button=>{
      const reaction=button.dataset.reaction;
      button.textContent=`${reaction==='like'?'👍':'👎'} ${state[reaction+'_count']}`;
      button.setAttribute('aria-label',`${reaction==='like'?'讚':'倒讚'}：${state[reaction+'_count']}`);
      button.classList.toggle('active',state.my_reaction===reaction);
      button.setAttribute('aria-pressed',String(state.my_reaction===reaction));
    });
    const state=byId.get(review.id);
    if(state)render(state);
    buttons.forEach(button=>{
      button.disabled=!state;
      button.onclick=async()=>{
        if(loginRequired() || button.disabled)return;
        const voter=currentUser.id;
        buttons.forEach(item=>item.disabled=true);
        try {
          const updated=await toggleReviewReaction(review.id,button.dataset.reaction);
          if(voter===currentUser?.id)render(updated);
        } catch(error) {message('反應儲存失敗：'+error.message);}
        finally {buttons.forEach(item=>item.disabled=false);}
      };
    });
    el('reviewList').append(card);
  }
  reviewPage=page+1;el('moreReviews').hidden=reviews.length<20;
}
async function loadTags() {
  const {data,error}=await supabase.from('chart_tags').select('tag_id,tags(id,name,color)').eq('chart_id',id);
  if(error)throw error;
  el('chartTags').replaceChildren();
  if(!data.length)el('chartTags').textContent='尚未設定標籤';
  for(const row of data) {
    if(!row.tags)continue;
    const badge=document.createElement('span'); badge.className='qtag';
    badge.textContent='#'+row.tags.name; el('chartTags').append(badge);
  }
}
async function loadRelated() {
  const charts=await searchCharts({limit:5});
  el('relatedCharts').innerHTML=charts.filter(row=>row.id!==id).slice(0,4).map(row=>`<a class="rel-card" href="chart_detail.html?id=${encodeURIComponent(row.id)}" style="color:inherit;text-decoration:none"><div class="rel-cover">${row.cover_url?`<img src="${esc(row.cover_url)}" alt="" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display='none'">`:'🎵'}</div><div class="rel-body"><div class="rel-title">${esc(row.title)}</div><div class="rel-designer">${esc(row.charter_name)}</div><div class="rel-foot">${esc(row.difficulty)} ${esc(row.rating)}</div></div></a>`).join('') || '目前沒有其他公開譜面';
}
el('favBtn').onclick=()=>{if(loginRequired())return;action(el('favBtn'),async()=>{const favorite=await toggleFavorite(id);el('favBtn').classList.toggle('active',favorite);el('favBtn').setAttribute('aria-pressed',String(favorite));el('favText').textContent=favorite?'已收藏':'收藏譜面';message(favorite?'已收藏':'已取消收藏');});};
el('communitySubmit').onclick=()=>{if(loginRequired())return;action(el('communitySubmit'),async()=>{
  const input=el('cdVoteInput'),rating=Number(input.value);
  if(!input.value || !input.checkValidity() || rating<1 || rating>16)throw new Error('體感難度請填入 1.0 至 16.0，以 0.1 為單位');
  await submitCommunityRating(id,rating);el('myRating').textContent=`你的體感難度：${rating}`;message('評分已儲存');await refreshCommunity();
});};
document.querySelectorAll('[data-star]').forEach(button=>button.onclick=()=>setStars(Number(button.dataset.star)));
el('reviewCompose').onsubmit=event=>{event.preventDefault();if(loginRequired())return;action(el('reviewSubmit'),async()=>{
  const body=el('reviewBody').value.trim();
  if(!selectedStar || !body)throw new Error('請選擇星等並輸入評論');
  await upsertReview(id,{rating:selectedStar,body});message('評論已儲存');await Promise.all([loadReviews(),reviewOverview()]);
});};
el('moreReviews').onclick=()=>action(el('moreReviews'),()=>loadReviews(false));
for(const [button,value] of [['copyTitle',()=>chart?.title],['shareBtn',()=>location.href]]) el(button).onclick=()=>action(el(button),async()=>{await navigator.clipboard.writeText(value());message('已複製');});
// The separate chart-download.js handler retains the authoritative private-package flow.
await import('./chart-download.js');
async function authChanged() {
  const revision=++authRevision;
  if(!chart)return;
  try {
    const updated=await getChart(id,{countView:!!currentUser});
    if(revision!==authRevision)return;
    chart=updated;renderChart();
  } catch {if(revision===authRevision)fail('找不到此譜面，或目前沒有權限查看。');return;}
  const results=await Promise.allSettled([refreshPersonal(),loadTags(),loadReviews()]);
  if(results.some(result=>result.status==='rejected'))message('部分資料更新失敗，請重新整理後再試。');
}
window.addEventListener('authLogin',()=>{setTimeout(authChanged,0);});
window.addEventListener('authLogout',authChanged);
window.addEventListener('chartDownloadStatsFailed',()=>message('已開始下載，但下載統計記錄失敗。'));
window.addEventListener('chartDownloaded',async event=>{
  if (!chart || event.detail.chartId !== id) return;
  try { chart=await getChart(id,{countView:false});renderChart(); } catch { message('下載後資料更新失敗，請重新整理。'); }
});
await initAuth();
if(!id)fail('請從譜面列表選擇要查看的譜面。');
else if(!uuid.test(id))fail('譜面連結格式不正確。');
else {
  try {
    let revision=authRevision, loaded=await getChart(id);
    while(revision!==authRevision) {revision=authRevision;loaded=await getChart(id);}
    chart=loaded;renderChart();el('detailStatus').hidden=true;el('chartDetail').hidden=false;
    const results=await Promise.allSettled([refreshPersonal(),refreshCommunity(),reviewOverview(),loadReviews(),loadTags(),loadRelated()]);
    results.forEach((result,index)=>{if(result.status==='rejected') {
      const target=['actionMessage','communityCount','reviewCount','reviewList','chartTags','relatedCharts'][index];el(target).textContent='資料載入失敗，請重新整理後重試。';
    }});
  } catch(error) {fail(error.code==='PGRST116'?'找不到此譜面，或目前沒有權限查看。':'譜面載入失敗，請稍後重新整理再試。');}
}
