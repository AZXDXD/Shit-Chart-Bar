# Unique Download

這次前端修改 `js/api.js`、`js/storage.js`；沿用詳情頁原本 `chartDownloaded` 後重新查詢 charts（countView:false）的刷新流程，不假加一。新增測試 `tests/unique-downloads.test.mjs`。

## 原本結構與變更

初始化的 downloads 是 `id BIGSERIAL PRIMARY KEY`、`chart_id UUID NOT NULL REFERENCES charts`、`user_id UUID REFERENCES profiles ON DELETE SET NULL`、`ip_hash TEXT`、`downloaded_at TIMESTAMPTZ`。沒有帳號／譜面唯一限制；公開與登入者可以 INSERT，INSERT trigger 每次加一。未發現現有下載記錄 RPC。

新 migration 沿用 downloads，不新增重複表。保留每組 user_id/chart_id 最小 id 的歷史紀錄，刪除同組其餘重複 log；匿名歷史列保留。**不重算、不重設任何 charts.download_count**。既有帳號紀錄能辨識曾下載者，因此 migration 後不再次計數；歷史沒有紀錄的帳號第一次新下載才加一。刪除重複 log 是執行前應審閱的資料整理步驟，可先備份 downloads。

新增唯一索引 `downloads_user_chart_unique(user_id,chart_id)`。NULL user_id 歷史列不受唯一索引限制，但新 RPC 不插入匿名列。ip_hash 保留歷史用途，新前端/RPC 不讀寫 IP。

`record_chart_download(target_chart uuid)` 使用 auth.uid()，不接受 user_id。SECURITY DEFINER 固定空 search_path、完整限定資料表名稱，驗證譜面可下載及 package 路徑，鎖定 chart row，INSERT ON CONFLICT DO NOTHING，以 ROW_COUNT 判斷首次成功才增加 download_count，回傳真實總數。移除原 downloads_count_trigger，避免雙重加一。

撤銷 downloads／sequence 的直接写入權限，保留 authenticated 的 own-row SELECT；RLS 持續啟用，移除舊 insert policy，寫入僅由 RPC 完成。RPC 明確授權 anon/authenticated；匿名只可查看 Published 且有有效 package_path 的譜面總數，不建立紀錄、不加一。作者仍可下載自己的 draft/unpublished，預覽不計公開下載數，與 Unique View 的 Published-only 規則一致。其他帳號無法替別人寫入，或計數不可見譜面。

## Signed URL

不更改 bucket 或 Storage policies。保持下載前重新讀 charts → 核對狀態與 package_path → 產生 60 秒 signed URL → 觸發下載 → 呼叫唯一記錄 RPC → 詳情頁重新讀真實統計。再下載始終重新簽署 URL，不因已計數而被阻止。簽署失敗不記錄；統計失敗（含 migration 尚未部署）不阻止已開始的下載，保留既有失敗提示。計數代表取得連結並啟動下載的帳號；瀏覽器無法證明檔案完整儲存完成，RPC 也不能驗證 Storage 下載完成。

## 執行

請審閱並自行在 Supabase SQL Editor 執行：

`supabase/migrations/20261007_unique_chart_downloads.sql`

**尚未部署或在線上執行。** SQL 使用 transaction 及 downloads ACCESS EXCLUSIVE 鎖，避免整理歷史紀錄時舊 INSERT 併入。此檔以初始化 schema 為前提。不需執行或修改任何既有初始化、Tags、Autocomplete、Unique View migration。Unique View、評論、反應、收藏、搜尋、profiles、Auth/OAuth、Storage policies 皆未修改。

## 驗證

本機實際 API/storage 程式配合模擬 Supabase：A 首次/再次/重新載入/重新登入、Chart Y、B 首次/再次、guest 正常下載不計數、同帳號兩請求、歷史有紀錄不重算、重下載再簽 URL、簽署失敗不計數、未部署仍可下載及統計刷新均通過。SQL 結構檢查鎖、唯一索引、ROW_COUNT、uid、search_path、grants、無歷史歸零。其餘回歸包含 Unique View 與私有下載測試。

**上述資料庫並行案例是 mock，不是 PostgreSQL 交易/RLS 實測。** migration 未執行，本機沒有 PostgreSQL 環境；線上管理端 schema/policies/grants 以專案 SQL 定義核對，未宣稱已取得管理權限。部署後仍需以實際 A/B/guest、兩分頁驗收，核對下載數差值與 downloads 唯一列，確認一般使用者直接 INSERT 被拒絕、不可直接更新 chart 計數。歷史 log 整理與 unique index 建立也應在 DB 驗收。
