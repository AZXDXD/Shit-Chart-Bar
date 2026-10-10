import { chartLevel, renderWeAttribute } from '../chart-metadata.js';
import { renderChartMediaStatus } from '../chart-media-status.js';
// ============================================================
// js/pages/index.js — 首頁邏輯（接入真實後端）
// ============================================================
import { initAuth, currentUser } from '../auth.js';
import { searchCharts, getAllTags, getMyFavorites } from '../api.js';
import { supabase } from '../supabase.js';
import { renderChartCover, escapeHtml } from '../chart-cover.js';

// ── 狀態 ─────────────────────────────────────────────────────
let currentPage   = 0;
let isLoading     = false;
let hasMore       = true;
let pendingReset  = false;
let favoritesMode = false;
function updateListMode() {
  favoritesMode = location.hash === '#favorites';
  document.getElementById('searchSection').hidden = favoritesMode;
  document.getElementById('chartSectionTitle').textContent = favoritesMode ? '已收藏譜面' : '所有自製譜面';
}
window.addEventListener('hashchange', () => { updateListMode(); loadCharts(true); });
window.addEventListener('authLogin', () => { if (favoritesMode) loadCharts(true); });
window.addEventListener('authLogout', () => {
  if (favoritesMode) {
    document.getElementById('chartGrid').replaceChildren();
    loadCharts(true);
  }
});
let currentFilter = {
  query:      '',
  tagId: null,
  difficulties: [],
  minRating:  1.0,
  maxRating:  null,
  weStarLevel: null, weAttribute: null,
  sortBy:     'published_at',
};

// ── 初始化 ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();
  updateListMode();
  await Promise.all([loadTags(), loadCharts(true), loadFeatured()]);

  // 搜尋框 debounce
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    let debounce;
    searchInput.addEventListener('input', e => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        currentFilter.query = e.target.value;
        loadCharts(true);
      }, 400);
    });
  }

  // 排序選單
  const sortSelect = document.getElementById('sortSelect');
  if (sortSelect) {
    sortSelect.addEventListener('change', e => {
      currentFilter.sortBy = e.target.value;
      loadCharts(true);
    });
  }

  // 載入更多
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => loadCharts(false));
  }
});

// ── 載入標籤 ─────────────────────────────────────────────────
async function loadTags() {
  try {
    const tags = await getAllTags();
    const container = document.getElementById('topicTags');
    if (!container) return;
    container.replaceChildren();
    // popular_chart_tags already sorts by published-chart usage, most used first.
    tags.slice(0, 8).forEach(tag => {
      const button = document.createElement('button'); button.className='topic-tag';
      button.textContent='# '+tag.name;
      button.onclick=()=>window.toggleTopicTag(button,tag.id);
      container.append(button);
    });
  } catch(e) { console.error('loadTags:', e); }
}

// ── 載入譜面 ─────────────────────────────────────────────────
async function loadCharts(reset = false) {
  if (isLoading) { if (reset) pendingReset = true; return; }
  isLoading = true;

  if (reset) {
    currentPage = 0;
    hasMore     = true;
    document.getElementById('chartGrid').innerHTML = '';
    document.getElementById('resultCount').textContent = '載入中…';
  }

  const grid = document.getElementById('chartGrid');
  const requestedFavorites = favoritesMode;
  const requestedUser = currentUser?.id;
  if (favoritesMode && !currentUser) {
    grid.textContent = '請從右上選單登入帳號以查看收藏譜面';
    document.getElementById('resultCount').textContent = '';
    document.getElementById('loadMoreBtn').style.display = 'none';
    isLoading = false;
    pendingReset = false;
    return;
  }

  // Skeleton loading cards
  if (reset) {
    grid.innerHTML = Array(8).fill(`
      <div class="chart-card skeleton">
        <div class="card-cover" style="background:#1a1a2e;aspect-ratio:16/9;"></div>
        <div class="card-body">
          <div style="height:16px;background:#2a2a44;border-radius:4px;margin-bottom:8px;"></div>
          <div style="height:12px;background:#2a2a44;border-radius:4px;width:60%;"></div>
        </div>
      </div>
    `).join('');
  }

  try {
    const charts = await (favoritesMode ? getMyFavorites({page:currentPage,limit:20}) : searchCharts({
      ...currentFilter,
      page:  currentPage,
      limit: 20,
    }));
    // A filter change while awaiting a request must not render an obsolete page.
    if (pendingReset) { isLoading=false; pendingReset=false; loadCharts(true); return; }
    // Discard responses from another route/account before showing any cards.
    if (requestedFavorites !== favoritesMode || (requestedFavorites && requestedUser !== currentUser?.id)) {
      isLoading = false; pendingReset = false; loadCharts(true); return;
    }

    const total = !favoritesMode && charts.totalCount != null ? charts.totalCount : null;
    if (!favoritesMode && charts.length === 0 && total > 0 && currentPage > 0) {
      // Results may shrink between requests. Recover without losing filters.
      isLoading = false;
      return loadCharts(true);
    }

    if (reset) grid.innerHTML = '';

    if (charts.length === 0 && (reset || total === 0)) {
      hasMore = false;
      currentPage = 0;
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--text-dimmer);">${favoritesMode ? '目前沒有已收藏譜面' : '沒有找到符合條件的譜面'}</div>`;
      document.getElementById('resultCount').textContent = '0 筆';
      document.getElementById('loadMoreBtn').style.display = 'none';
      isLoading = false;
      if (pendingReset) { pendingReset=false; loadCharts(true); }
      return;
    }

    charts.forEach(chart => grid.insertAdjacentHTML('beforeend', renderCard(chart)));

    hasMore = total !== null ? (currentPage * 20 + charts.length < total) : charts.length === 20;
    currentPage++;
    document.getElementById('loadMoreBtn').style.display = hasMore ? '' : 'none';

    if (total !== null) {
      document.getElementById('resultCount').textContent = `共 ${total} 筆`;
    } else if (reset) {
      // 更新結果數（從 RPC 無法直接拿 total，簡易顯示）
      document.getElementById('resultCount').textContent = hasMore
        ? `${charts.length}+ 筆` : `共 ${charts.length} 筆`;
    }
  } catch(e) {
    console.error('loadCharts:', e);
    if (reset) {
      const message = /invalid input value for enum difficulty_type/.test(e.message)
        ? '此難度尚未啟用，請稍後再試' : `載入失敗：${e.message}`;
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:#ef4444;">${escapeHtml(message)}</div>`;
      document.getElementById('resultCount').textContent = '';
      document.getElementById('loadMoreBtn').style.display = 'none';
    }
  }

  isLoading = false;
  if (pendingReset) { pendingReset=false; loadCharts(true); }
}

// ── 渲染卡片 HTML ─────────────────────────────────────────────
function renderCard(chart) {
  const DIFF_CLASS = {
    BASIC:'diff-basic', ADVANCED:'diff-advanced',
    MASTER:'diff-master', ULTIMA:'diff-ultima',
    EXPERT:'diff-expert', WORLDS_END:'diff-we',
  };
  const coverUrl = `<div class="card-cover-img">${renderChartCover(chart)}</div>`;
  chart = { ...chart, title: escapeHtml(chart.title), composer: escapeHtml(chart.composer), charter_name: escapeHtml(chart.charter_name) };

  const stars = '★'.repeat(Math.round(chart.avg_rating || 0)) +
                '☆'.repeat(5 - Math.round(chart.avg_rating || 0));

  return `
    <div class="chart-card" onclick="location.href='chart_detail.html?id=${chart.id}'">
      <div class="card-cover">
        ${renderChartMediaStatus(chart)}
        ${coverUrl}
        <div class="worlds-end-overlay">
        <span class="card-diff-badge ${DIFF_CLASS[chart.difficulty] || 'diff-master'}">
          ${chart.difficulty === 'WORLDS_END' ? "WORLD'S END" : chart.difficulty} ${escapeHtml(chartLevel(chart))}
        </span>
        ${renderWeAttribute(chart)}
        </div>
      </div>
      <div class="card-body">
        <div class="card-title">${chart.title}</div>
        <div class="card-composer">${chart.composer}</div>
        <div class="card-designer">Chart by <span>${chart.charter_name}</span></div>
        <div class="card-footer">
          <div class="card-rating">
            <span class="stars-sm" style="color:#ffd700;">${stars.charAt(0)}</span>
            <span class="rating-val">${(chart.avg_rating || 0).toFixed(1)}</span>
            <span style="font-size:11px;color:var(--text-dimmer)">(${chart.review_count})</span>
          </div>
          <div class="card-badges"><span class="badge-zip">📦 ZIP</span></div>
        </div>
        <div class="card-stats">
          <span class="stat">👁️ ${(chart.view_count || 0).toLocaleString()}</span>
          <span class="stat">⬇️ ${(chart.download_count || 0).toLocaleString()}</span>
        </div>
      </div>
    </div>
  `;
}

// ── 難度篩選 ─────────────────────────────────────────────────
window.filterDifficulty = function(btn, diff) {
  const isActive = btn.classList.toggle('active');
  btn.setAttribute('aria-pressed', String(isActive));
  currentFilter.difficulties = isActive
    ? [...new Set([...currentFilter.difficulties, diff])]
    : currentFilter.difficulties.filter(value => value !== diff);
  const onlyWe = currentFilter.difficulties.length === 1 && currentFilter.difficulties[0] === 'WORLDS_END';
  const includeWe = !currentFilter.difficulties.length || currentFilter.difficulties.includes('WORLDS_END');
  document.getElementById('constantFilters').hidden = onlyWe;
  document.getElementById('constantLabel').hidden = onlyWe;
  document.getElementById('weFilters').hidden = !includeWe;
  // Preserve both groups' values when switching difficulty selections.
  loadCharts(true);
};

// ── 定數範圍 ─────────────────────────────────────────────────
window.updateRange = function(type, val) {
  const v = val.trim() === '' ? null : Number(val);
  if (v !== null && (!Number.isFinite(v) || v < 1)) return;
  const other = currentFilter[type === 'min' ? 'maxRating' : 'minRating'];
  if (v !== null && other !== null && (type === 'min' ? v > other : v < other)) return;
  currentFilter[type === 'min' ? 'minRating' : 'maxRating'] = v;
  loadCharts(true);
};

// ── Topic Tags ────────────────────────────────────────────────
window.toggleTopicTag = function(btn, tagId) {
  currentFilter.tagId = currentFilter.tagId === tagId ? null : tagId;
  document.querySelectorAll('#topicTags button').forEach(item => item.classList.toggle('active', item === btn && currentFilter.tagId !== null));
  loadCharts(true);
};

// 暴露給 window
window.loadCharts = loadCharts;

// Keep each cover, metadata and UUID link together in its existing slide.
let featuredSlide=0, featuredCount=0;
window.goSlide=function(index) {
  if (!featuredCount) return;
  featuredSlide=(index+featuredCount)%featuredCount;
  document.getElementById('carouselTrack').style.transform=`translateX(-${featuredSlide*(100/featuredCount)}%)`;
  document.querySelectorAll('#carouselTrack .carousel-slide').forEach((slide,i)=>{
    slide.inert=i!==featuredSlide;
    slide.setAttribute('aria-hidden',String(i!==featuredSlide));
  });
  document.querySelectorAll('#carouselDots .dot').forEach((dot,i)=>dot.classList.toggle('active',i===featuredSlide));
};
window.prevSlide=()=>window.goSlide(featuredSlide-1);
window.nextSlide=()=>window.goSlide(featuredSlide+1);
async function loadFeatured() {
  const track=document.getElementById('carouselTrack');
  try {
    const charts=await searchCharts({limit:3}); featuredCount=charts.length;
    if(!featuredCount){track.parentElement.hidden=true;return;}
    // search_charts returns cover_path but no tags; fetch tags for only these slides.
    const {data:tagRows,error:tagError}=await supabase.from('chart_tags')
      .select('chart_id,tags(name)').in('chart_id',charts.map(chart=>chart.id));
    if(tagError) console.error('loadFeatured tags:',tagError);
    charts.forEach(chart=>{
      chart.tags=(tagRows || []).filter(row=>row.chart_id===chart.id).map(row=>row.tags).filter(Boolean);
    });
    track.style.width=`${featuredCount*100}%`;
    track.innerHTML=charts.map((chart,index)=>{
      const detailUrl=`chart_detail.html?id=${encodeURIComponent(chart.id)}`;
      const tags=(chart.tags || []).slice(0,4).map(tag=>`<span class="carousel-tag"># ${escapeHtml(tag.name)}</span>`).join('');
      const extraTags=(chart.tags || []).length-4;
      return `<div class="carousel-slide" style="width:${100/featuredCount}%">
        <div class="carousel-bg">${renderChartCover(chart,{priority:index===0})}</div>
        ${renderChartMediaStatus(chart)}
        <div class="carousel-overlay"></div>
        <a class="carousel-card-link" href="${detailUrl}" aria-label="${escapeHtml(chart.title)}：查看譜面詳情"></a>
        <div class="carousel-content"><div class="carousel-info">
          <div class="carousel-badge">最新發布</div>
          <div class="carousel-title">${escapeHtml(chart.title)}</div>
          <div class="carousel-meta">${escapeHtml(chart.composer)} · Chart by ${escapeHtml(chart.charter_name)}</div>
          <div class="carousel-details"><span class="difficulty-badge ${{BASIC:'diff-basic',ADVANCED:'diff-advanced',EXPERT:'diff-expert',MASTER:'diff-master',ULTIMA:'diff-ultima',WORLDS_END:'diff-we'}[chart.difficulty] || ''}">${escapeHtml(chart.difficulty === 'WORLDS_END' ? "WORLD'S END" : chart.difficulty)} ${escapeHtml(chartLevel(chart))}</span><span class="carousel-rating">★ ${Number(chart.avg_rating || 0).toFixed(1)} (${Number(chart.review_count || 0)})</span></div>
          <div class="carousel-tags">${tags}${extraTags>0?`<span class="carousel-tag">+${extraTags}</span>`:''}</div>
        </div><div class="carousel-actions"><a class="btn-viewer" href="${detailUrl}">查看譜面詳情</a></div></div>
      </div>`;
    }).join('');
    document.getElementById('carouselDots').innerHTML=charts.map((_,index)=>`<button class="dot ${index===0?'active':''}" onclick="goSlide(${index})" aria-label="第 ${index+1} 張譜面"></button>`).join('');
    window.goSlide(0);
    if(featuredCount>1)setInterval(()=>window.nextSlide(),4500);
  } catch {track.textContent='譜面載入失敗';}
}

window.updateWeSearch = function() {
 currentFilter.weStarLevel = Number(document.getElementById('weSearchStar').value) || null;
 currentFilter.weAttribute = document.getElementById('weSearchAttribute').value.trim() || null;
 loadCharts(true);
};
