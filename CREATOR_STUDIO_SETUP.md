# 創作者中心修改與部署

> 更新：實際線上只有 Authentication，應使用首次初始化 `supabase/initialize-backend.sql`。
> 部署步驟以 `supabase/INITIALIZE_BACKEND.md` 為準；下方舊 migration 說明不適用此次初始化。

## 需要到 Supabase SQL Editor 執行

完整 SQL 在 `supabase/creator-studio.sql`。本次沒有在 Dashboard 執行任何 SQL。
此 migration 以既有 `supabase/schema.sql` 的 tables 為前提，不要在既有專案重新執行整份 schema.sql。
若 Dashboard 缺少 charts / profiles，先確認實際 schema，不要建立第二套投稿資料表。

現有 charts.user_id → profiles.id → auth.users.id 已經關聯使用者 UUID，不需要新增 creator_id。
chart package 內保留 .ugc 與音源；封面從 ZIP 提取並上傳 cover-art，記錄 cover_path。
因此不需 chart_file_url / audio_file_url 欄位或新增 bucket。

SQL 補上 charts / profiles 的 own-row WITH CHECK、不可轉移 user_id 的 trigger、
發布前 package_path / cover_path 的檢查，以及四個既有 buckets 的 own-folder UPDATE / INSERT。
avatars 每次使用新路徑，避免瀏覽器快取舊頭像。
SQL 最後列出 policies；Supabase permissive policies 以 OR 結合，請檢查是否另有允許任何人
寫入 charts / profiles / storage.objects 的政策，避免其他廣泛政策繞過 own-row 限制。
既有 chart_tags_manage_own 政策也應保留。

## 格式與限制

ZIP 必須包含至少一個非空 .ugc、一個 .mp3 / .ogg / .wav 音源、一個 .jpg / .png 封面。
不要求 XML、meta.json、.chs 或展譜圖。音源與圖片檢查檔頭，ZIP 檢查 MIME（有提供時）並實際解析。
UGC 尚無專案內格式規格，因此只檢查非空且非全零，沒有宣稱語意驗證。
RAR 現階段無解析器，請轉成 ZIP。上傳上限 100 MB、解壓上限 200 MB、最多 2000 entries。
JSZip 3.10.1 由 CDN 載入，需要允許該來源；載入失敗不會放行投稿。
前端驗證可被繞過。若要在伺服器保證包內容，還需要可信的後端解壓檢查，
目前 RLS 管理擁有權、trigger 檢查檔案路徑，不會解壓 Storage 中的 ZIP。

## 身份與管理

管理頁每次進入查詢 charts，user_id 等於 currentUser.id，包含自己的草稿與下架作品。
空列表顯示「你目前還沒有投稿任何譜面」和投稿入口；投稿與刪除後重新查詢。
已移除 Calamity Fortune、End Time、Arcaea (WIP)、Kagami (鏡)、假統計與兩組分析圖陣列。
沒有刪除任何 Supabase 資料列。

Google 預設名稱：full_name / name / user_name / preferred_username / username / email。
Discord 優先 custom_claims.global_name / global_name，再使用上述名稱欄位。
頭像：avatar_url / picture。已儲存 profiles.charter_name / username、avatar_url 優先。
自訂名義、簡介、社群資料保存 profiles；頭像放 avatars，URL 保存 profiles.avatar_url。
OAuth、單一 Supabase client、登入登出沿用原程式。

## 驗證

執行 `node tests/auth.test.mjs`、`node tests/login-controls.test.mjs`、
`node tests/creator-studio.test.mjs`。已通過本機 mock 測試與語法檢查。
測試覆蓋 Google / Discord metadata 與 OAuth 呼叫、空帳號、缺少各類檔案、檔頭錯誤、
完整三檔、投稿 UUID、另一帳號查詢、刪除、未登入阻擋與 profile 保存 payload。
不代表已完成線上 A–J 端到端測試。沒有 Dashboard 權限或真人 Google / Discord session。

執行 SQL 後請依使用者要求的 A–J，以兩個實際帳號操作，特別驗證：
自訂名稱與頭像登出再登入、成功上傳後 UUID、另一帳號看不到前一帳號管理列表、
用另一帳號 request 更新/刪除譜面被 RLS 拒絕。
Google / Discord provider、callback 與 redirect allowlist 不需因本次修改更動。
