# API 規格

正式 API 由 GPT Sites JavaScript Worker 直接連線 PostgreSQL，前端同來源 /api/*。Python 對照 API 見 [OpenAPI](openapi.json)，另有僅供本機建置的基礎 CRUD 路由，正式 Worker 不公開那些路由。

## 正式路由

| 方法 | 路徑 | 功能 |
|---|---|---|
| POST | /api/auth/login | employee_code＋password，設定登入 Cookie、回傳員工姓名／工號與 csrf_token |
| GET | /api/auth/session | 取得目前員工與 csrf_token |
| POST | /api/auth/logout | 撤銷目前 session、清 Cookie |
| GET | /api/employee-context | 本人資料、applications、dispatches、statistics；共享 vehicles、maintenance、refueling、team_bookings |
| GET | /api/my-applications | 本人申請 |
| POST | /api/my-applications | 自動核准並派車，201 |
| PUT | /api/my-applications/{id} | 修改本人未開始的申請 |
| DELETE | /api/my-applications/{id} | 刪單並釋放未開始的派車 |
| POST | /api/my-applications/{id}/cancel | 取消、釋放預約 |
| GET | /api/my-dispatches | 本人行程 |
| POST | /api/my-dispatches/{id}/return | 登記歸還 |
| GET | /api/availability?start={ISO}&end={ISO} | 時段可借車輛及重疊預約 |
| GET | /api/vehicles | 唯讀車輛，需登入 |
| GET | /api/health | 資料庫狀態，需登入 |

除了 login，正式資料路由皆需有效 session。employee-options 已移除。員工身分從 Cookie 對應的 server session 取得；相容舊 query employee_id 時須與登入員工一致，否則 403，不能以 query 切換身分。

POST／PUT／DELETE 需 X-CSRF-Token；外站 Origin 403。Cookie 為 HttpOnly、SameSite=Strict、HTTPS Secure，最多 8 小時。login 不回傳 Cookie token 到 JSON；也不回傳 password。

## 請求

登入 JSON 為 employee_code（EMP 加至少四位數，例如 EMP0001）、password（1–128 字元）。數字 employee_id 不接受為登入帳號。一般查詢永不回傳 password；明碼僅存 employees.password。錯誤工號／密碼一律 401，同工號 15 分鐘錯 5 次、同來源錯 30 次後回傳 429。

申請 POST／PUT：employee_id、purpose、requested_start_date、requested_end_date；可選 vehicle_id 指定車，省略代表自動安排。body employee_id 必須等於 session。purpose 最多 500 字，時間需有效時區、起日在未來、迄日晚於起日。成功回傳 approved 申請、dispatch_id、license_plate、auto_approved=true；指定車已占用時 409。

availability 回傳 vehicles(vehicle_id,license_plate,vehicle_model,vehicle_status,available_in_period)、bookings(dispatch_id,vehicle_id,license_plate,employee_name,purpose,actual_start_date,actual_end_date)。可加 exclude={application_id}，僅能排除自己的本筆單以便修改；別人的單 403。

team_bookings 為大家尚未歸還且安排迄日晚於現在的預約，僅含車牌、姓名、用途、起迄與單號。個人 applications／dispatches／statistics 與電話只含自己。

maintenance 含 vehicle_id、maintenance_date、maintenance_item、maintenance_cost、license_plate；refueling 含 vehicle_id、refueling_date、fuel_liters、fuel_cost、license_plate。日期為 YYYY-MM-DD，兩表以車輛＋日期 PK，沒有獨立序號／編號。Python 參考版寫入同車同日重複 409。

## 交易與錯誤

| 狀態 | 情況 |
|---|---|
| 401 | 未登入、錯誤密碼、session 過期／撤銷 |
| 403 | 他人單據、冒用 employee_id、外站 Origin、CSRF 不符 |
| 404 | 不存在資源或正式 Worker 不提供的管理路由 |
| 405 | 不支援的方法 |
| 409 | 重疊、無車、指定車不可借、開始／歸還保護、同車同日重複 |
| 413 | 超過 32KiB |
| 422 | 缺欄位、未知欄位、ID／日期／起迄無效 |
| 429 | 登入錯誤限流 |
| 503 | 資料庫設定或連線問題 |

所有業務值均使用參數化 SQL。查詢在 repeatable-read 唯讀交易；預約先鎖員工再鎖車輛，重查後同交易建立／修改申請及派車。取消及刪單僅處理本人未開始預約。失敗整筆 rollback，不回傳 SQL 或秘密。

工號：`employees.employee_code` 為 UNIQUE 字串，格式 `EMP0001` 起，從 employee_id 產生（超過四碼不截斷）。登入只接受 employee_code＋password；數字流水號不能登入。employee_id 仍是內部 PK／FK，保留既有申請與派車關聯。工號不加 PK 底線。
