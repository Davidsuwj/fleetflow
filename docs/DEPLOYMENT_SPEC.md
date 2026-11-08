# 部署與維運規格

## 正式架構

[系統架構圖與通訊／部署流程](SYSTEM_ARCHITECTURE.md)涵蓋程式語言、JSON API、PostgreSQL TCP／TLS，以及本機與 Python 參考路徑。

GPT Sites 同時執行前端與 JavaScript Worker API，直接連至 PostgreSQL DB_NAME 的 fleetflow schema。網站不使用 ngrok、Railway 或本機常駐服務。Python FastAPI 對照版與資料庫建置工具保留於 backend/，不列入正式請求流程。

Site：https://fleetflow-company-vehicles.davidsu881209.chatgpt.site

.openai/hosting.json 已綁定既有 Site，後續更新重用同一 project_id。依需求設定 Public，任何取得連結者可開啟登入頁；應用程式使用員工編號 employee_id＋密碼登入。

員工版開放 auth/login、auth/session、auth/logout，以及需登入的 employee-context、my-applications、my-dispatches、availability、唯讀 vehicles 與 health。employee-options 移除。不部署管理者介面；Worker 不開放舊的名冊維護、人工審核、人工派車或費用管理 API。公司基本資料以 SQL 或本機 Python 參考 API 維護；employee-context 額外提供大家的共享預約，個人資料仍由 session 篩選。

## 執行環境

| 變數 | 正式 Site 用途 |
|---|---|
| DB_HOST | 由部署環境提供的資料庫主機 |
| DB_PORT | 5432 |
| DB_NAME / DB_USER | 由部署環境提供的資料庫名稱／專用使用者 |
| DB_PASSWORD | Sites 秘密值，不提交原始碼 |
| DB_SSLMODE | 依部署環境設定並驗證傳輸保護；不可由瀏覽器 HTTPS 推定 |

正式 Worker 不設定 API_ORIGIN 或 SERVICE_API_KEY。Site 執行環境值由平台保存，改值後須重新部署。

## 資料庫建置

使用 Python 工具執行 `python -c "from backend.db import migrate; migrate()"`，先在 .env 填入安全的資料庫設定。migrate 用 transaction 與 advisory lock；版本 1 建表，002 移除帳號表，003 新增 phone_id 為電話主鍵、保留電話資料；004 鎖表檢查同車同日期重複，改日期複合主鍵並移除保養序號／加油編號。有重複則 rollback，不丟資料，須先明確整理。005 新增 employees.password及 session／登入限流支援表；只建置本專案 fleetflow schema。正式 API 不在每次請求執行 migration。

資料庫已存在時，CREATE TABLE IF NOT EXISTS 不會自動變更結構；新欄位必須以登記 migration 處理。需要示範資料時可執行 python -m backend.seed_demo，建立已核准申請與未來派車；已有員工則略過。日期弱實體更新沿用原有資料表、登記 migration 004；員工新增 password 一般屬性，不增加管理者／accounts 實體。

## 建置與发布

```powershell
npm ci
npm run check
npm test
npm run build
```

build 使用 esbuild 的 workerd 條件選取 Postgres.js 的 Cloudflare 相容實作，產生 dist/server/index.js，包含正式後端與六個前端資產，保留 cloudflare:sockets 和相容 node:* 執行環境模組。資料庫秘密不嵌入輸出。

Sites 標準流程：取得同一 Site 短效原始碼憑證；推送確認原始碼狀態；使用相同 commit 的建置輸出封裝；保存版本並依目前 Public 分享設定部署；確認 status=succeeded。憑證只用 session 記憶體／stdin。封裝包含 .openai/hosting.json 和 Worker 入口，不包含 Python 啟動服務、.env 或本機紀錄。

Windows 封裝使用 Git Bash 與隨附 Node 執行環境；Git Bash 的 archive 路徑用 /c/...，實際上传使用同一 C:/... 絕對檔案。網站可用性不依賴這些本機開發工具。

## 本機預覽

```powershell
npm run dev
```

127.0.0.1:8770 執行相同 Worker 入口與 API 原始碼，以 Node 相容 PostgreSQL 驅動連接 .env 的資料庫。只綁定 loopback。正式環境用 Cloudflare Worker TCP 驅動。Python 對照版本另以 uvicorn 開發，Dockerfile／railway.toml 僅為參考版設定。

## 維運

請求結束關閉連線；連線 8 秒、SQL 12 秒逾時。資料庫失聯回傳 503，不產生假資料。排查 Site Worker log、秘密執行環境、資料庫外網允許來源與連線狀態。

變更前備份 fleetflow schema，備份密碼由安全環境提供；復原先在隔離資料庫驗證。Site 可重新部署已保存版本，但 SQL migration 的回復須考量相容性，不能只退網站版號。

GitHub 保存完整程式及文件；main 為單一完整提交。Sites 來源版本與 GitHub 公開歷史分開處理，避免重建 GitHub 歷史影響網站更新。

## 員工登入初始化

先 migration 005，再發布使用明確欄位與 session 驗證的新 Worker，之後執行 `python -m backend.employee_passwords --provision-missing`。這個順序避免舊版 SELECT e.* 回傳新增密碼欄位。密碼保存 .local/員工登入資料.txt（Git 忽略），只處理沒有密碼者。`--reset 員工編號` 互動輸入新密碼並撤銷既有 session。正式 Worker 不初始化或重設密碼。

只在本機測試可設定 DEV_DB_SCHEMA=fleetflow_test_<12 hex> 讓預覽使用隔離資料；正式 Worker 不讀此變數。正式部署仍直接連線 fleetflow。

## 員工識別整併版本

歷史 migration 006 引入衍生 employee_code；新版 007 驗證後移除此冗餘欄位。先以隔離 schema 驗證並備份，再發布不依賴 employee_code 的相容 Worker，最後套用 007，避免舊程式在刪欄後失效。新程式以 employee_id 查詢，舊 EMP 格式只在輸入層轉換。007 保留既有編號、密碼、session、申請與派車；任何非預期欄位或資料應停止遷移，不自動刪除或重編。實際執行結果如下。

### 正式資料庫整併完成（2026-11-08）

正式 migration 007 已於 2026-11-08 05:26:51 UTC 在既有部署電腦執行並以新連線核實。執行前確認所有舊別名可從 employee_id 完整重建，保留本機備份及 006 回退檔；執行後版本標記包含 7、employee_code 已移除，既有員工識別、密碼、session、外鍵與其他業務資料均核對不變。未刪除任何其他資料表。備份及驗證結果只存於部署電腦的 .local/identity-migration-20261108/，不提交 GitHub。

網站第 10 版已先發布不依賴 employee_code 的相容 Worker；畫面、登入、API 及正式 schema 現在統一使用 employee_id。舊 EMP 格式只在輸入層轉換成同一員工編號，原密碼不變。隔離 PostgreSQL 18.6 另驗證新建、重複執行、資料保留與不符規則時整筆 rollback。

若需回退舊版程式，須先在同一交易及 advisory lock 下執行歷史 006 重建衍生欄位，移除 version 7 標記後才回退網站版本。既有員工不需重設密碼或重編，已開啟的網站頁面請重新整理。
