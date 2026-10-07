# 資料庫規格

## 連線與隔離

PostgreSQL，host `140.117.68.35`，port `5432`，database／Maintenance DB `project_17`，user `project_17`。密碼只透過環境變數提供。所有新物件置於 `fleetflow` schema，既有 `public`、`ghatcpt`、`ghatcpt_meta` 不修改。

`backend/schema.sql` 為初版 schema 建置腳本。Python 建置工具使用 transaction 與 advisory lock 執行可重入的初版初始化，並在 schema_migrations 登記版本 1。migration 002 已移除開發版 accounts 表，登記版本 2；003 改用 phone_id 作電話子表主鍵，原資料保留。004 將保養／加油改為車輛＋日期複合 PK，移除舊序號／編號；在同一交易鎖表及檢查重複，若有同車同日重複則整筆 rollback，要求先明確整理，不自動刪除或合併紀錄。005 增加 employees.password 明碼欄位，以及 auth_sessions、auth_login_limits 支援登入；未設定密碼不能登入，建置工具補設且不改既有密碼。未來版本必須新增 migration；`CREATE TABLE IF NOT EXISTS` 不會自動修改既有欄位。

## ERD 與關係映射

| Chen ERD | 實作 | 關係 |
|---|---|---|
| 部門 → 員工 | employees.department_id NOT NULL FK | 1:N；員工完全參與 |
| 員工 → 借用申請 | applications.employee_id NOT NULL FK | 1:N；申請完全參與 |
| 借用申請 → 派車紀錄 | dispatches.application_id NOT NULL UNIQUE FK | 1:0..1；派車完全參與 |
| 車輛 → 派車紀錄 | dispatches.vehicle_id NOT NULL FK | 1:N；派車完全參與 |
| 車輛 → 保養紀錄 | PK(vehicle_id,maintenance_date) | 1:N；保養為弱實體，maintenance_date 是部分鍵 |
| 車輛 → 加油紀錄 | PK(vehicle_id,refueling_date) | 1:N；加油為弱實體，refueling_date 是部分鍵，完全參與 |
| 員工雙橢圓聯絡電話 | employee_phones | 多值屬性拆成子表 |

員工與車輛的跨期間 M:N 透過申請和派車連結，不新增駕駛授權。七個領域實體之外，employee_phones、schema_migrations 是多值屬性與 migration 支援表。沒有另外 accounts 或駕駛授權表；員工本身保存 password。auth_sessions／auth_login_limits 為實作支援表，不新增領域實體。

## 完整資料字典

### departments（部門）

| 欄位 | 型別 | 限制 | 中文 |
|---|---|---|---|
| department_id | bigint identity | PK | 部門編號 |
| department_name | varchar(80) | NOT NULL、UNIQUE、非空白 | 部門名稱 |

### employees（員工）

| 欄位 | 型別 | 限制 | 中文 |
|---|---|---|---|
| employee_id | bigint identity | PK | 員工編號 |
| employee_code | varchar(32) generated stored | UNIQUE，EMP 加至少四位數 | 登入工號 |
| department_id | bigint | NOT NULL、FK departments、RESTRICT | 部門編號 |
| employee_name | varchar(80) | NOT NULL、非空白 | 姓名 |
| password | varchar(128) | 一般欄位、明碼；未設定不可登入；API 設定需 8–128 字元 | 密碼 |

### employee_phones（多值電話）

| 欄位 | 型別 | 限制 | 中文 |
|---|---|---|---|
| phone_id | bigint identity | PK | 電話編號 |
| employee_id | bigint | NOT NULL、FK employees、CASCADE | 員工編號 |
| phone_number | varchar(30) | NOT NULL；一般欄位，不是 PK | 聯絡電話 |

UNIQUE(employee_id, phone_number) 避免同一員工重複電話，唯一限制不是主鍵。API 每位員工最多十筆電話；空白不允許、重複電話去重。更換電話清單在同一交易內完成。

### vehicles（車輛）

| 欄位 | 型別 | 限制 | 中文 |
|---|---|---|---|
| vehicle_id | bigint identity | PK | 車輛編號 |
| license_plate | varchar(20) | NOT NULL、UNIQUE | 車牌號碼 |
| vehicle_model | varchar(100) | NOT NULL；API 固定 Rolls-Royce Cullinan 6.75 V12 | 車型 |
| vehicle_status | varchar(20) | NOT NULL、default available、CHECK available/maintenance/retired | 車輛狀態（操作欄位） |

### applications（借用申請）

| 欄位 | 型別 | 限制 | 中文 |
|---|---|---|---|
| application_id | bigint identity | PK | 申請編號 |
| employee_id | bigint | NOT NULL、FK employees、RESTRICT | 員工編號 |
| purpose | varchar(500) | NOT NULL、非空白 | 借用用途 |
| requested_start_date | timestamptz | NOT NULL | 預計起日 |
| requested_end_date | timestamptz | NOT NULL、晚於起日 | 預計迄日 |
| approval_status | varchar(20) | NOT NULL、default pending、CHECK pending/approved/rejected/cancelled | 審核狀態 |
| created_at | timestamptz | NOT NULL、default now() | 建立時間（操作欄位） |

### dispatches（派車紀錄）

| 欄位 | 型別 | 限制 | 中文 |
|---|---|---|---|
| dispatch_id | bigint identity | PK | 派車編號 |
| application_id | bigint | NOT NULL、UNIQUE、FK applications、RESTRICT | 申請編號 |
| vehicle_id | bigint | NOT NULL、FK vehicles、RESTRICT | 車輛編號 |
| actual_start_date | timestamptz | NOT NULL | 使用起日／本次派車起日 |
| actual_end_date | timestamptz | NOT NULL、晚於起日 | 使用迄日／本次派車迄日 |
| returned_at | timestamptz | nullable、不得早於起日 | 實際歸還時間（操作欄位） |

指定車輛可選，只存在派車 vehicle_id，不額外加入申請表欄位。沿用 ERD 的 actual_* 欄位名稱；目前保存系統自動安排的使用期間，returned_at 另外保存實際歸還時間，避免覆寫原派車安排。未來預約可在交易中修改或釋放；已開始及已歸還行程不可刪單。

### maintenance_records（弱實體：保養紀錄）

| 欄位 | 型別 | 限制 | 中文 |
|---|---|---|---|
| vehicle_id | bigint | 複合 PK、FK vehicles、RESTRICT | 車輛編號 |
| maintenance_date | date | 複合 PK、NOT NULL | 保養日期（部分鍵） |
| maintenance_item | varchar(250) | NOT NULL | 保養項目 |
| maintenance_cost | numeric(12,2) | NOT NULL、>=0 | 保養費用 |

### refueling_records（弱實體：加油紀錄）

| 欄位 | 型別 | 限制 | 中文 |
|---|---|---|---|
| vehicle_id | bigint | 複合 PK、FK vehicles、RESTRICT | 車輛編號 |
| refueling_date | date | 複合 PK、NOT NULL | 加油日期（部分鍵） |
| fuel_liters | numeric(9,3) | NOT NULL、>0 | 公升數 |
| fuel_cost | numeric(12,2) | NOT NULL、>=0 | 金額 |

### schema_migrations

| 欄位 | 型別 | 限制 |
|---|---|---|
| version | integer | PK |
| applied_at | timestamptz | NOT NULL、default now() |

## 索引與交易

外鍵查詢索引：員工部門、申請員工、申請狀態、車輛派車起迄、加油車輛。PK／UNIQUE 自動建立索引。

員工新申請先鎖定員工，檢查自己的重疊行程，再依車輛編號取鎖並重查空檔。在同一交易建立 approved 申請與派車，不使用 schema 的 pending 預設值。相同員工或車輛的併發請求等待鎖後重新查詢，避免重複預約。修改先鎖員工、既有申請及派車，再重新選車；失敗 rollback，原預約不變。刪單刪除未來派車再刪申請；取消刪除未來派車、申請標 cancelled；已開始及已歸還行程受保護。

保養與加油均以 (vehicle_id, date) 複合 PK 保證同車同日各一筆；日期不能單獨識別不同車輛的紀錄。保養寫入先鎖車輛，兩者的併發同鍵寫入由 PostgreSQL 唯一限制拒絕，API 回傳 409。同一天不同車、同車不同天都允許；不存在額外保養序號或加油編號。

跨列的派車衝突、核准狀態在 API 交易內維護；資料庫有 FK、UNIQUE 和 CHECK，但沒有 exclusion constraint／trigger 防止直接 SQL 繞過業務規則。營運資料應由 API 寫入。使用共享課程帳號時，其他直接 SQL 使用者仍有修改資料的能力。

## 正式執行環境

GPT Sites Worker 使用 Postgres.js TCP 驅動直接連線；Python 參考版使用 psycopg。兩者使用同一 fleetflow schema、SQL 統計及交易規則。正式 Worker 不在每次請求初始化 schema，部署前用 Python migrate 建置。資料庫建置不需網站使用者登入。

## 登入支援表

| 表 | 欄位／限制 |
|---|---|
| auth_sessions | session_hash varchar(64) PK、employee_id FK CASCADE、csrf_token varchar(64)、expires_at timestamptz、created_at timestamptz default now() |
| auth_login_limits | bucket varchar(80) PK、attempts integer >=0 default 0、window_start timestamptz default now() |

session_hash 保存隨機 token 摘要，員工 password 本身不做雜湊。索引為 sessions_employee／sessions_expiry。登入錯誤計數交易後保留；15 分鐘重置窗口，員工 5 次／來源 30 次錯誤限流。登入工作階段最長 8 小時，登出／重設撤銷。

共享預約是既有派車、申請、員工、車輛 JOIN 結果，不增加資料表。可借判定及送出均使用 [起,迄) 重疊邏輯；送出在鎖定車輛後重新驗證，不依賴前端查詢結果。

工號：`employees.employee_code` 為 UNIQUE 字串，格式 `EMP0001` 起，從 employee_id 產生（超過四碼不截斷）。登入只接受 employee_code＋password；數字流水號不能登入。employee_id 仍是內部 PK／FK，保留既有申請與派車關聯。工號不加 PK 底線。

Migration 006 新增 employee_code 產生欄位及 UNIQUE 索引，既有 employee_id、password 與所有外鍵資料不改動；可重複執行。
