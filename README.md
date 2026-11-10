# FleetFlow｜公司公務車借用系統

以**員工編號與密碼登入**的公務車借用 demo。員工可新增、修改、查詢、取消、刪除自己的申請，登記歸還及查看個人統計；「車輛預約」可查看大家的用車安排並依起迄時間查空車。

[GPT Site](https://fleetflow-company-vehicles.davidsu881209.chatgpt.site) · [Public GitHub](https://github.com/Davidsuwj/fleetflow) · [完整規格](SPEC.md)

前端與 JavaScript Worker API 直接部署 GPT Sites，連線 PostgreSQL，不依賴 ngrok、Railway 或本機服務。Python FastAPI 參考版本保留。

## 系統架構

![FleetFlow 系統架構與部署方式](docs/system-architecture.svg)

Repo 所記載的正式路徑：**HTML／CSS／JavaScript 瀏覽器前端 → HTTPS 同源 JSON API → GPT Sites JavaScript Worker → PostgreSQL TCP（預設 5432）**。建置使用 Node.js 與 esbuild；Python FastAPI、Docker／Railway 為獨立參考路徑。瀏覽器 HTTPS 不代表資料庫連線也受相同保護；目標平台的原生 TCP 相容性未於本次重新驗證。

[完整架構、API 與通訊說明](docs/SYSTEM_ARCHITECTURE.md) · [開啟 SVG 架構圖](docs/system-architecture.svg)

## 功能

| 頁面 | 功能 |
|---|---|
| 員工登入 | employee_id＋password、持續登入、登出 |
| 我的用車 | 個人摘要、全部已預約及使用中行程 |
| 我的申請 | 新增、修改、取消、刪單、搜尋及狀態篩選 |
| 車輛預約 | 大家的預約、指定起迄查空車 |
| 車輛紀錄 | 點選車牌查看該車車況，切換保養／加油紀錄 |
| DEV 車隊管理 | 新增／編輯車輛、刪除（可復原封存）、保養／加油紀錄及 CSV 匯入 |
| 個人統計 | 申請／行程／歸還數、預約時數、近六個月數量 |

新增車輛預設為 **Rolls-Royce Cullinan 6.75 V12**，管理員可自訂車型，以唯一車牌識別。另有專用 DEV 管理後台；申請有效且有空車時自動核准並派車。可指定車輛或自動安排。

## 時段防呆

區間採 [出發, 歸還)：若既有起日 < 新迄日，且既有有效迄日 > 新起日，即重疊。同台車與同員工的重疊行程都拒絕；相鄰時段允許。查空車僅反映查詢當下，送出時會在交易內鎖定員工與車輛，再次確認衝突。兩人同時指定同台車，最多一筆成功，另一筆 409，不會留下半套單據。

修改、取消、刪單只適用尚未開始及未歸還的預約；修改失敗保留原預約。取消保留申請、移除預約；刪單移除申請與預約。開始使用後可登記歸還。

## ERD 與關聯綱目

![公司公務車借用系統 ERD](docs/erd.svg)

員工包含一般屬性 **password**，employee_id 仍為唯一 PK。保養及加油皆為弱實體，以日期為部分鍵，PK 分別為 (vehicle_id, maintenance_date)、(vehicle_id, refueling_date)。電話為多值屬性，不是 PK。

![關聯綱目](docs/relational-schema.png)

只有 PK 加底線；FK 箭頭指向參照 PK；複合 PK 欄位分別加底線，不畫下方括線。[綱目說明](docs/RELATIONAL_SCHEMA.md) · [SVG](docs/relational-schema.svg)。登入工作階段與限流表為實作支援表，主圖仍呈現七個領域實體。

## 網站畫面

![車輛紀錄](docs/screenshots/employee-vehicle-history.png)

## 本機建置

Node.js 22+、Python 3.11+、可連線 PostgreSQL。

```powershell
npm ci
python -m pip install -r requirements.txt
Copy-Item .env.example .env
# 填入本機環境變數，勿提交 .env。
python -c "from backend.db import migrate; migrate()"
python -m backend.seed_demo
python -m backend.seed_vehicle_records
python -m backend.employee_passwords --provision-missing
npm run dev
```

本機預覽 http://127.0.0.1:8770。初始員工密碼保存在被 Git 忽略的 `.local/員工登入資料.txt`；執行 provision-missing 只處理未設定密碼者，不覆寫既有密碼。重設指定員工：

```powershell
python -m backend.employee_passwords --reset 1
```

新密碼以互動輸入，不放入命令列。重設會撤銷該員工既有登入。Python API 對照版以 `uvicorn backend.main:app --host 127.0.0.1 --port 8767` 執行；內部建置 API 另受 SERVICE_API_KEY 保護，不是正式網站相依服務。

## 資料與登入

PostgreSQL：DB_HOST:5432，database 與使用者分別由 DB_NAME／DB_USER 設定，使用 fleetflow schema。DB_PASSWORD 只在本機 .env／Sites 秘密值保存。

此為課程 demo，不適用真實帳號；正式使用前須強化密碼驗證及資料庫傳輸保護。一般查詢、登入回應及共享預約均不回傳密碼。員工身分取自伺服器 session；改網址或 body 中 employee_id 無法存取他人私有資料。大家的預約頁僅共享車牌、姓名、用途、起迄時間；電話與個人統計不共享。

登入 session 最長 8 小時，使用 HttpOnly／SameSite=Strict Cookie，正式 HTTPS 加 Secure。登出及重設密碼撤銷 session；寫入需 CSRF token。同員工編號 15 分鐘內錯誤 5 次、同來源錯誤 30 次會限流。GPT Site 已設為 Public，任何取得連結者可開啟；系統資料仍需員工編號與密碼登入。

## 驗證

```powershell
npm test
npm run check
npm run build
python -m pytest -q
```

測試使用獨立 fleetflow_test_<12 hex> schema，涵蓋登入／登出／過期／CSRF／個人隔離、共享查空車、指定車輛重疊及併發、日期複合主鍵、migration rollback、刪單和歸還。CI 範本為 docs/CI_TEMPLATE.yml，尚未啟用 GitHub Actions。

## 文件與限制

[架構](docs/SYSTEM_ARCHITECTURE.md) · [功能](docs/PRODUCT_SPEC.md) · [資料庫](docs/DATABASE_SPEC.md) · [API](docs/API_SPEC.md) · [安全](docs/SECURITY_SPEC.md) · [部署](docs/DEPLOYMENT_SPEC.md) · [測試](docs/TEST_SPEC.md) · [Python OpenAPI](docs/openapi.json)

尚無分頁或密碼找回。員工由建置工具建立；未設定密碼的員工不能登入。逾期未歸還不會自動延長原預約；營運資料應透過 API 操作。此為課程 demo。

員工識別統一使用 `employees.employee_id`（數字員工編號），同時作為登入帳號與既有 PK／FK；不另設工號欄位。密碼、員工編號與既有申請／派車關聯維持不變。舊 `EMP0001` 格式及登入 JSON 的 `employee_code` 欄位僅為相容輸入，伺服器轉成同一個 employee_id，不另外儲存或回傳 employee_code。ERD／關聯綱目中員工只有 employee_id 為主鍵並加底線。

「我的申請」集中顯示申請、車牌、使用期間、已預約／使用中／已歸還狀態與歸還操作。「申請用車」按鈕只出現在「我的申請」頁。

示範車輛可匯入保養與加油模擬資料。`python -m backend.seed_vehicle_records` 只補入固定歷史日期的模擬資料，依車輛／日期略過既有紀錄，不更動車況、申請或員工。

## DEV 車輛管理

同一登入畫面輸入 `DEV` 與獨立管理密碼，進入車輛管理後台。可新增車輛、編輯車牌、車型與可借／保養／停用狀態，新增保養與加油紀錄，或下載 CSV 範本、預覽後批次匯入（最多 100 筆及 32 KB）。車輛／日期仍為複合主鍵；既有紀錄不覆蓋。匯入任一筆錯誤時整批 rollback。若有未歸還或未開始預約，不能改為保養／停用。

DEV 使用 Sites 秘密環境變數 `DEV_ADMIN_PASSWORD_HASH`，格式為 PBKDF2-SHA256／100,000 次迭代；不提供預設密碼，不在程式、前端或 Git 保存密碼。此課堂系統的獨立高熵 DEV 密碼須另行交付。更換該雜湊值並部署會撤銷既有 DEV session。DEV session 為 8 小時、HttpOnly／SameSite=Strict／HTTPS Secure Cookie，寫入需 CSRF token，登入有 15 分鐘限流。獨立 session 存在新 `dev_auth_sessions` 輔助表，首次 DEV 登入會在 advisory lock 內以 `CREATE TABLE IF NOT EXISTS` 建立，不變更員工、車輛及歷史紀錄。登出撤銷伺服器 session。一般員工 cookie 無法使用 DEV API。

`npm run test:unit` 不需資料庫；`npm test` 另執行獨立 PostgreSQL 測試 schema 的整合測試。

刪除車輛採「可復原封存」：從可借車隊移除，保留車輛主鍵、已歸還行程及保養／加油紀錄；有未開始或未歸還預約則拒絕。管理員可透過編輯狀態改回「目前可借」復原，不提供永久刪除。車牌去首尾空白並轉大寫，包含封存車輛在內不得重複。
