import { chartLevel, difficultyMetadata, renderWeAttribute } from '../chart-metadata.js';
import { renderChartMediaStatus } from '../chart-media-status.js';
import { createTagEditor } from '../chart-tags.js';
import { searchChartTags, getAllTags } from '../api.js';
// ============================================================
// js/pages/charter_studio.js — 創作者後台邏輯
// ============================================================
import { initAuth, currentUser, currentProfile, requireAuth, fetchProfile, getUserDisplayData, getProviderAvatar, updateAllAuthUI } from '../auth.js';
import {
  createChart, updateChart, setChartStatus, deleteChart,
  getChartsByUser, getChart, setChartTags, updateProfile,
} from '../api.js';
import {
  uploadChartPackage, uploadCoverArt, uploadChartStrip, uploadAvatar,
} from '../storage.js';

import { inspectPackage } from '../package-validation.js';
import { renderChartCover } from '../chart-cover.js';

let editingChartId = null; // 目前正在編輯的草稿 ID
let studioOwner = null;
let editingExisting = false;

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth();

  if (!currentUser) { requireAuth(() => {}); return; }
  await initializeStudio();
});

async function initializeStudio() {
  const id = currentUser?.id;
  if (!id) return;
  if (studioOwner !== id) {
    studioOwner = id;
    tagEditor?.set([]);
    editingExisting = false; coverFile = null;
    editingChartId = null; uploadedPackageFile = null; packageCheck = null; stripFile = null;
    ++scanRevision;
    document.getElementById('myChartList').textContent = '載入中…';
    document.getElementById('nextBtn1').disabled = true;
    updateDashboardStats([]);
  }
  const profile = await fetchProfile(id);
  if (currentUser?.id !== id) return;
  fillProfileForm(profile);
  await Promise.all([loadTagOptions().catch(e => showToast(e.message, 'error')), loadMyCharts()]);
}
window.addEventListener('authLogin', initializeStudio);
window.addEventListener('authLogout', () => {
  tagEditor?.set([]);
  editingExisting = false; coverFile = null;
  editingChartId = null; uploadedPackageFile = null; packageCheck = null; stripFile = null;
  document.getElementById('myChartList').textContent = '請先登入以管理你的譜面';
  updateDashboardStats([]); fillProfileForm(null);
});
window.addEventListener('authProfileLoaded', () => fillProfileForm());
window.resetProfileForm = () => fillProfileForm();

// ── 個人資料表單 ──────────────────────────────────────────────
function fillProfileForm(profile = currentProfile) {
  const identity = getUserDisplayData(currentUser, profile);
  setVal('profileCharterName', currentUser ? identity.name : '');
  setVal('charterName', currentUser ? identity.name : '');
  setVal('profileBio',         profile?.bio || '');
  setVal('profileYt',          profile?.yt_channel || '');
  setVal('profileTwitter',     profile?.twitter_handle || '');
  setVal('profileDiscord',     profile?.discord_invite || '');
}

window.saveProfile = async function() {
  try {
    if (!getVal('profileCharterName')) throw new Error('請填寫名稱');
    const updated = await updateProfile({
      charter_name:    getVal('profileCharterName'),
      bio:             getVal('profileBio'),
      yt_channel:      getVal('profileYt'),
      twitter_handle:  getVal('profileTwitter'),
      discord_invite:  getVal('profileDiscord'),
    });
    showToast('✓ 帳號資料已儲存！');
    if (currentProfile) Object.assign(currentProfile, updated);
    updateAllAuthUI();
  } catch(e) { showToast('儲存失敗：' + e.message, 'error'); }
};

// 頭像上傳
window.handleAvatarChange = async function(input) {
  if (!input.files[0]) return;
  try {
    showToast('上傳頭像中…');
    const url = await uploadAvatar(input.files[0]);
    const updated = await updateProfile({ avatar_url: url });
    if (currentProfile) Object.assign(currentProfile, updated);
    updateAllAuthUI();
    document.querySelectorAll('[data-user="avatar"]').forEach(el => { el.src = url; });
    showToast('✓ 頭像已更新！');
  } catch(e) { showToast('頭像上傳失敗：' + e.message, 'error'); }
  finally { input.value = ''; }
};

window.restoreDefaultAvatar = async function() {
  const button = document.getElementById('restoreAvatarBtn');
  button.disabled = true;
  try {
    const avatar = getProviderAvatar();
    if (!avatar) throw new Error('目前登入資料沒有 Google / Discord 頭像，請重新登入後再試');
    await updateProfile({ avatar_url: avatar });
    updateAllAuthUI();
    showToast('✓ 已恢復預設頭像！');
  } catch (e) { showToast('恢復失敗：' + e.message, 'error'); }
  finally { button.disabled = false; }
};

// ── 標籤選項 ──────────────────────────────────────────────────
let tagEditor;
async function loadTagOptions() {
  if (!tagEditor) tagEditor = createTagEditor(document.getElementById('tagSelector'), document.getElementById('customTagInput'), document.getElementById('addCustomTag'), document.getElementById('customTagHint'), {
    dropdown: document.getElementById('tagSuggestions'),
    search: query => searchChartTags(query, 10),
    popular: async () => (await getAllTags()).slice(0, 10),
  });
}
function getSelectedTagNames() { return tagEditor?.get() || []; }

// ── STEP 1: 上傳壓縮包 ───────────────────────────────────────
let uploadedPackageFile = null;
let packageCheck = null, scanRevision = 0;

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
  if (editingExisting) { showToast('編輯既有譜面時不能替換遊玩包', 'error'); return; }
  if (!currentUser) { requireAuth(() => {}); return; }
  const revision = ++scanRevision;
  uploadedPackageFile = null; packageCheck = null;
  const btn = document.getElementById('nextBtn1');
  btn.disabled = true; btn.style.opacity = '.4';
  try {
    const result = await inspectPackage(file);
    if (revision !== scanRevision || !currentUser) return;
    for (const kind of ['chart','audio','cover']) {
      const found = result.found[kind];
      const icon = document.getElementById('ci-' + kind);
      icon.className = 'check-icon ' + (found ? 'ok' : 'warn');
      icon.textContent = found ? '✓' : '✗';
      document.getElementById('cd-' + kind).textContent = found ? found.name : result.missing.find(m => m.includes(kind === 'chart' ? '譜面' : kind === 'audio' ? '音源' : '曲繪'));
    }
    if (result.missing.length) throw new Error(result.missing.join('；'));
    uploadedPackageFile = file; packageCheck = result;
    document.getElementById('uploadZone').classList.add('done');
    document.getElementById('fileSummary').classList.add('show');
    setTextSafe('fileName', file.name); setTextSafe('fileSize', (file.size / 1024 / 1024).toFixed(2) + ' MB');
    btn.disabled = false; btn.style.opacity = '1'; btn.style.cursor = 'pointer';
  } catch (e) { if (revision === scanRevision) showToast(e.message, 'error'); }
}

// ── STEP 2: 送出基本資訊並建立草稿 ──────────────────────────
window.goStep = async function(n) {
  if (!currentUser) { requireAuth(() => {}); return; }
  if (n > 1 && !editingChartId && !packageCheck) { showToast('請先上傳完整遊玩包', 'error'); return; }
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
  if (!currentUser) throw new Error('請先登入');
  if (!packageCheck || !uploadedPackageFile) throw new Error('請先上傳完整遊玩包');
  if (!getVal('songTitle') || !getVal('songComposer')) throw new Error('請填寫曲名與作曲家');
  const chart = await createChart({
    title:          getVal('songTitle')      || '未命名譜面',
    composer:       getVal('songComposer')   || '未知',
    charter_name:   getVal('charterName')    || currentProfile?.charter_name || currentProfile?.username,
    difficulty:     getSelectedDiff(),
    ...readDifficultyMetadata(),
    bpm:            parseInt(getVal('songBpm')) || null,
    music_category: getVal('musicCategory')  || 'Original',
    description:    getVal('songDesc')       || null,
    package_size_mb: uploadedPackageFile ? parseFloat((uploadedPackageFile.size / 1024 / 1024).toFixed(2)) : null,
  });
  editingChartId = chart.id;

  // 上傳壓縮包
  try {
  if (uploadedPackageFile) {
    showToast('上傳遊玩包中…');
    const pkgPath = await uploadChartPackage(editingChartId, uploadedPackageFile,
      pct => updateProgressBar('pkgProgress', pct));
    const cover = packageCheck.found.cover;
    const coverPath = await uploadCoverArt(editingChartId, new File([cover.bytes], 'cover.' + cover.ext, { type: cover.ext === 'png' ? 'image/png' : 'image/jpeg' }));
    await updateChart(editingChartId, { package_path: pkgPath, cover_path: coverPath });
    showToast('✓ 遊玩包上傳完成！');
  }
  } catch (error) {
    // Keep the failed draft visible in management, but retry submission as a fresh draft.
    editingChartId = null;
    throw error;
  }

  return chart;
}

function getSelectedDiff() {
  const el = document.querySelector('.diff-opt.selected');
  const map = { BASIC:'BASIC', ADVANCED:'ADVANCED', EXPERT:'EXPERT', MASTER:'MASTER', ULTIMA:'ULTIMA', "WORLD'S END":'WORLDS_END' };
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
  if (editingExisting) { await window.saveDraft(); return; }
  if (!currentUser) { requireAuth(() => {}); return; }
  if (!editingChartId) {
    try { await createDraft(); } catch(e) { showToast(e.message, 'error'); return; }
  }

  try {
    await updateChart(editingChartId, {
      title: getVal('songTitle'), composer: getVal('songComposer'),
      charter_name: getVal('charterName'), description: getVal('songDesc'),
      ...readDifficultyMetadata(),
      music_category: getVal('musicCategory'), bpm: parseInt(getVal('songBpm')) || null,
    });
    // 上傳展譜圖
    if (coverFile) {
      const coverPath = await uploadCoverArt(editingChartId, coverFile);
      await updateChart(editingChartId, { cover_path: coverPath });
      coverFile = null;
    }
    if (stripFile) {
      showToast('上傳展譜圖中…');
      const stripPath = await uploadChartStrip(editingChartId, stripFile);
      await updateChart(editingChartId, { strip_path: stripPath });
    }

    // YouTube URL
    const ytUrl = getVal('ytUrl');
    if (ytUrl) await updateChart(editingChartId, { youtube_url: ytUrl });

    // 設定標籤
    const tagIds = getSelectedTagNames();
    await setChartTags(editingChartId, tagIds);

    // 發布
    await setChartStatus(editingChartId, 'published');

    showToast('✓ 譜面發布成功！');
    document.getElementById('successModal')?.classList.add('open');
    const publishedId = editingChartId;
    document.getElementById('publishedChartLink').onclick = () => { location.href = 'chart_detail.html?id=' + publishedId; };
    editingChartId = null; uploadedPackageFile = null; packageCheck = null;
    await window.goStep(1);
    await loadMyCharts();
  } catch(e) { showToast('發布失敗：' + e.message, 'error'); }
};

window.saveDraft = async function() {
  try {
  if (!editingChartId) {
    try { await createDraft(); } catch(e) { showToast(e.message, 'error'); return; }
  }
  if (!getVal('songTitle') || !getVal('songComposer')) throw new Error('請填寫曲名與作曲家');
  const updates = { title: getVal('songTitle'), composer: getVal('songComposer'), charter_name: getVal('charterName'), description: getVal('songDesc') || null, ...readDifficultyMetadata(), bpm: parseInt(getVal('songBpm')) || null, music_category: getVal('musicCategory'), youtube_url: getVal('ytUrl') || null };
  if (coverFile) updates.cover_path = await uploadCoverArt(editingChartId, coverFile);
  if (stripFile) updates.strip_path = await uploadChartStrip(editingChartId, stripFile);
  await updateChart(editingChartId, updates);
  await setChartTags(editingChartId, getSelectedTagNames());
  coverFile = null; stripFile = null;
  showToast('✓ 譜面資料已儲存，發布狀態維持不變！'); await loadMyCharts();
  } catch (e) { showToast('儲存失敗：' + e.message, 'error'); }
};

// ── 管理後台：載入我的譜面 ────────────────────────────────────
async function loadMyCharts() {
  const container = document.getElementById('myChartList');
  if (!container) return;
  if (!currentUser) { container.textContent = '請先登入以管理你的譜面'; return; }
  const ownerId = currentUser.id;
  container.innerHTML = '<div style="color:var(--dimmer);padding:20px;">載入中…</div>';

  try {
    const charts = await getChartsByUser(currentUser.id, true);
    if (currentUser?.id !== ownerId) return;
    updateDashboardStats(charts);
    if (!charts.length) {
      container.innerHTML = `<div style="color:var(--dimmer);padding:20px;">你目前還沒有投稿任何譜面 <button class="action-btn primary" onclick="switchPage('upload')">投稿自製譜</button></div>`;
      return;
    }
    container.innerHTML = charts.map(renderChartItem).join('');
    // 更新統計數字
    updateDashboardStats(charts);
  } catch(e) {
    container.innerHTML = `<div style="color:#ef4444;padding:20px;">載入失敗：${escapeHtml(e.message)}</div>`;
  }
}

function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function renderChartItem(chart) {
  const cover = renderChartCover(chart);
  chart = { ...chart, title: escapeHtml(chart.title), composer: escapeHtml(chart.composer) };
  const DIFF_CLASS = {BASIC:'diff-basic',ADVANCED:'diff-advanced',EXPERT:'diff-expert',MASTER:'diff-master',ULTIMA:'diff-ultima',WORLDS_END:'diff-we'};
  const isPublished = chart.status === 'published';
  return `
    <div class="chart-item my-chart-item" role="link" tabindex="0" onclick="if(!event.target.closest('.chart-item-actions'))location.href='chart_detail.html?id=${chart.id}'" onkeydown="if(event.target===this && event.key==='Enter')location.href='chart_detail.html?id=${chart.id}'">
      <div class="chart-item-main">
      <div class="chart-item-cover" style="overflow:hidden;">${cover}</div>
      <div class="chart-item-info">
        <div class="chart-item-title">${chart.title}</div>
        <div class="chart-item-meta">
          <span class="status-badge ${isPublished ? 'status-published' : 'status-draft'}">
            ${isPublished ? '● 已發布' : '◌ 草稿'}
          </span>
          <div class="studio-difficulty-stack"><span class="${DIFF_CLASS[chart.difficulty] || ''}" style="padding:2px 7px;border-radius:4px;font-size:11px;font-weight:800;">
            ${chart.difficulty === 'WORLDS_END' ? "WORLD'S END" : chart.difficulty} ${chartLevel(chart)}
          </span>${renderWeAttribute(chart)}</div>
          <span>${chart.composer}</span>
        </div>
        ${renderChartMediaStatus(chart, 'inline')}
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
          ? `<button class="action-btn primary" onclick="resumeEdit('${chart.id}')">✏️ 編輯</button>
             <button class="action-btn" onclick="location.href='chart_detail.html?id=${chart.id}'">查看詳情</button>
             <button class="action-btn danger"  onclick="unpublishChart('${chart.id}')">⬇ 下架</button>`
          : `<button class="action-btn" onclick="location.href='chart_detail.html?id=${chart.id}'">查看詳情</button>
             <button class="action-btn primary" onclick="resumeEdit('${chart.id}')">✏️ 繼續編輯</button>
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
window.resumeEdit = async function(id) {
  try {
  const ownerId = currentUser?.id;
  if (!ownerId) throw new Error('請先登入');
  const chart = await getChart(id, { countView: false });
  if (currentUser?.id !== ownerId || chart.user_id !== ownerId) throw new Error('只能編輯自己的譜面');
  editingExisting = true;
  uploadedPackageFile = null; packageCheck = null; coverFile = null; stripFile = null; ++scanRevision;
  window.clearImg();
  editingChartId = id;
  for (const [field,key] of [['songTitle','title'],['songComposer','composer'],['charterName','charter_name'],['songDesc','description'],['songBpm','bpm'],['musicCategory','music_category']]) setVal(field, chart[key] || '');
  setVal('ytUrl', chart.youtube_url || '');
  document.getElementById('coverEditInput').value = '';
  setVal('ratingInput', chart.rating ?? ''); window.updateRating(chart.rating ?? '');
  setVal('weStarLevel', chart.we_star_level ?? ''); setVal('weAttribute', chart.we_attribute ?? '');
  document.querySelectorAll('.diff-opt').forEach(el => el.classList.toggle('selected', el.textContent.trim().replace("WORLD'S END", 'WORLDS_END') === chart.difficulty));
  syncDifficultyFields();
  await loadTagOptions();
  tagEditor.set((chart.chart_tags || []).map(row => row.tags?.name).filter(Boolean));
  document.querySelector('[onclick="saveDraft()"]').textContent = '儲存變更';
  document.querySelector('[onclick="publishChart()"]').hidden = true;
  await window.goStep(2);
  switchPage('upload', null);
  } catch (e) { showToast(e.message, 'error'); }
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

window.addEventListener('accountNewSubmission', () => {
    editingExisting = false; editingChartId = null; uploadedPackageFile = null; packageCheck = null; coverFile = null; stripFile = null; ++scanRevision;
    document.querySelector('[onclick="saveDraft()"]').textContent = '草稿儲存';
    document.querySelector('[onclick="publishChart()"]').hidden = false;
    for (const field of ['songTitle', 'songComposer', 'songDesc', 'songBpm', 'ytUrl']) setVal(field, '');
    setVal('charterName', getUserDisplayData().name);
    setVal('musicCategory', 'Original');
    setVal('ratingInput', '15.0'); window.updateRating('15.0');
    setVal('weStarLevel', '1'); setVal('weAttribute', '');
    document.querySelectorAll('.diff-opt').forEach(el => el.classList.toggle('selected', el.textContent.trim() === 'MASTER'));
    syncDifficultyFields();
    document.getElementById('coverEditInput').value = '';
    tagEditor?.set([]);
    window.clearImg();
    window.goStep(1);
});
window.addEventListener('accountTabChanged', ({ detail: { id } }) => {
  if (id === 'manage') loadMyCharts();
  if (id === 'profile') fillProfileForm();
});

window.updateRating = function(v) {
  const el = document.getElementById('ratingDisplay');
  if(el) el.textContent = v === '' ? '' : Number(v).toFixed(1);
};

window.selectDiff = function(el) {
  document.querySelectorAll('.diff-opt').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  syncDifficultyFields();
};

window.toggleTagOpt = function(el) { el.classList.toggle('selected'); };
window.closeModal = function() { document.getElementById('successModal')?.classList.remove('open'); };

window.handleOverlayClick = e => { if (e.target.id === 'successModal') window.closeModal(); };
window.handleCoverChange = input => { coverFile = input.files[0] || null; };

function syncDifficultyFields() {
  const we = getSelectedDiff() === 'WORLDS_END';
  document.getElementById('normalMetadata').hidden = we;
  document.getElementById('weMetadata').hidden = !we;
  document.getElementById('ratingInput').disabled = we;
  document.getElementById('weStarLevel').disabled = !we;
  document.getElementById('weAttribute').disabled = !we;
}
function readDifficultyMetadata() {
  return difficultyMetadata(getSelectedDiff(), getVal('ratingInput'), getVal('weStarLevel'), getVal('weAttribute'));
}
