# 展譜圖 Viewer 修改與測試

本次只修改前端展譜圖顯示與操作。沒有修改 Database schema、RLS、OAuth、Storage bucket 或下載流程。

## 修改檔案

- `chart_detail.html`：沿用展譜圖分頁，改為單一控制列、可捲動 viewport、原圖與倍率／尺寸資訊；移除舊縮放及複製圖片 modal。
- `css/chart-strip-viewer.css`：只套用展譜圖的尺寸、捲動、手機與全視窗樣式。
- `js/chart-strip-viewer.js`：原始像素縮放、滑鼠位置縮放中心、拖曳、雙指縮放、Fit Height、Reset 與全視窗／ESC。
- `js/pages/chart-detail.js`：把實際 Storage 展譜圖 URL 交給同一個 Viewer；相同 URL 的資料刷新不重建圖片或清除觀看位置。
- `tests/chart-strip-viewer.test.mjs`：互動、尺寸與錯誤狀態的自動化測試。
- `tests/strip-viewer-preview.mjs`：產生三張實際 PNG 的本機瀏覽器測試頁及測試伺服器；輸出放在已忽略的 `test-results/strip-viewer/`，不會上傳 Storage。

## 原本問題

原圖被設定為 `width:280px`。原本的「1 倍」代表 280px，而非圖片原始尺寸；最大 4 倍仍只有約 1120px。外層與內層都是 `overflow:hidden`，平移依賴 CSS transform，沒有正確的原圖尺寸捲動範圍。全螢幕又複製該縮小圖片到 `max-width:400px` 的 modal。

## 完成後行為

- 預設 **Fit Height**：依 viewport 可用高度／`naturalHeight` 計算，並扣除原生水平 scrollbar 佔用的空間。圖片寬度依原始比例延伸。
- 100% 使用 `naturalWidth × naturalHeight`；50% 為原尺寸的一半，200% 為兩倍。
- 縮放範圍 **5%–800%**。按鈕提供 5／10／25／50／75／100／125／150／200／300／400／600／800% 階段；Ctrl＋滾輪為連續縮放。
- `−`、`＋` 與 100% 保留 viewport 中心附近的原圖位置；Ctrl＋滾輪保留滑鼠指向位置。原圖邊界仍遵守原生 scroll 範圍，可能被瀏覽器限制。
- Reset 回到 Fit Height 與圖片左上起點。
- 支援滑鼠按住拖曳、原生水平／垂直 scrollbar、手機單指平移與雙指縮放。Pointer move 以 animation frame 合併；原生 scrollbar 不會被拖曳事件攔截。
- 全螢幕採 **全視窗大型模式**，同一個 Viewer 固定覆蓋瀏覽器可視區域，保留所有控制、拖曳與捲動；ESC／離開按鈕可退出。沒有複製第二張圖片。圖片載入失敗時也可退出。
- 只在 Viewer 裡攔截 Ctrl／Cmd＋滾輪；普通 wheel 仍使用原生捲動。
- 只改同一張原始 `<img>` 的顯示寬高，不使用 Canvas、Base64 重繪或重新下載來縮放。

## CSS 限制

一般圖片的 `img{max-width:100%}` 保留，以免改變封面／頭像。展譜圖以更明確的 `.strip-viewport img.strip-image` 規則設定 `max-width:none; max-height:none`，因此不受該一般限制。Viewer 外框的 `max-width:100%` 限制容器，而非原圖；超大內容只在 `overflow:auto` 的 viewport 裡捲動。

## 瀏覽器測試結果

使用實際 PNG，在 1280×720 桌面 viewport 測試：

| 原圖 | 預設 Fit Height 實際顯示（約） | 100% | 50% | 200% | 可到最右端 | 整頁水平溢出 |
| --- | --- | --- | --- | --- | --- | --- |
| 3000×1048 | 1305×456 | 3000×1048 | 1500×524 | 6000×2096 | 是 | 無 |
| 10000×1048 | 4351×456 | 10000×1048 | 5000×524 | 20000×2096 | 是 | 無 |
| 30000×1048 | 13053×456 | 30000×1048 | 15000×524 | 60000×2096 | 是 | 無 |

- 三尺寸皆保留長寬比例；100% 的 browser bounding box 等於原始尺寸。
- Zoom In 與模擬的原生 Ctrl＋Wheel 事件保持中心原圖像素，瀏覽器小數／裝置像素捨入誤差不到 1px，沒有跳回左上。
- 三尺寸皆驗證全視窗為 1280×720、六個控制鈕與單一 `<img>`，ESC 後恢復內嵌模式；Reset 回到 Fit Height 與 scroll 0。
- 30000px 圖實際滑鼠拖曳由水平約 774px 移動到約 1025px，垂直由 296px 到 396px，游標狀態正常恢復。
- 800% 的 30000px 圖實際顯示 240000×8384px。
- 測試伺服器在第一輪完整的縮放與全視窗測試後，三張 PNG 各只有一次請求。
- 390×844 手機 viewport 下，三尺寸的 100% 與最右端捲動皆正常。文件 `scrollWidth` 和 `clientWidth` 都是 385px（另有頁面 scrollbar），沒有長圖造成的整頁溢出；其他測試圖片維持 64×64。
- 手機全視窗正常，Fit Height 的圖片高度等於可用 viewport 高度。雙指縮放的互動邏輯有自動化測試，未使用實體手機驗證。
- 真實詳情頁已載入 Storage 中的 2720×1048 展譜圖；新控制列、評論、封面與創作者資料正常，瀏覽器沒有 error／warn。切換 100%、全視窗、Fit Height 與 ESC 前後，封面維持 160×160、創作者頭像 72×72、評論頭像 36×36。

自動化測試與既有詳情頁／登入／私有下載／投稿／初始化宣告回歸檢查均通過。本機 PNG 測試不操作 Supabase。
