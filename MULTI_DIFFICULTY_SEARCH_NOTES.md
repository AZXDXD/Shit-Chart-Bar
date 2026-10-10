# 多選難度搜尋

## 部署順序

先人工審閱並部署新的 `supabase/migrations/20261008_multi_difficulty_search.sql`，再部署前端。此輪未執行正式 SQL，也未重新執行任何舊 migration。

前置條件是現有十參數 `public.search_charts` 已存在（包括 Custom Tags 與 WORLD'S END metadata）。新 migration 從資料庫讀取其實際函式定義，逐段比對後複製為 `search_charts_multi`；若不符合預期，整筆 transaction 中止，不更動原 RPC。不要為了通過檢查重新執行舊 migration，應先檢查實際函式定義。

舊 RPC 的名稱、十參數、回傳與權限保持不變。新 RPC 使用 `diffs difficulty_type[]`，回傳 JSONB `{ charts: [...], total_count: N }`。複製原 owner、有效 EXECUTE ACL、SECURITY INVOKER 與 search_path，仍受原資料表 RLS 約束。不修改 chart 資料、schema 欄位或政策。

## 行為

- 首頁 `searchCharts({difficulties: [...]})` 使用新 RPC；Featured 與詳情頁相關譜面的呼叫未帶 difficulties，仍使用原 RPC。收藏與我的譜面查詢不變。
- `NULL`／空陣列代表全部；其他以 `c.difficulty = ANY(diffs)` 作 OR 篩選，先過濾再排序與分頁。
- 定數只作用於一般難度；WE 星數／Attribute 只作用於 WORLD'S END。沒有選取難度時兩組條件皆可用；只選 WE 時隱藏定數；選普通難度而不含 WE 時隱藏 WE 條件。隱藏時保留輸入值，重新選取時恢復。
- 關鍵字／標籤／排序保留原函式邏輯。新增 `c.id` 排序作同分 tie-breaker，避免固定資料集分頁重複／遺漏。
- 符合結果以 `matched AS MATERIALIZED` 保存一次，分頁與 `count(*)` 使用同一份結果。總筆數獨立於頁面列數：真正零筆回傳 `{charts:[],total_count:0}`，超出範圍仍回傳 `{charts:[],total_count:N}`。
- RPC 保留原排序並加 UUID tie-breaker，透過 `row_number()` 排頁、依序 JSON 聚合；內部排序欄位不回傳給前端。原 return-table 欄名直接取自 `pg_proc`，保持 `p.id` 對應 `user_id`。
- API 維持 chart array 介面，額外提供 `totalCount` metadata；首頁顯示實際符合筆數，據此控制載入更多。結果縮減導致當前分頁越界時保留篩選並載入第一頁，真正零筆清除原結果並顯示 0 筆。
- 每次切換難度重設第一頁，保留其他條件；請求中切换篩選會丟棄舊回應。
- migration 未部署時顯示明確提示，不會退回只篩當前分頁的錯誤做法。

## 驗證

前端自動測試涵蓋舊 RPC 相容、單選／多選／全不選／六種全選的 payload、WE 混合選擇、其他條件參數、實際首頁 toggle／aria-pressed／stale response／分頁重設／23 筆結果分兩頁、空頁 metadata、越界恢復與結果變零後清除舊卡片。

`tests/multi-difficulty-postgres.cjs` 在獨立 PostgreSQL 18.3（PGlite 0.5.8/WASM）實際執行修正版 migration 和查詢，不使用 Supabase 連線。36 筆 published 加 1 筆 draft fixture 驗證 OR／空選／全選、零筆與越界總数、兩頁無重複／遺漏、全部篩選及排序、anon/authenticated 的 RLS 與 INVOKER 權限。比較 migration 前後原 RPC 定義、回傳、owner/ACL/search_path、資料與 RLS；另測自訂 owner、PUBLIC、grant option、NULL/default ACL、不洩漏 default grants、早期及 CREATE 後失敗的 transaction rollback。

執行：`node tests/multi-difficulty-postgres.cjs`。預設使用既有 `test-results/we-postgres/node_modules/@electric-sql/pglite`，可傳入其他 PGlite package 路徑。若要測正式函式匯出檔，設定 `SEARCH_RPC_FIXTURE_FILE` 為 SQL 或 CSV 路徑；只將函式載入隔離 DB。

2026-10-08 已分別以專案 migration 建立的十參數版本，以及使用者提供的 `Supabase Snippet Untitled query (3).csv` 正式函式定義，在獨立 PostgreSQL 18.3 實際部署修正版並跑完全部驗證。兩輪各通過 71 個 PostgreSQL 斷言，另包含權限拒絕／分頁參數拒絕／失敗 rollback 驗證。23 組前端回歸測試通過。

CSV 包含函式定義，沒有匯出正式 ACL/RLS/資料。本機測試以 fixture 的 RLS、有效權限與測試資料驗證，不能代表已驗證正式 Supabase 環境；migration 在部署時讀取並複製當時的正式有效 EXECUTE ACL。沒有連線正式 Supabase、執行正式 SQL 或重跑正式舊 migration。人工部署後應確認正式結果與各頁面。
