# 自訂譜面標籤完成報告

## 暫存表錯誤修正版

已直接修改原檔 `supabase/migrations/20261006_custom_chart_tags.sql`，不新增另一份 migration。以 5 個各自完整定義的 statement-local CTE 取代 CREATE TEMP TABLE。所有映射皆在 tags 被修改前計算，因此 canonical ID 一致；先複製 chart_tags／chart_tag_votes、再清理重複關聯、最後移除重複 tags 並正規化。保留整份 BEGIN／COMMIT、8 參數 RPC 與最後 schema cache 通知。

42P01 證明暫存表在引用當下不可見，不能僅憑此錯誤判定 Supabase SQL Editor 必定分段或換 session。本機 PostgreSQL 驗證：同一顯式交易中的 ON COMMIT DROP 暫存表可正常引用；在 autocommit 建立後再引用則重現 42P01。線上 session／執行日誌不可見，所以具體執行環境原因仍未確認。修正取消跨語句暫存 relation 依賴。

若原檔全部在同一交易執行，錯誤會使交易失敗，不會部分提交；連線结束或 ROLLBACK／失敗交易 COMMIT 會回滾。若實際分段執行，之前已提交的語句不會自动回滾。請先重新執行 inspection 查詢確認資料／RPC 狀態，不繼續失敗檔案後半段。如果 SQL Editor 提示 current transaction is aborted，先單獨執行 ROLLBACK，再 inspection。若 inspection 已有新約束／8 參數 RPC，先確認部分提交情況，不盲目重跑。

本次額外使用 PGlite PostgreSQL WASM 引擎（隔離的本機測試資料庫）執行整份修正版，實際驗證 canonicalization、既有關聯／不同使用者投票保留、沒有永久 map 表、7→8 參數替換、anon/authenticated 搜尋、Tag/query/難度/定數/分頁、RPC ownership 與 published 狀態。刻意在最後加入錯誤，確認整份資料與舊 RPC 回滾。Supabase API cache 通知僅驗證 SQL 可執行，本機沒有 PostgREST listener；線上部署未執行。

## 2026-10-06 RPC Debug 補充

唯讀線上匿名 RPC 檢查：7 參數 search_charts 回應 HTTP 200（1 筆），8 參數版本回應 HTTP 404 / PGRST202，popular_chart_tags 也回應 PGRST202。已證實線上 API cache 尚未提供新版，不是前端參數拼字／順序錯誤。最可能是此本機 migration 尚未成功執行；只有管理端 pg_proc 查詢才能區分未部署、執行回滾及 schema cache 未更新，檢查 SQL 已加入函式簽章、overload 和 anon/authenticated execute 權限。

本次没有執行資料庫修改或移除前端 tag_filter，也没有新增另一份 migration。現有 20261006_custom_chart_tags.sql 已定義正確 8 參數版本，授權 anon/authenticated，SECURITY INVOKER 保留 charts RLS；7 參數 DROP 和新版 CREATE 在同一交易內，若任何一步失敗會回滾，不會單獨留下已刪除的舊函式。此 migration 並非用 CREATE OR REPLACE 新增不同參數 overload。

本次在待部署 migration 的 COMMIT 前加入 NOTIFY pgrst, 'reload schema'，成功提交後才通知 API 更新 cache。成功後重新整理網站，再執行唯讀檢查確認只有預期的新版簽章。若函式已存在但 API 仍 PGRST202，可單獨通知 reload，不重跑整份 migration。

參數契約與 SQL 結構測試通過，全部 13 組本機測試通過。新版首頁／搜尋／Tag filter 的實際線上驗收仍被未同步 RPC 阻擋；未驗證 authenticated 真實登入權限。

## 執行順序

1. 在 Supabase SQL Editor 執行 `supabase/inspect-custom-chart-tags.sql`（唯讀），確認舊標籤、关联譜面、投票及不符合新限制的資料。
2. 執行 `supabase/migrations/20261006_custom_chart_tags.sql`。
3. 部署前端並用兩個帳號完成下方線上驗收。

沒有執行線上 SQL，沒有重跑或修改初始化 SQL。新版前端依賴新版 RPC，請先執行 migration 再部署。

## 需求對照（23 項）

1. 舊系統：投稿及編輯載入全站 tags，從固定按鈕選 tag_id；API 分兩次請求刪除再新增 chart_tags，存在更新失敗後舊關聯已消失的風險。詳情頁可對已關聯標籤投票。首頁固定按鈕僅切換 active 外觀，未真正篩選。
2. 舊預設：地力譜、手速考驗、配置譜、演出譜、創意極佳、認識考驗、初心者友善、爆手風險、VOCALOID、東方系列。
3. tags：id SERIAL PRIMARY KEY；name TEXT NOT NULL UNIQUE；color TEXT DEFAULT '#ff6f00'。新 migration 保留欄位，增加正規化唯一索引及名稱檢查限制。
4. chart_tags：chart_id UUID 外鍵至 charts、tag_id INTEGER 外鍵至 tags，複合主鍵 (chart_id, tag_id)，外鍵刪除採 CASCADE；沿用原表。
5. chart_tag_votes：chart_id、tag_id、user_id 複合主鍵及對應外鍵；原用途為玩家對既有標籤 +1 / 取消，並非建立新標籤。
6. 移除投稿／編輯載入全站字典的固定 selector，首頁硬編碼預設按鈕及詳情投票 UI。
7. 新 UI：輸入文字，Enter 或「新增」建立 chip；點 chip 的 × 移除。使用 textContent 顯示文字。輸入法組字中的 Enter 不觸發新增。
8. 每張譜最多 10 個不同標籤；UI、API、RPC 均檢查。RPC 鎖定譜面後原子更新，前端無直接 chart_tags 寫入權限，無法繞過限制。
9. 每個標籤最多 20 個 Unicode 字元，前後空白移除、空字串拒絕。表情符號按字元計算。
10. 同一譜面標籤以正規化名稱去重；保留 tags.name UNIQUE 與 chart_tags 複合主鍵，並新增正規化 unique index。
11. ASCII 英文字母 A–Z 轉小寫；Tech / tech / TECH 共用 tech。非英文字母保持原字元，不進行 Unicode 相容字形或重音折疊。
12. 投稿透過 set_chart_tags RPC 以 INSERT ON CONFLICT DO NOTHING 取得／建立共用字典，再關聯 chart_tags。多使用者共用同一 tags 紀錄；標籤排序後写入降低並行鎖互等風險。
13. 編輯載入 chart_tags.tags.name；儲存一次 RPC 全量更新，空陣列代表清空。RPC 失敗時整次交易回滾，舊關聯不會因半套儲存消失。一般譜面 metadata 儲存仍為獨立請求，與標籤不屬同一交易。
14. Published 編輯只更新 metadata 和 tags，沒有寫入 status；維持 published。
15. 詳情直接讀取 chart_tags → tags，顯示 #名稱，無標籤顯示「尚未設定標籤」。
16. 原首頁卡片並未顯示 Tag，因此保留卡片佈局。首頁 Tag 篩選改為 popular_chart_tags RPC，最多顯示 20 個有公開譜面使用的標籤，按使用數排序，沒有官方清單或未使用字典項目。
17. 舊 search_charts RPC 沒有搜尋 tags；這次新增 Tag 名稱 ILIKE 搜尋及 tag_filter 精確篩選，維持難度、定數、排序與分頁條件。新 RPC 多一個預設為 NULL 的參數，舊的 7 參數函式在交易中替換。
18. 前端完全停止讀寫 chart_tag_votes，刪除舊投票 API，資料表和歷史投票保留。migration 撤銷瀏覽器角色寫入投票表權限。確認其他外部客戶端也不需要後，可另行決定 cleanup migration。
19. 舊預設只有在無 chart_tags 且無 chart_tag_votes 時刪除。有關聯的保留，仍顯示既有關聯，讓創作者自行編輯；不擅自判斷是否官方或創作者選擇。唯讀檢查第二個結果列出受影響譜面。本機沒有線上資料，無法提供實際受影響名單。正規化合併既有大小寫／空白重複項目時，將關聯及投票移轉至最小 ID，重複同一玩家投票保留一筆；不刪譜面。若既有名称無效或譜面超过 10 個正規化標籤，migration 中止並完整回滾，需先人工確認處理。
20. 已產生新的 migration SQL，含 BEGIN / COMMIT；没有 DROP TABLE。
21. 正式變更只需執行 `supabase/migrations/20261006_custom_chart_tags.sql`，不是 schema.sql、creator-studio.sql 或 initialize-backend.sql。
22. 保持 RLS 開啟；chart_tags SELECT 遵守 charts 可見性。瀏覽器角色撤銷 tags、chart_tags 的直接新增／修改／刪除權限；安全 SECURITY DEFINER RPC 用 auth.uid() 驗證擁有者，鎖譜面後才操作，不接受 user_id。未登入和其他擁有者拒絕。字典沒有前端任意修改功能，不使用 service_role 前端。
23. 本機 13 組測試通過，包括標籤去重、大小寫、空白、字元限制、第 11 個阻擋、Enter／新增／移除、空清單、API 驗證和 RPC 參數、published／draft 編輯保存狀態，以及其他既有回歸測試。DOM 和 Supabase 呼叫使用 mocks，SQL 僅做結構檢查；未在 PostgreSQL／線上 Supabase 執行，因此不宣稱線上 RLS、並行共用紀錄或真實瀏覽器操作已驗證。

## 線上驗收

- 帳號 A 投稿「高難度、多押、技術譜」，重複高難度只有一筆；第 11 個、空白及超長標籤被拒絕。
- 帳號 B 使用高難度，SQL 查詢確認只有一個 tags.id、兩張譜面共用。
- 編輯 published 譜面移除多押、新增耐力，重新載入確認 status 和最新標籤。
- 詳情頁無投票／demo 標籤；沒有標籤時正常顯示。
- 首頁搜尋高難度找到關聯公開譜面；點熱門標籤篩選正確，取消後復原。
- 用帳號 A 呼叫 set_chart_tags 指向 B 的譜面，應收到 ownership error；直接對 chart_tags 寫入應被權限拒絕。
- 以 RPC 繞過 UI 送入 11 個不同名稱／21 字元名稱，應拒絕且保留舊標籤。

本次沒有加入 autocomplete；獨立的標籤 editor 與名稱 API 可在日後加入建議來源，不限制使用者創建新標籤。
