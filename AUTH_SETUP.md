# Google / Discord OAuth 登入設定與測試

前端使用 Supabase 專案 https://wnjmtgefhgoshgmxmxbd.supabase.co 與既有公開 anon key。
沒有 Google Client Secret、service_role key 或 secret key。

## Supabase → Authentication → URL Configuration

Site URL:
https://azxdxd.github.io/Shit-Chart-Bar/

Redirect URLs（逐筆新增）：
https://azxdxd.github.io/Shit-Chart-Bar/
https://azxdxd.github.io/Shit-Chart-Bar/index.html
https://azxdxd.github.io/Shit-Chart-Bar/chart_detail.html
https://azxdxd.github.io/Shit-Chart-Bar/charter_studio.html
https://azxdxd.github.io/Shit-Chart-Bar/viewer.html
https://azxdxd.github.io/Shit-Chart-Bar/**
http://localhost:5500/**
http://127.0.0.1:5500/**

正式網址的 wildcard 僅限這個 repository 子路徑，涵蓋 chart_detail.html?id=42 等帶查詢參數的返回網址；只加入不含查詢參數的精確頁面不足以涵蓋這些網址。本機 5500 是目前文件與測試使用的 port，沒有另外的伺服器 port 設定。若另用其他連接埠，新增對應網址。
redirectTo 自動取目前 origin、路徑和查詢參數，保留 GitHub Pages 子目錄與譜面 id。
不需要額外 callback.html；目前為 Supabase 瀏覽器 implicit flow，SDK 會處理返回網址中的 session。

目前 js/auth.js 原本就使用 getOAuthRedirectUrl()，沒有寫死 localhost。
若正式登入仍回到 localhost，先確認後台 Site URL 已儲存為上面的正式網址，Redirect URLs 已加入上面的清單。
Supabase 對不被允許的 redirect_to 會改用 Site URL；前端無法覆寫後台允許清單。
此 repository 的文件不是後台設定，修改文件不會自動更新 Supabase。
部署後，Google / Discord 點擊登入時 Console 的 [Auth] OAuth redirectTo 必須是開始登入的正式頁面。
Network 的 /auth/v1/authorize 請求中 redirect_to 應與之相同（URL 編碼後）。
若缺少此診斷訊息或 redirect_to 仍是 localhost，確認 Pages 已發布新版 js/auth.js，再強制重新整理。
若 redirect_to 正確但回到 localhost，檢查同一 Supabase 專案 wnjmtgefhgoshgmxmxbd 的 URL Configuration。
Google Cloud / Discord Developer Portal 的 callback 仍使用 Supabase /auth/v1/callback，不改成 GitHub Pages。

## Google Cloud → OAuth Client

Authorized redirect URIs:
https://wnjmtgefhgoshgmxmxbd.supabase.co/auth/v1/callback

Authorized JavaScript origins:
https://azxdxd.github.io
http://localhost:5500
http://127.0.0.1:5500

Client Secret 只留在 Supabase Google Provider。
如果 OAuth App 還在 Testing，確認測試帳號列在 Google Auth Platform → Audience → Test users。

## 個人資料表

Google 登入 UI 可直接使用 auth session 中的 Google 名稱、Email 和頭像，不要求 profiles 表存在。
瀏覽器測試曾回報 public.profiles 不存在；這會產生 profile unavailable 警告，但不應阻止登入。
如果你已部署舊 schema 並安裝 on_auth_user_created trigger，請在 Supabase SQL Editor 執行
supabase/fix-auth-profile-trigger.sql，修復 NEW.app_metadata 欄位名稱錯誤。
如果尚未建立 profiles 表或 trigger，這個修補不是登入必要步驟；不要只執行觸發器函式再掛上缺少資料表的 trigger。

## 測試

1. 發布本機修改到 GitHub Pages（不只 index.html，也包含 js/ 與其他 HTML）。
2. 打開正式首頁，登入 / 註冊 → 以 Google 帳號登入。
3. 授權完成應返回同一頁，顯示名稱、頭像與登出按鈕；名稱 title 是 Email。
4. 重新整理，再切換頁面，確認登入狀態仍保留。
5. 點登出，確認登入按鈕恢復；重新整理確認沒有恢復舊登入。
6. 本機以 HTTP 靜態伺服器開啟，不要直接雙擊 HTML 使用 file://。
7. 可重跑本機驗證：node tests/auth.test.mjs。

## 排錯

DevTools → Network 勾選 Preserve log 後重試：
- js/auth.js、js/supabase.js：應為 200 與 JavaScript MIME type，不能 404 或回傳 HTML。
- esm.sh：若 ERR_BLOCKED_BY_CLIENT、CORS 或載入失敗，模組無法初始化。
- /auth/v1/authorize?provider=google：確認 redirect_to 是目前網站，不含 /rest/v1/auth/。
- 返回別的網站或 localhost：檢查 Supabase Redirect URLs 與 Site URL。
- Invalid API key / 401：確認前端公開 key 屬於這個 project。
- redirect_uri_mismatch：檢查 Google Cloud 的 Supabase callback URI。
- access_denied：使用者取消授權，或 Google Testing 帳號未列入 Test users。
- Database error saving new user：查看 Supabase Authentication / Postgres logs，檢查 handle_new_user trigger。
- [Auth] profile unavailable / PGRST205：profiles 表缺少；Google UI 使用帳號資料備援。
- [Auth] session、[Auth] OAuth、[Auth] signOut：為前端捕捉到的具體錯誤。

不要分享包含 access_token、refresh_token、授權 code 的完整返回網址或 session 資料。
## Discord OAuth

沿用同一個 Supabase client、getSession、onAuthStateChange 與 signOut。
四個頁面的登入視窗均提供 Google / Discord，redirectTo 與前述 Google 設定共用。

Supabase → Authentication → Providers → Discord：確認 Enabled 已開啟，Client ID / Client Secret 已儲存。
Authentication → URL Configuration：使用本文件前面的同一組 Site URL / Redirect URLs，不需為 Discord 新增另一組。
Discord Developer Portal → Application → OAuth2 → Redirects：
https://wnjmtgefhgoshgmxmxbd.supabase.co/auth/v1/callback
點 Save Changes。不要把網站首頁當成 Discord 的 callback；Supabase 才會再轉回網站。
Supabase 預設已要求 identify / email，不需要 bot 權限或邀請機器人。

測試：登入 / 註冊 → Discord → 授權 → 返回原頁 → 名稱、頭像及登出；
重新整理、跨頁確認仍登入，再登出確認恢復兩種登入按鈕；最後以 Google 重做一次。
尚未替使用者完成 Discord 真實帳號授權，因此實際 metadata 應以第一次登入後的開發診斷為準。

本機 localhost / 127.0.0.1 登入或恢复 session 時，DevTools Console 開啟 Verbose / Debug，
找 [Auth] user (safe fields)。只輸出 id、email、provider、顯示名稱、頭像和白名單 user_metadata。
不輸出原始 user/session、access_token、refresh_token、provider_token 或任意自訂 metadata。
正式網站不輸出此診斷。

Discord 常見 metadata：sub / provider_id（Discord ID，與 Supabase user.id 不同）、
full_name、name、custom_claims.global_name、avatar_url / picture、email / email_verified、iss。
前端也支援 global_name、preferred_username、username 的備援；不保證每个欄位都有值。
Email 可在導覽列名称的滑鼠提示查看，沒有 Email 時仍可顯示名稱。

既有 profiles 保留，不建立新的 users 表，也不在每次登入覆寫創作者自訂名稱與頭像。
新用戶觸發器已支援 Discord 顯示名稱、頭像與 provider_id。
若已安裝舊觸發器，可執行 supabase/fix-auth-profile-trigger.sql 更新函式；
若 profiles 尚未建立，OAuth UI 不依賴它，不需要為了登入執行整份 schema。

Discord 排錯：
- /auth/v1/authorize?provider=discord：確認 redirect_to 正確。
- Unsupported provider / provider is not enabled：確認 Supabase Discord Enabled。
- invalid redirect_uri：確認 Discord Portal 的 callback 精確一致並已保存。
- invalid_client：檢查 Client ID / Secret 是否屬於同一 Discord Application，只在 Supabase 後台更新。
- access_denied：授權被取消；網站會顯示返回錯誤。
- Database error saving new user：查看 Supabase Auth / Postgres logs 與既有 trigger。

## 2026-10-06 按鈕無反應除錯

本機新版語法和登入測試通過，但實際讀取 GitHub Pages 首頁時，只有 inline script，
兩個 OAuth 按鈕均沒有 onclick / data-oauth，且沒有載入 auth.js。
因此正式頁面的兩個按鈕根本不會呼叫 Supabase；這不是已證實的 Discord 邏輯回歸。
Git 只有初始示範版 commit，Google / Discord 的修改尚未形成可比較的 Git 歷史。

新增 js/login-controls.js，以 defer 傳統腳本獨立綁定 OAuth 按鈕。
點擊時動態載入既有 auth.js，與頁面原本 module 共用相同模組和 Supabase client；
移除原本 inline onclick 以避免重複呼叫。沒有對缺少的元素直接 addEventListener。
若 auth.js / supabase.js / CDN 失敗或載入超過 12 秒，畫面與 Console 都顯示错误。

Console 開啟 Preserve log，正常順序：
[Auth] login buttons bound: 2
Google login clicked 或 Discord login clicked
[Auth] signInWithOAuth: google 或 discord

如果沒有第一行，Network 檢查 js/login-controls.js 是否 200 且是 JavaScript，並確認部署新版 HTML。
如果有點擊但 module load failed，檢查 auth.js、supabase.js、esm.sh。
如果有 signInWithOAuth 但未跳轉，查看 [Auth] OAuth failed (...) 與 Network。

發布至少包含四個 HTML、js/login-controls.js、js/auth.js、js/supabase.js；
只修改本機檔案不會自動更新 GitHub Pages。這次未推送或更改遠端 Provider 設定。
測試：node tests/auth.test.mjs 與 node tests/login-controls.test.mjs。
