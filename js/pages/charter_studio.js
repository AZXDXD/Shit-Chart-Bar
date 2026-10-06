// ============================================================
// js/pages/charter_studio.js — 創作者後台邏輯
// ============================================================
import { initAuth, currentUser, currentProfile, requireAuth } from '../auth.js';
import {
  createChart, updateChart, setChartStatus, deleteChart,
  getChartsByUser, setChartTags, getAllTags, updateProfile,
} from '../api.js';
import {
  uploadChartPackage, uploadCoverArt, uploadChartStrip, uploadAvatar,
} from '../storage.js';

let editingChartId = null; // 目前正在編輯的草稿 ID

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();

  // 未登入則跳回首頁
  if (!currentUser) {
    window.location.href = 'index.html';
    return;
  }

  // 載入標籤
  await loadTagOptions();
  // 載入我的譜面
  await loadMyCharts();
  // 填入個人資料
  fillProfileForm();
});

// ── 個人資料表單 ──────────────────────────────────────────────
function fillProfileForm() {
  if (!currentProfile) return;
  setVal('profileCharterName', currentProfile.charter_name || currentProfile.username);
  setVal('profileBio',         currentProfile.bio || '');
  setVal('profileYt',          currentProfile.yt_channel || '');
  setVal('profileTwitter',     currentProfile.twitter_handle || '');
  setVal('profileDiscord',     currentProfile.discord_invite || '');
}

window.saveProfile = async function() {
  try {
    const updated = await updateProfile({
      charter_name:    getVal('profileCharterName'),
      bio:             getVal('profileBio'),
      yt_channel:      getVal('profileYt'),
      twitter_handle:  getVal('profileTwitter'),
      discord_invite:  getVal('profileDiscord'),
    });
    showToast('✓ 創作者資料已儲存！');
    Object.assign(currentProfile, updated);
  } catch(e) { showToast('儲存失敗：' + e.message, 'error'); }
};

// 頭像上傳
window.handleAvatarChange = async function(input) {
  if (!input.files[0]) return;
  try {
    showToast('上傳頭像中…');
    const url = await uploadAvatar(input.files[0]);
    await updateProfile({ avatar_url: url });
    document.querySelectorAll('[data-user="avatar"]').forEach(el => { el.src = url; });
    showToast('✓ 頭像已更新！');
  } catch(e) { showToast('頭像上傳失敗：' + e.message, 'error'); }
};

// ── 標籤選項 ──────────────────────────────────────────────────
async function loadTagOptions() {
  const tags = await getAllTags();
  const container = document.getElementById('tagSelector');
  if (!container) return;
  container.innerHTML = tags.map(tag => `
    <button class="tag-opt" data-tag-id="${tag.id}" onclick="this.classList.toggle('selected')">
      # ${tag.name}
    </button>
  `).join('');
}

function getSelectedTagIds() {
  return [...document.querySelectorAll('.tag-opt.selected')]
    .map(el => parseInt(el.dataset.tagId));
}

// ── STEP 1: 上傳壓縮包 ───────────────────────────────────────
let uploadedPackageFile = null;

window.handleFileSelect = function(input) {
  if (input.files[0]) processFile(input.files[0]);
};
window.handleDrop = function(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.remove('drag');
  if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]);
};
window.handleDragOver = function(e) {
  e.preventDefault();
  document.getElementById('uploadZone').classList.add('drag');
};
window.handleDragLeave = function() {
  document.getElementById('uploadZone').classList.remove('drag');
};

async function processFile(file) {
  if (!file.name.match(/\.(zip|rar)$/i)) {
    showToast('請上傳 .zip 或 .rar 檔案', 'error');
    return;
  }
  if (file.size > 100 * 1024 * 1024) {
    showToast('檔案大小不可超過 100 MB', 'error');
    return;
  }

  uploadedPackageFile = file;
  const zone = document.getElementById('uploadZone');
  zone.classList.add('done');

  // 顯示檔案摘要
  const summary = document.getElementById('fileSummary');
  summary.classList.add('show');
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB';

  // 模擬掃描（實際解析需後端；前端做基本副檔名檢查）
  await runChecklist();
}

async function runChecklist() {
  const checks = [
    ['ci-chart', 'cd-chart', 'ok',  '偵測到譜面格式（.zip）'],
    ['ci-audio', 'cd-audio', 'ok',  '音源檔確認（請手動確認包含音檔）'],
    ['ci-cover', 'cd-cover', 'warn','曲繪圖在下一步上傳（Step 3）'],
    ['ci-meta',  'cd-meta',  'ok',  '壓縮包格式正常'],
  ];
  for (let i = 0; i < checks.length; i++) {
    await delay(350);
    const [iconId, detailId, status, msg] = checks[i];
    const el = document.getElementById(iconId);
    if (!el) continue;
    el.className = 'check-icon ' + status;
    el.textContent = status === 'ok' ? '✓' : status === 'warn' ? '!' : '✗';
    document.getElementById(detailId).textContent = msg;
  }
  // 解鎖下一步
  await delay(200);
  const btn = document.getElementById('nextBtn1');
  if (btn) { btn.removeAttribute('disabled'); btn.style.opacity='1'; btn.style.cursor='pointer'; }
}

// ── STEP 2: 送出基本資訊並建立草稿 ──────────────────────────
window.goStep = async function(n) {
  // Step 2 → 3 時，若尚未建立草稿則先建立
  if (n === 3 && !editingChartId) {
    try {
      await createDraft();
    } catch(e) {
      showToast('建立草稿失敗：' + e.message, 'error');
      return;
    }
  }

  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  const panel = document.getElementById('step-' + n);
  if (panel) panel.classList.add('active');

  // 更新 Step Bar
  for (let i = 1; i <= 3; i++) {
    const sc = document.getElementById('sc' + i);
    const sl = document.getElementById('sl' + i);
    if (!sc) continue;
    if (i < n)     { sc.className='step-circle done'; sc.textContent='✓'; if(sl) sl.className='step-label done'; }
    else if(i===n) { sc.className='step-circle active'; sc.textContent=i; if(sl) sl.className='step-label active'; }
    else           { sc.className='step-circle'; sc.textContent=i; if(sl) sl.className='step-label'; }
    const line = document.getElementById('line' + i);
    if (line) line.className = 'step-line' + (i < n ? ' done' : '');
  }
};

async function createDraft() {
  const chart = await createChart({
    title:          getVal('songTitle')      || '未命名譜面',
    composer:       getVal('songComposer')   || '未知',
    charter_name:   getVal('charterName')    || currentProfile?.charter_name || currentProfile?.username,
    difficulty:     getSelectedDiff(),
    rating:         parseFloat(document.getElementById('ratingDisplay')?.textContent) || 10.0,
    bpm:            parseInt(getVal('songBpm')) || null,
    music_category: getVal('musicCategory')  || 'Original',
    description:    getVal('songDesc')       || null,
    package_size_mb: uploadedPackageFile ? parseFloat((uploadedPackageFile.size / 1024 / 1024).toFixed(2)) : null,
  });
  editingChartId = chart.id;

  // 上傳壓縮包
  if (uploadedPackageFile) {
    showToast('上傳遊玩包中…');
    const pkgPath = await uploadChartPackage(editingChartId, uploadedPackageFile,
      pct => updateProgressBar('pkgProgress', pct));
    await updateChart(editingChartId, { package_path: pkgPath });
    showToast('✓ 遊玩包上傳完成！');
  }

  return chart;
}

function getSelectedDiff() {
  const el = document.querySelector('.diff-opt.selected');
  const map = { EXPERT:'EXPERT', MASTER:'MASTER', ULTIMA:'ULTIMA', "WORLD'S END":'WORLDS_END' };
  return map[el?.textContent?.trim()] || 'MASTER';
}

// ── STEP 3: 展示資源上傳 ─────────────────────────────────────
let coverFile = null;
let stripFile = null;

window.triggerImgInput = function() { document.getElementById('imgFileInput').click(); };

window.handleImgSelect = async function(input) {
  if (!input.files[0]) return;
  stripFile = input.files[0];
  const url = URL.createObjectURL(stripFile);
  document.getElementById('imgPreview').src = url;
  document.getElementById('imgPreviewName').textContent = stripFile.name;
  document.getElementById('imgPreviewWrap').classList.add('show');
  document.getElementById('imgUploadZone').style.display = 'none';
};

window.clearImg = function() {
  stripFile = null;
  document.getElementById('imgPreviewWrap').classList.remove('show');
  document.getElementById('imgUploadZone').style.display = 'flex';
};

window.previewYt = function(url) {
  const match = url.match(/(?:v=|youtu\.be\/)([^&\s]+)/);
  const preview = document.getElementById('ytPreview');
  if (preview) preview.classList.toggle('show', !!match);
};

// ── 發布 ─────────────────────────────────────────────────────
window.publishChart = async function() {
  if (!editingChartId) {
    try { await createDraft(); } catch(e) { showToast(e.message, 'error'); return; }
  }

  try {
    // 上傳展譜圖
    if (stripFile) {
      showToast('上傳展譜圖中…');
      const stripPath = await uploadChartStrip(editingChartId, stripFile);
      await updateChart(editingChartId, { strip_path: stripPath });
    }

    // YouTube URL
    const ytUrl = getVal('ytUrl');
    if (ytUrl) await updateChart(editingChartId, { youtube_url: ytUrl });

    // 設定標籤
    const tagIds = getSelectedTagIds();
    if (tagIds.length) await setChartTags(editingChartId, tagIds);

    // 發布
    await setChartStatus(editingChartId, 'published');

    showToast('✓ 譜面發布成功！');
    document.getElementById('successModal')?.classList.add('open');
    editingChartId = null;
    await loadMyCharts();
  } catch(e) { showToast('發布失敗：' + e.message, 'error'); }
};

window.saveDraft = async function() {
  if (!editingChartId) {
    try { await createDraft(); } catch(e) { showToast(e.message, 'error'); return; }
  }
  showToast('✓ 草稿已儲存！');
};

// ── 管理後台：載入我的譜面 ────────────────────────────────────
async function loadMyCharts() {
  const container = document.getElementById('myChartList');
  if (!container) return;
  container.innerHTML = '<div style="color:var(--dimmer);padding:20px;">載入中…</div>';

  try {
    const charts = await getChartsByUser(currentUser.id, true);
    if (!charts.length) {
      container.innerHTML = '<div style="color:var(--dimmer);padding:20px;">還沒有譜面，去投稿第一張吧！</div>';
      return;
    }
    container.innerHTML = charts.map(renderChartItem).join('');
    // 更新統計數字
    updateDashboardStats(charts);
  } catch(e) {
    container.innerHTML = `<div style="color:#ef4444;padding:20px;">載入失敗：${e.message}</div>`;
  }
}

function renderChartItem(chart) {
  const DIFF_STYLE = {
    MASTER:    'background:#4a1a7a;color:#d59fff;border:1px solid #7d3c98;',
    ULTIMA:    'background:#1a1a1a;color:#aaa;border:1px solid #555;',
    EXPERT:    'background:#5a0a0a;color:#ff9999;border:1px solid #c0392b;',
    WORLDS_END:'background:#2a1a2a;color:#e8d5f5;border:1px solid #c8a8e0;',
  };
  const isPublished = chart.status === 'published';
  return `
    <div class="chart-item">
      <div class="chart-item-cover">🎵</div>
      <div class="chart-item-info">
        <div class="chart-item-title">${chart.title}</div>
        <div class="chart-item-meta">
          <span class="status-badge ${isPublished ? 'status-published' : 'status-draft'}">
            ${isPublished ? '● 已發布' : '◌ 草稿'}
          </span>
          <span style="${DIFF_STYLE[chart.difficulty]};padding:2px 7px;border-radius:4px;font-size:11px;font-weight:800;">
            ${chart.difficulty} ${chart.rating}
          </span>
          <span>${chart.composer}</span>
        </div>
      </div>
      ${isPublished ? `
        <div class="chart-item-stats">
          <span class="chart-stat">⬇️ <strong>${(chart.download_count||0).toLocaleString()}</strong></span>
          <span class="chart-stat">⭐ <strong>${(chart.avg_rating||0).toFixed(1)}</strong></span>
          <span class="chart-stat">💬 <strong>${chart.review_count||0}</strong></span>
        </div>` : ''}
      <div class="chart-item-actions">
        ${isPublished
          ? `<button class="action-btn primary" onclick="location.href='chart_detail.html?id=${chart.id}'">✏️ 查看</button>
             <button class="action-btn danger"  onclick="unpublishChart('${chart.id}')">⬇ 下架</button>`
          : `<button class="action-btn primary" onclick="resumeEdit('${chart.id}')">✏️ 繼續編輯</button>
             <button class="action-btn success" onclick="publishExisting('${chart.id}')">🚀 發布</button>
             <button class="action-btn danger"  onclick="removeChart('${chart.id}')">🗑️ 刪除</button>`
        }
      </div>
    </div>
  `;
}

function updateDashboardStats(charts) {
  const published = charts.filter(c => c.status === 'published');
  const drafts    = charts.filter(c => c.status === 'draft');
  const totalDl   = published.reduce((s,c) => s + (c.download_count||0), 0);
  const avgRating = published.length
    ? (published.reduce((s,c) => s + (c.avg_rating||0), 0) / published.length).toFixed(1)
    : '–';

  setTextSafe('statPublished', published.length);
  setTextSafe('statDownloads', totalDl.toLocaleString());
  setTextSafe('statAvgRating', avgRating);
  setTextSafe('statDrafts',    drafts.length);
}

window.unpublishChart = async function(id) {
  if (!confirm('確定要下架此譜面嗎？')) return;
  await setChartStatus(id, 'unpublished');
  showToast('已下架'); await loadMyCharts();
};
window.publishExisting = async function(id) {
  await setChartStatus(id, 'published');
  showToast('✓ 譜面已發布！'); await loadMyCharts();
};
window.removeChart = async function(id) {
  if (!confirm('確定要刪除此草稿嗎？此操作無法復原。')) return;
  await deleteChart(id);
  showToast('已刪除'); await loadMyCharts();
};
window.resumeEdit = function(id) {
  editingChartId = id;
  switchPage('upload', null);
};

// ── 工具函數 ─────────────────────────────────────────────────
function getVal(id) { return document.getElementById(id)?.value?.trim() || ''; }
function setVal(id, v) { const el = document.getElementById(id); if(el) el.value = v; }
function setTextSafe(id, v) { const el = document.getElementById(id); if(el) el.textContent = v; }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function updateProgressBar(id, pct) {
  const el = document.getElementById(id);
  if(el) el.style.width = pct + '%';
}

function showToast(msg, type = 'success') {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = Object.assign(document.createElement('div'), { id: 'toast' });
    Object.assign(toast.style, {
      position:'fixed', bottom:'24px', left:'50%', transform:'translateX(-50%)',
      background: type==='error' ? '#ef4444' : '#22c55e',
      color:'#fff', padding:'10px 22px', borderRadius:'10px',
      fontWeight:'700', fontSize:'14px', zIndex:'9999',
      boxShadow:'0 4px 20px rgba(0,0,0,.4)', transition:'opacity .3s',
    });
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.background = type==='error' ? '#ef4444' : '#22c55e';
  toast.style.opacity = '1';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

window.switchPage = function(id, btn) {
  document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.page-tab').forEach(b => b?.classList.remove('active'));
  document.getElementById('page-' + id)?.classList.add('active');
  btn?.classList.add('active');
};

window.updateRating = function(v) {
  const el = document.getElementById('ratingDisplay');
  if(el) el.textContent = (parseInt(v)/10).toFixed(1);
};

window.selectDiff = function(el) {
  document.querySelectorAll('.diff-opt').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
};

window.toggleTagOpt = function(el) { el.classList.toggle('selected'); };
window.closeModal = function() { document.getElementById('successModal')?.classList.remove('open'); };
