// ============================================================
// js/supabase.js — Supabase 客戶端初始化
// ============================================================
// 使用方式：在所有頁面的 <head> 最先引入此檔案
//   <script type="module" src="js/supabase.js"></script>
//
// 填入你的 Supabase 專案資訊：
//   Supabase Dashboard → Project Settings → API
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ★ 填入你的 Supabase 專案 URL 和 anon key
const SUPABASE_URL  = 'https://wnjmtgefhgoshgmxmxbd.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Induam10Z2VmaGdvc2hnbXhteGJkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTExOTMzNzQsImV4cCI6MjEwNjc2OTM3NH0.Cbp3c21hSFn5W7LlXk7GobXraUepzB9m3Lfc_yNX6zg';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession:    true,        // 自動儲存 session 到 localStorage
    autoRefreshToken:  true,        // 自動刷新 JWT
    detectSessionInUrl: true,       // OAuth redirect 後自動偵測
  },
});

// Storage URL 快速生成器
export function getStorageUrl(bucket, path) {
  if (!path || bucket === 'chart-packages') return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// 全域掛載（方便非 module script 也能讀取）
window.__supabase = supabase;
window.__getStorageUrl = getStorageUrl;

