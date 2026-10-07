# 譜面詳情頁

沿用 `chart_detail.html?id=<charts.id>`。以下記錄最初的動態詳情頁改版。後續 Unique Account View 與讚／倒讚升級需要新的 migration，最新部署與驗證說明請見 `CHART_VIEWS_REACTIONS_NOTES.md`；初始化 SQL 未修改或重新執行。

## 資料來源

| 區域 | 真實資料 |
| --- | --- |
| 基本資料、描述、封面、展譜圖、影片、定數、統計與時間 | `charts` |
| 創作者與評論者名稱／頭像 | `profiles`，優先 `charter_name`，再 `username` |
| 收藏 | `favorites`，依目前使用者與譜面查詢／新增／刪除 |
| 社群體感難度 | `community_ratings`，範圍 1.0–16.0，每 user + chart 一筆 UPSERT |
| 五星評論 | `reviews`，範圍 1–5，每 user + chart 一筆 UPSERT |
| 讚／倒讚 | `review_helpful`，新 migration 加入 reaction；整頁批次讀取統計及自己的選取狀態 |
| 標籤與投票 | `chart_tags`、`tags`、`chart_tag_votes` |
| 下載 | 既有 `storage.js` 流程及 `downloads` |

社群體感難度與五星評論分開顯示。社群平均分頁讀取全部評分；五星分布使用精確 COUNT。評論列表每次載入 20 則，可載入更多。Helpful 不再嘗試使用不存在的 `supabase.sql`，也不修改其他人的評論來維護計數。

## 無對應資料的舊範例 UI

- 最初的 `review_helpful` 沒有倒讚欄位；後續新 migration 升級同一張表，詳見最新部署說明。
- `profiles` 沒有創作者譜面總數、總下載與平均評分欄位；移除原本寫死的創作者統計。本次沒有新增跨譜面統計功能。
- 沒有展譜圖／YouTube URL 時顯示未提供，不再生成假音符圖或播放範例影片。
- 無評論、評分、標籤或其他譜面時顯示空狀態；缺少封面／頭像時顯示中性圖示。

首頁輪播、搜尋列表、卡片上的展譜入口、管理頁的已發布查看入口與草稿／下架預覽入口，都使用 UUID 詳情頁。舊獨立模擬器已移除；卡片上的展譜入口使用譜面 UUID，指向詳情頁的真實展譜圖。

## 權限與下載

已對照專案初始化 SQL：`favorites_own`、`cr_own`、`reviews_insert_own`／`reviews_update_own`、`helpful_own` 皆依 `auth.uid()` 限制使用者自身資料；複合主鍵／唯一限制配合 UPSERT 防止重複評分與評論。前端傳遞目前登入的使用者 ID，不以 localStorage 保存收藏。

下載前仍重新查詢 `charts`，核對已發布狀態或擁有者權限、核對遊玩包路徑，再建立 60 秒 signed URL。`chart-packages` 維持 Private。下載開始後沿用 `downloads` 記錄，若統計寫入失敗會提示，不假稱記錄成功。

## 驗證範圍

- 以公開 anon 身分唯讀查詢線上 `charts`／`profiles`，確認實際欄位；其餘公開 tables 可讀取。
- 瀏覽器確認真實譜面與創作者資料、訪客收藏登入提示、首頁動態入口、搜尋空結果及錯誤 UUID。
- 本機測試涵蓋收藏持久查詢／切換、拒絕寫入錯誤、評分與評論唯一 UPSERT、helpful 切換、缺少／錯誤／找不到 UUID、私有下載與現有登入／投稿回歸。
- 線上 schema 管理端點拒絕 anon 存取；未取得線上 SQL 管理權限，因此 RLS policy 與唯一限制的定義以初始化 SQL 為依據，並未直接讀取線上系統目錄。
- 沒有用你的登入帳號新增測試收藏、評分、評論或投票。登入後的實際寫入／重新整理持久狀態及線上 authenticated RLS 尚需以實際登入帳號驗收。

登入後可依序測試收藏→重新整理→取消、體感難度第一次評分→修改→重新整理、評論新增→更新→重新整理、helpful 切換，以及已發布譜面的下載。其他使用者不能藉由公開列表讀取草稿，詳情頁同樣交由 charts RLS 控制。
