// ============================================================
// js/storage.js — Supabase Storage 檔案上傳 / 下載
// ============================================================
import { supabase, getStorageUrl } from './supabase.js';
import { currentUser } from './auth.js';

// ── 上傳進度回呼型別 ─────────────────────────────────────────
// onProgress(percent: 0~100)

/**
 * 上傳譜面遊玩包 (.zip / .rar)
 * 路徑格式：chart-packages/{userId}/{chartId}/package.zip
 */
export async function uploadChartPackage(chartId, file, onProgress) {
  const ext  = file.name.split('.').pop();
  const path = `${currentUser.id}/${chartId}/package.${ext}`;

  const { error } = await supabase.storage
    .from('chart-packages')
    .upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      onUploadProgress: e => onProgress && onProgress(Math.round((e.loaded / e.total) * 100)),
    });

  if (error) throw error;
  return path;
}

/**
 * 上傳曲繪封面圖
 * 路徑格式：cover-art/{userId}/{chartId}/cover.{ext}
 */
export async function uploadCoverArt(chartId, file, onProgress) {
  const ext  = file.name.split('.').pop().toLowerCase();
  if (!['jpg','jpeg','png','webp'].includes(ext)) throw new Error('封面圖請使用 JPG / PNG / WebP');
  const path = `${currentUser.id}/${chartId}/cover.${ext}`;

  const { error } = await supabase.storage
    .from('cover-art')
    .upload(path, file, {
      cacheControl: '86400',
      upsert: true,
      onUploadProgress: e => onProgress && onProgress(Math.round((e.loaded / e.total) * 100)),
    });

  if (error) throw error;
  return path;
}

/**
 * 上傳展譜圖（sdvx.in 風格縱向圖）
 * 路徑格式：chart-strips/{userId}/{chartId}/strip.{ext}
 */
export async function uploadChartStrip(chartId, file, onProgress) {
  const ext  = file.name.split('.').pop().toLowerCase();
  if (!['jpg','jpeg','png','webp'].includes(ext)) throw new Error('展譜圖請使用 JPG / PNG / WebP');
  const path = `${currentUser.id}/${chartId}/strip.${ext}`;

  const { error } = await supabase.storage
    .from('chart-strips')
    .upload(path, file, {
      cacheControl: '86400',
      upsert: true,
      onUploadProgress: e => onProgress && onProgress(Math.round((e.loaded / e.total) * 100)),
    });

  if (error) throw error;
  return path;
}

/**
 * 上傳創作者頭像
 */
export async function uploadAvatar(file, onProgress) {
  const ext  = file.name.split('.').pop().toLowerCase();
  const path = `${currentUser.id}/avatar.${ext}`;

  const { error } = await supabase.storage
    .from('avatars')
    .upload(path, file, {
      cacheControl: '86400',
      upsert: true,
      onUploadProgress: e => onProgress && onProgress(Math.round((e.loaded / e.total) * 100)),
    });

  if (error) throw error;
  return getStorageUrl('avatars', path);
}

/**
 * 刪除整個譜面的所有檔案
 */
export async function deleteChartFiles(chartId) {
  const prefix = `${currentUser.id}/${chartId}/`;

  await Promise.all([
    supabase.storage.from('chart-packages').remove([prefix + 'package.zip', prefix + 'package.rar']),
    supabase.storage.from('cover-art').remove([prefix + 'cover.jpg', prefix + 'cover.png', prefix + 'cover.webp']),
    supabase.storage.from('chart-strips').remove([prefix + 'strip.jpg', prefix + 'strip.png', prefix + 'strip.webp']),
  ]);
}

/**
 * 取得有時效性的私有下載 URL（可用於需要登入才能下載的場景）
 * expires: 秒數（預設 60 秒，夠使用者點擊觸發下載）
 */
export async function getSignedDownloadUrl(bucket, path, expires = 60) {
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, expires);
  if (error) throw error;
  return data.signedUrl;
}

/**
 * 觸發瀏覽器下載
 * @param {string} url    - 公開或 signed URL
 * @param {string} filename
 */
export function triggerDownload(url, filename) {
  const a = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.target   = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/**
 * 完整下載流程：記錄 + 觸發下載
 */
export async function downloadChart(chart) {
  const { recordDownload } = await import('./api.js');
  await recordDownload(chart.id);
  triggerDownload(chart.package_url, `${chart.title} [${chart.difficulty} ${chart.rating}].zip`);
}
