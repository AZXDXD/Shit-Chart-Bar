# Header / Menu / Difficulty 整理

## 修改檔案

- index.html、chart_detail.html、charter_studio.html：共用 Header 入口、純顯示帳號、資源連結與難度。
- js/site-header.js、css/site-header.css：新增全站共用右上選單，取代舊 Navbar、手機 drawer 與帳號 dropdown。
- js/auth.js：移除舊 dropdown 清理；沿用同一個 initAuth / onAuthStateChange / updateAllAuthUI。
- js/account-navigation.js：移除右上 data-account-link 路徑重寫；帳號 tab/hash 預設 profile 不變。
- js/pages/index.js：首頁既有卡片整合收藏列表、帳號/路由切換時丟棄過期回應、六種難度 badge。
- js/api.js：沿用 favorites 查詢，以 user_id 過濾並排除不可見 charts；難度傳入既有 search_charts 的 diff。
- js/pages/charter_studio.js：投稿/編輯完整六難度選取與儲存值、管理列表 badge、移除舊 dropdown trigger。
- js/pages/chart-detail.js、css/difficulty.css：單一難度 badge，BASIC 綠、ADVANCED 橘、WORLD'S END 靜態彩虹。
- tests/account-edit.test.mjs、tests/account-navigation.test.mjs、tests/auth.test.mjs、tests/featured-chart.test.mjs：更新舊 Header 預期和 DOM mocks。
- tests/header-difficulty.test.mjs、tests/favorites-home.test.mjs：新增選單 auth 可見性/操作、純顯示帳號、六難度 selector/RPC/儲存值、收藏帳號隔離與 stale response 測試。
- supabase/migrations/20261007_add_basic_advanced_difficulties.sql：只補缺少 enum 值。
- 本文件。

## 導航與 Auth

未登入選單：探索譜面、登入帳號。
已登入選單：探索譜面、已收藏譜面、我的譜面、帳號資料、登出。
可見性由 auth.js 的 updateAllAuthUI 和既有 data-auth 更新，不建立另一套登入狀態或 auth listener。
收藏 → index.html#favorites；我的譜面 → charter_studio.html#manage；帳號資料 → charter_studio.html#profile。
收藏沿用 getMyFavorites / favorites 資料表、首頁 renderCard、load-more，不新增表或重複卡片系統。
沒有/無效帳號 tab 預設 profile。上傳仍由帳號頁投稿 tab 或管理頁 + 投稿新譜面操作。
右上 account 為 span，沒有 anchor、click handler、dropdown、pointer/hover 效果；名稱/頭像沿用 profiles.charter_name / username / avatar_url 與既有 OAuth 預設身份 fallback。
Google/Discord OAuth、signOut、getSession 及 auth listener 保留。

## 首頁資源

移除工具與教學、舊 drawer / dropdown 專屬 HTML/CSS/JS、首頁官方 Discord 社群；詳情頁同樣刪掉假的 Discord 社群入口。
Discord OAuth 不受影響。
原本 UMIGURI 與 Margrete 連結都是 href="#"。
使用者指定 https://umgr.inonote.jp/en/，官網頁面列有 UMIGURI 與 Margrete 編輯器。
首頁與詳情頁只有單一 UMIGURI/Margrete官網入口，target="_blank" rel="noopener noreferrer"。

## Difficulty / SQL 待審閱

既有 schema/initialize SQL enum：EXPERT、MASTER、ULTIMA、WORLDS_END。
2026-10-07 以本機首頁對實際 search_charts 篩選 BASIC 與 ADVANCED，線上均回覆 invalid input value for enum difficulty_type，確認當時尚未支援兩值。
UI 統一 BASIC → ADVANCED → EXPERT → MASTER → ULTIMA → WORLD'S END。
資料值仍為 WORLDS_END。WORLD'S END 使用低飽和靜態彩虹背景、白字與邊框；active/selected 提亮並強化外框，無動畫。
初次 UI 整理時此 migration 尚未部署。其後使用者已確認執行成功；regression 追查中也以公開 anon 查詢驗證六種難度 RPC 都回傳 HTTP 200。以下保留 SQL 供參考，**不要再次執行**：

```sql
ALTER TYPE public.difficulty_type ADD VALUE IF NOT EXISTS 'BASIC' BEFORE 'EXPERT';
ALTER TYPE public.difficulty_type ADD VALUE IF NOT EXISTS 'ADVANCED' BEFORE 'EXPERT';
```

不重建 charts，不修改既有資料或舊 migration。search_charts 原本以 enum diff 和 c.difficulty=diff 篩選，不需重建 RPC。
新難度若在其他未部署環境搜尋，顯示「此難度尚未啟用，請稍後再試」。目前專案線上 enum 已支援 BASIC/ADVANCED。

## 驗證與限制

自動測試為 DOM/Supabase mocks，SQL 是結構檢查，不代表 PostgreSQL migration 已執行。
實際瀏覽器已檢查登入選單順序、收藏空狀態、我的譜面 #manage、帳號資料 #profile、右上帳號點擊不導航、1280px/390px 首頁無水平 overflow。
現有長條展譜 Viewer、OAuth、帳號編輯、tags/autocomplete、views/downloads/reviews/reactions、private signed download 回歸測試保留。
仍需手動：Google/Discord 實際登入/登出/F5；有收藏帳號列表及取消收藏後刷新；手機各頁；SQL 部署後六難度搜尋加關鍵字/定數/tag/排序，BASIC/ADVANCED 投稿與編輯；詳情 Viewer 控制和下載。
enum SQL 已由使用者自行部署，詳見下方追查結果。

## 詳情載入 regression 修復

上次 Header 整理刪掉 breadcrumb HTML，js/pages/chart-detail.js 的 renderChart 仍以 document.querySelector('.breadcrumb span:last-child').textContent 寫入曲名。查詢已成功，但元素為 null，因而觸發 TypeError: Cannot set properties of null (setting 'textContent')；一般 catch 將它轉成「譜面載入失敗」。
卡片 URL UUID 正確，並非 navigation、enum、profiles join 或 RLS 錯誤。
修復只移除過時 breadcrumb DOM 操作；新增 localhost development diagnostics，記錄 stage、name、message、code、details、hint、stack，不記錄 session/headers/signed URLs。
新增 tests/detail-render.test.mjs 執行實際頁面程式，用目前 HTML 的 ID 集合驗證六種難度、guest published、owner draft/unpublished 與錯誤診斷。
實際瀏覽器確認首頁及管理頁 published 入口恢復、owner 可讀 existing unpublished MASTER chart，Tags、rating、reviews、favorite、統計與長條 Viewer 顯示正常。
公開 anon REST 詳情查詢（與 getChart 相同 profiles/chart_tags/tags select）HTTP 200、1 列，profiles join 成功；六難度 search_charts RPC 均 HTTP 200，當時只有 ULTIMA 有公開譜面，因此其他難度完整渲染由自動測試覆蓋，未建立假資料。
沒有新 migration、沒有改 query/navigation、沒有改 chart 資料/RLS/buckets，也沒有重跑已部署 SQL。

## Menu 位置更新

共用 site-header.js 以 header.append 將 Menu 排在純顯示帳號資訊之後。Logo 靠左，Menu 最右側。共用 CSS 的 panel 改為 right:0 向下展開；桌面與手機均使用相同 dropdown，最大高度依可用視窗限制並可捲動。按鈕 44×44px、Header 高度維持原設定、名稱沿用 ellipsis。未更動 auth/navigation/Supabase。
