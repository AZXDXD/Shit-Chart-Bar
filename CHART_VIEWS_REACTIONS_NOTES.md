# Unique Account View 與玩家評論交付記錄

前端及 migration 已完成。**migration 尚未在線上執行**，請自行於 Supabase SQL Editor 執行 `supabase/migrations/20261006_chart_views_review_reactions.sql` 的完整內容。不要重跑任何初始化 SQL。

## 20 項回報

1. 前端修改：`chart_detail.html`、`js/api.js`、`js/pages/chart-detail.js`。另新增／更新本機測試與本文件，以及既有 `CHART_DETAIL_NOTES.md` 的版本說明。本次未改展譜 Viewer、首頁、OAuth、Storage 或下載流程。
2. 原機制：`increment_view(uuid)` 每次呼叫對 Published 譜面加一，允許 anon 與 authenticated；前端 RPC 成功後直接把畫面數字加一。沒有帳號唯一紀錄。
3. 新機制：登入者載入 Published 譜面時呼叫 `record_chart_view(uuid)`。伺服器取得 `auth.uid()`，鎖定可查看的 chart，INSERT unique ledger；只有成功新增一筆才加一，整個交易回傳資料庫最新 view_count。重刷／再訪／同帳號跨瀏覽器皆不再加一。登入事件也會記錄從訪客轉登入的第一次瀏覽。
4. 新增 `chart_views`，UUID 外鍵指向 charts.id 與 auth.users.id，created_at 記錄首次計數時間。沒有重複的評論／評分／反應表。
5. `PRIMARY KEY(chart_id,user_id)` 等價於 UNIQUE；搭配 `ON CONFLICT DO NOTHING`、ROW_COUNT 判斷及 chart row lock 避免競態。帳號刪除後紀錄會 cascade 刪除，但歷史總數不減少。
6. `increment_view(uuid)` 保留原本 RETURNS void 簽名，改為呼叫同一個 unique RPC，撤銷 anon/PUBLIC EXECUTE，避免舊客戶端繼續無限制加一。新前端不呼叫舊 RPC，即使 migration 尚未上線也不退回舊計數方式。
7. 訪客前端不呼叫瀏覽 RPC；後端拒絕 NULL auth.uid，且僅授權 authenticated。作者預覽 draft/unpublished 亦不計數，沿用原本 Published-only 規則。
8. migration 不覆寫、不清零 view_count；例如 125 在新系統首次記錄帳號後變 126。之前看過但尚未被新 ledger 記錄的帳號，migration 後第一次仍會加一。
9. 小節從 HTML input/label、compose/measure CSS、個人評論讀取、表單 validation、UPSERT payload、評論卡片 render 移除。搜尋確認沒有其他功能直接使用 measure_number。資料庫 measure_number 保留，修改評論也不覆寫舊值，避免丟失歷史資料。
10. 原 `review_helpful` 只有 review_id、user_id，兩者 UUID NOT NULL，分別指向 reviews.id、profiles.id；既有 composite PRIMARY KEY(review_id,user_id)。原 RLS 公開讀取、auth.uid 自己的列可寫入／更新／刪除。
11. 沿用同一張表，加 `reaction text NOT NULL DEFAULT 'like'`，CHECK 僅允許 like/dislike。user_id default auth.uid。前端反應寫入 RPC 不接受 user_id。
12. ALTER 加入 default 使所有既有 helpful 列成為 like；不刪除、重建或清空票數。reviews.helpful_count 舊欄位保留，新的顯示以實際 reaction 聚合為準。
13. 既有 `review_helpful_pkey(review_id,user_id)` 完整保留，同一帳號每評論最多一筆。
14. `toggle_review_reaction(review_uuid,requested_reaction)` 鎖定 review row；相同反應 DELETE 取消，不同反應 UPSERT 更新原列。回傳讚／倒讚及自己的反應，前端同時更新兩個按鈕，請求期間停用兩者避免重複操作。
15. RLS 保持啟用。INSERT/UPDATE WITH CHECK auth.uid 自己的列且 chart 可見，UPDATE/DELETE USING auth.uid 自己的列；公開 SELECT 只讀可查看譜面的反應。column grants 禁止直接 INSERT user_id 或 UPDATE user_id/review_id；RPC 則由 auth.uid 決定帳號。chart_views 不授予瀏覽器直接 DML/SELECT。SECURITY DEFINER 使用空 search_path、完整限定名稱、登入與 chart 可見性檢查及明確 EXECUTE grants。沒有授予 charts.view_count UPDATE。
16. 評論每頁 20 筆：一次 reviews/profiles relation query + 一次 `get_review_reactions(uuid[])` 聚合票數／個人選取狀態，避免每評論查 profile/讚/倒讚/自己反應。全站五星分布仍沿用固定五個 COUNT 查詢，並非隨評論數增加的 N+1。批次 RPC 支援最多 100 則。
17. 新增 migration：`supabase/migrations/20261006_chart_views_review_reactions.sql`。BEGIN/COMMIT 包覆全部變更，最後通知 PostgREST reload schema。
18. SQL Editor 僅需執行上述新檔完整內容。這份 SQL 以已完成的 initialize-backend.sql schema 為前提；如果線上另有手動變更，應先對照再執行。
19. 本機測試結果見下方。沒有聲稱線上 A/B/C 帳號、PostgreSQL 鎖或 RLS 實測通過。
20. 手動步驟：執行 migration、重新整理詳情頁，再用真實多帳號完成下方線上驗收。沒有額外 Auth/OAuth/Storage 操作。

## 本機驗證

- `tests/detail-data.test.mjs`：評論新增／修改仍每 user/chart 一筆、不含 measure_number；Like/Dislike 各自取消、雙向切換，三帳號得到 2 likes/1 dislike；未登入寫入攔截、收藏／評分／無效 URL 回歸。Supabase mock。
- `tests/unique-views-reactions.test.mjs`：執行實際 API 程式，模擬歷史 125、A 首次/重刷/再訪/第二張、B 首次/再訪、guest、同帳號並行兩請求；回傳最新總數、不呼叫舊 RPC；未部署 migration 時不假增數字。SQL 結構檢查 unique、ROW_COUNT、search_path、uid、grants、保留歷史。**模擬序列化 RPC，不是 PostgreSQL race condition 實測。**
- `tests/review-reaction-ui.test.mjs`：執行實際 renderer，20 評論共兩次批次讀取；按鈕 active、重新讀取持久反應、互換兩個數字、guest 登入提示/零寫入、migration 未部署時評論仍可讀且票數顯示「—」並停用。DOM/Supabase mock。
- 其餘 auth、login-controls、creator-studio、initial-schema、private-download、pre-deploy、chart-strip-viewer 回歸測試通過；語法及 diff whitespace 檢查通過。
- 實際瀏覽器使用唯讀資料確認 profiles 評論者、已存在評論／個人編輯內容、無小節欄位、展譜 Viewer 未受影響、尚未部署時顯示提示與 disabled reaction。未投稿測試評論／投票或執行 migration。
- 本機沒有 PostgreSQL 執行環境；不能據此宣稱 migration 語法、RLS/grants、跨分頁交易鎖在真實 DB 完成動態驗證。線上 catalog 不開放 anon，policy/grants 定義對照初始化檔與新 migration。

## 部署後線上驗收

使用至少三個測試帳號及三張 Published chart，先記下既有 view_count：A 首次 Chart1 +1、refresh/再訪 +0、Chart2 +1；B 首次 Chart1 +1/再訪 +0；guest +0；A 同時兩分頁首次 Chart3 最終只 +1。換同帳號另一瀏覽器仍 +0。SQL Editor 可確認 chart_views 只有每組帳號/chart 一列。

評論新增／修改／刷新確認 reviews 寫入持久且沒有小節。A like → 再 like 取消、dislike → 再 dislike 取消、雙向切換；A/B like + C dislike 得到 2/1；A 刷新保持 active。guest 可見票數，點擊顯示登入，無写入。

以兩個已登入帳號測試 own RLS，B 不得更改或刪除 A 的 reaction；直接插入其他 user_id、更新 user_id/review_id、直接 UPDATE charts.view_count 必須被拒絕。訪客不得呼叫任何寫入 RPC。既有評論修改／刪除 API 和 profiles 資料來源保留。
