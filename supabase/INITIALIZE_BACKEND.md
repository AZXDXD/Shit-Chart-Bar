# 本次應執行的檔案

`initialize-backend.sql` 是 A：首次初始化。尚未到 Supabase 執行。
`schema.sql` 是歷史完整初始化草案；`creator-studio.sql` 是 B：舊部署的升級 migration。
本次只執行 A，不要另外執行 schema.sql / creator-studio.sql / fix-auth-profile-trigger.sql。

## 實際前端對應

| 程式 | 相依物件 |
| --- | --- |
| js/auth.js | profiles，以 Auth UUID 查詢 |
| js/pages/charter_studio.js | charts、profiles、tags、chart_tags |
| js/api.js | 上述四表，加 chart_tag_votes、reviews、review_helpful、favorites、downloads、community_ratings；search_charts / increment_view RPC |
| js/storage.js | chart-packages、cover-art、chart-strips、avatars |
| js/package-validation.js | 檢查 ZIP 內 .ugc、音源與封面，不另上傳 UGC / audio |
| js/pages/index.js、js/pages/chart-download.js | 點擊下載時重新讀取譜面資料，再取得短效 signed URL |

四張核心表加六张現有 API 相依表，總共十張。不建立 submissions / creators。
附加表沿用原 schema 與 API 命名，用於評論、收藏、下載記錄、標籤投票、難度投票。
只有 tags 插入預設選項；不插入範例 charts、評論、收藏或下載。

charts.user_id 同時直接 REFERENCES auth.users(id) 並 REFERENCES profiles(id)。
前者符合 Auth UUID 擁有者要求，後者保留 getChart 的 profiles:user_id PostgREST 關聯。
檔案欄位 package_path / cover_path / strip_path 與前端一致，沒有自行增加 audio_file_url。

## 首次初始化內容

- transaction 中先檢查十張表、四個 buckets 與 profile trigger 是否已存在。
  有衝突就停止，不覆蓋；其他同名 types / functions 也會使 CREATE 失敗並 rollback。
- profiles 的新增 / 更新只允許 auth.uid() = id；公開創作者資料可讀。
  is_verified 不授予前端 INSERT / UPDATE 權限。
- charts 公開已發布作品；擁有者可讀自己的全部狀態。新增、更新、刪除只限自己。
  UPDATE 有 USING 與 WITH CHECK；另有不可轉移 user_id 的 trigger。
  前端只能寫入 metadata / paths，不能寫入計數與平均評分。
- chart_tags 的寫入檢查 charts 擁有者，SELECT 隨 charts RLS 可見性。
- 其他六表沿用評論、收藏、下載及投票政策與必要 GRANT。
- chart-packages 是 private；cover-art、avatars、chart-strips 是 public。
  圖片 SELECT 可公開讀。遊玩包 SELECT 僅擁有者或 package_path 精確對應已發布譜面可讀。
  訪客也可取得已發布遊玩包的 signed URL；其他人的草稿與未關聯的包不可讀或簽署。
  INSERT / UPDATE / DELETE 只允許 authenticated 自己 UUID 的第一層資料夾。
  前端 paths 是 user-id/chart-id/package.zip、user-id/chart-id/cover.ext、
  user-id/chart-id/strip.ext、user-id/avatar-uuid.ext，均與 foldername(name)[1] 一致。
  存入 charts 的 package_path 還需符合自己的 UUID 與當張 chart UUID。
- on_auth_user_created 只在 INSERT auth.users 後執行，兼容 Google / Discord metadata，
  ON CONFLICT DO NOTHING，不會因重新登入覆蓋自訂身份。
- 一次回填現有 Auth 帳號缺少的 profiles，不更動 Auth 帳號本身。
- profiles_updated_at / charts_updated_at / reviews_updated_at 自動更新時間；
  chart_publish_trigger 設發布時間；reviews_update_chart / downloads_count_trigger /
  cr_update_chart 更新統計；charts_validate_owner_and_files 檢查擁有者及檔案路徑。
- search_charts 保留前端 RPC 參數，補回原草案漏掉的 package_path；
  increment_view 僅更新已發布作品，明確授予兩個 RPC 呼叫權限。

## 前端與測試

這次不改資料表、欄位或 buckets 命名，也沒有更動 OAuth 或建立第二個 Supabase client。
下載程式已配合 private bucket 修改：不產生 package 的 public URL；下載時依真實 chart id
重新查詢 status / user_id / package_path，再以原 Supabase client 建立 60 秒 signed URL。
Storage RLS 是最終權限檢查，直接改 request 也不能簽署別人的草稿。
signed URL 是有效期限內可分享的 bearer link；作品下架、登出或改 policy 後，
已簽發的 URL 仍可能有效至 60 秒到期。新请求則依當時的狀態檢查。
目前 index.html 仍是原本 demo 探索頁，未載入 js/pages/index.js；本次不擴大重建首頁。
實際訪客下載可使用 chart_detail.html?id=<真實 UUID> 的原下載按鈕。
目前投稿、管理與身份頁程式可以對應此初始化結構。
SQL 不會驗證 ZIP 中的實際內容；目前檔案內容檢查仍在前端。
建立相依表不代表原本其他頁面的 demo UI 自動接通真實資料。
原 API 的 helpful vote 使用 supabase.sql，並非本次 SQL 可修復的前端問題，需另行修改才可完整啟用該互動。

本機已核對所有 API table / bucket 名稱、RLS / GRANT / trigger 宣告，並跑前端回歸測試。
沒有本機 PostgreSQL / Supabase 環境，所以未做真正 SQL 執行或線上 RLS 驗證。

確認後在 Supabase SQL Editor 貼入 initialize-backend.sql 整份執行。
成功後執行 inspect-creator-backend.sql，並以兩個實際帳號測試投稿 / 管理 / profile 與越權阻擋。
額外測試 private package：原 public URL 不可讀；訪客和第二帳號不能直接下載或簽署草稿；
擁有者可下載自己的草稿；發布後訪客可下載；下架後不可建立新下載連結；已發連結過期後不可用。
直接對另一個 UUID 資料夾 INSERT / UPDATE / DELETE 必須被拒絕。
Supabase Storage 全域上傳限制若小於前端 100 MB，需配合調整前端限制或專案可用設定。
不需變更 Google / Discord provider、OAuth callback 或 redirect allowlist。
