// ============================================================
// js/pages/index.js — 首頁邏輯（接入真實後端）
// ============================================================
import { initAuth, requireAuth, currentUser } from '../auth.js';
import { searchCharts, getAllTags } from '../api.js';
import { downloadChart } from '../storage.js';
import { getStorageUrl } from '../supabase.js';
import { renderChartCover, escapeHtml } from '../chart-cover.js';

// ── 狀態 ─────────────────────────────────────────────────────
let currentPage   = 0;
let isLoading     = false;
let hasMore       = true;
let currentFilter = {
  query:      '',
  difficulty: null,
  minRating:  1.0,
  maxRating:  16.0,
  sortBy:     'published_at',
};

// ── 初始化 ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();
  await loadTags();
  await loadCharts(true);

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
    container.innerHTML = tags.map(tag => `
      <button class="topic-tag" data-tag-id="${tag.id}"
              onclick="toggleTopicTag(this, ${tag.id})"
              style="--tag-color:${tag.color}">
        # ${tag.name}
      </button>
    `).join('');
  } catch(e) { console.error('loadTags:', e); }
}

// ── 載入譜面 ─────────────────────────────────────────────────
async function loadCharts(reset = false) {
  if (isLoading) return;
  isLoading = true;

  if (reset) {
    currentPage = 0;
    hasMore     = true;
    document.getElementById('chartGrid').innerHTML = '';
    document.getElementById('resultCount').textContent = '載入中…';
  }

  const grid = document.getElementById('chartGrid');

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
    const charts = await searchCharts({
      ...currentFilter,
      page:  currentPage,
      limit: 20,
    });

    if (reset) grid.innerHTML = '';

    if (charts.length === 0 && reset) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--text-dimmer);">沒有找到符合條件的譜面</div>`;
      document.getElementById('resultCount').textContent = '0 筆';
      document.getElementById('loadMoreBtn').style.display = 'none';
      isLoading = false;
      return;
    }

    charts.forEach(chart => grid.insertAdjacentHTML('beforeend', renderCard(chart)));

    hasMore = charts.length === 20;
    currentPage++;
    document.getElementById('loadMoreBtn').style.display = hasMore ? '' : 'none';

    if (reset) {
      // 更新結果數（從 RPC 無法直接拿 total，簡易顯示）
      document.getElementById('resultCount').textContent = hasMore
        ? `${charts.length}+ 筆` : `共 ${charts.length} 筆`;
    }
  } catch(e) {
    console.error('loadCharts:', e);
    if (reset) grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:#ef4444;">載入失敗：${e.message}</div>`;
  }

  isLoading = false;
}

// ── 渲染卡片 HTML ─────────────────────────────────────────────
function renderCard(chart) {
  const DIFF_CLASS = {
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
        ${coverUrl}
        <span class="card-diff-badge ${DIFF_CLASS[chart.difficulty] || 'diff-master'}">
          ${chart.difficulty} ${chart.rating}
        </span>
        ${chart.strip_url ? '<span class="card-viewer-badge">🖼️ 展譜圖</span>' : ''}
        <div class="card-hover-actions">
          ${chart.strip_url ? `<button class="card-hover-btn" onclick="event.stopPropagation();location.href='viewer.html?id=${chart.id}'">🖼️ 展譜</button>` : ''}
          <button class="card-hover-btn primary"
            onclick="event.stopPropagation();handleDownload(event,'${chart.id}')">
            📦 下載
          </button>
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

// ── 下載處理（需登入 or 訪客皆可，但記錄需登入） ─────────────
window.handleDownload = async function(e, chartId) {
  e.stopPropagation();
  try {
    await downloadChart(chartId);
  } catch(err) { alert('下載失敗：' + err.message); }
};

// ── 難度篩選 ─────────────────────────────────────────────────
window.filterDifficulty = function(btn, diff) {
  const isActive = btn.classList.toggle('active');
  currentFilter.difficulty = isActive ? diff : null;
  // 互斥：取消其他
  document.querySelectorAll('.diff-tag').forEach(b => {
    if (b !== btn) b.classList.remove('active');
  });
  loadCharts(true);
};

// ── 定數範圍 ─────────────────────────────────────────────────
window.updateRange = function(type, val) {
  const v = parseInt(val) / 10;
  document.getElementById(type === 'min' ? 'minVal' : 'maxVal').textContent = v.toFixed(1);
  currentFilter[type === 'min' ? 'minRating' : 'maxRating'] = v;
  loadCharts(true);
};

// ── Topic Tags ────────────────────────────────────────────────
window.toggleTopicTag = function(btn) { btn.classList.toggle('active'); };

// 暴露給 window
window.loadCharts = loadCharts;
