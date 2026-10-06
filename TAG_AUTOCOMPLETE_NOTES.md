# Tag autocomplete

## 部署

只需在 Supabase SQL Editor 一次執行整份新檔：
`supabase/migrations/20261006_chart_tag_autocomplete.sql`。

前提：自訂標籤 migration 已成功套用，包含 normalize_chart_tag、set_chart_tags、popular_chart_tags。這次沒有修改初始化 SQL 或已套用的自訂標籤 migration。新 SQL 使用 BEGIN/COMMIT，最後 NOTIFY reload schema；尚未在線上執行。成功後重新整理網站。

## 變更

- js/chart-tags.js：共用 autocomplete editor、已選 chips、建議排除、鍵盤與 IME 組字處理、300ms debounce 和 request revision 防護。
- js/api.js：新增 searchChartTags(query, limit)，只呼叫搜尋 RPC。
- js/pages/charter_studio.js：投稿／編輯共用同一 editor，注入搜尋與熱門來源。
- charter_studio.html：下拉區域、combobox/listbox 無障礙屬性、44px 觸控選項、限高捲動和窄螢幕輸入框。
- 新 migration 與 autocomplete／PostgreSQL 回歸測試。

## RPC 與索引

`public.search_chart_tags(search_query text, result_limit integer DEFAULT 10)`

只回傳 id/name，預設 10、限制 1～20；空或超長搜尋不回傳資料。部分文字按 exact、prefix、contains 優先，再依可見 published 譜面使用次數、名稱及 id 排序。搜尋輸入沿用 normalization，LIKE 的 %、_、反斜線按文字匹配。SECURITY INVOKER、固定 search_path，anon/authenticated 有 EXECUTE；不關閉 RLS，也不公開使用者或投票資料。

新增 pg_trgm extension（若已有則沿用實際 schema）、tags_autocomplete_trgm_idx（GIN name）、chart_tags_tag_chart_idx（tag_id,chart_id）。字典既有 UNIQUE 仍保留。沒有變更 search_charts／tag_filter／popular_chart_tags／set_chart_tags。

空白輸入使用既有 popular_chart_tags（RPC 本身最多20筆，輸入 editor 截至10），有文字才呼叫 search_chart_tags（要求10筆）。不下載全字典，不以 localStorage 保存字典。最多10個既有建議，另可加1個「建立標籤」動作。建立／選取只修改前端 selected names，最後儲存仍使用 set_chart_tags，不直接 INSERT 字典／關聯。

索引有利於部分文字搜尋；1～2字元或非常廣泛的 contains 搜尋仍可能扫描大量匹配，索引不是所有輸入皆固定成本的保證。使用次數只在匹配集合計算，關聯索引協助聚合。本機加入100,000筆字典測試少量結果和上限；不將本機 WASM 時間當作 Supabase production 效能保證。

## UI 與請求

聚焦空輸入可顯示熱門；↑／↓移動 highlight，Enter 選取 highlight 或新增合法輸入，Escape 關閉。點建議、新增、移除與切換編輯時同步 selected chips。10個上限、20字元、trim、ASCII lowercase 與去重不變。編輯 published 仍走原 metadata/tag 儲存路徑，不改 status。

每次輸入立即清除舊 timer 並增加 revision，300ms 後發送最後輸入。回應僅當 revision 仍相同且 dropdown 開啟時採用；Escape、blur、set/reset、增加／移除使在途回應失效。失敗顯示提示，保留手動新增能力，不影響首頁搜尋。pointerdown 防止選項搶焦點，觸控／滑鼠均使用 click。

## 驗證與手動驗收

自動測試：熱門／部分搜尋、點擊、Enter、↑↓、Escape、新名稱、重複、大小寫／空白、長度與數量、debounce、舊回應、新 editor 狀態、錯誤後手動輸入；DOM使用mock。PostgreSQL WASM實際執行完整新 migration（包含 pg_trgm/GIN），驗證兩角色搜尋、排序、literal wildcard、上限、100,000筆測試；既有標籤 migration、儲存RPC、published狀態及交易回滾也回歸通過。

需手動：套用新 SQL 後，在桌面與手機各測投稿／編輯的下拉位置、觸控捲動及選擇、中文輸入法、鍵盤操作；儲存後重新載入確認最新 chips，published 不變；確認首頁、搜尋、Tag filter及詳情照常。尚未執行真實 Supabase 寫入或真實手機／桌面瀏覽器驗收。
