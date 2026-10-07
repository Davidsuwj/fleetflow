# 存取與資料規格

## 員工登入

依使用者 demo 作業要求，密碼是 employees.password 一般明碼欄位，不做密碼雜湊。沒有另外 accounts 表。員工建立／重設工具在本機執行，初始密碼檔在被忽略的 .local，不提交公開 GitHub。未設定密碼者不可登入。

一般員工、個人 context、登入及共享預約 API 都明確選取欄位，永不輸出 password。登入成功產生隨機 256-bit token；資料庫 auth_sessions 僅保存 token 的 SHA-256 摘要（不是密碼雜湊）、employee_id、csrf_token、expires_at、created_at。session 最長 8 小時。

Cookie 為 HttpOnly、SameSite=Strict、Path=/，HTTPS 加 Secure。本機 HTTP 預覽不加 Secure。登出撤銷 session；公司透過重設工具更新密碼會撤銷該員工所有 session。敏感狀態不放 localStorage，頁面與 API no-store，登出清除個人內容。

伺服器從 session 判定員工。query／body employee_id 不能切換身分；修改、取消、刪除、歸還再次檢查單據所屬。寫入需 session 綁定 CSRF token，Worker 拒絕不同來源 Origin。登入同員工每 15 分鐘錯 5 次／同來源錯 30 次限流，錯誤員工與密碼使用相同訊息。

## 共享範圍

車輛預約共享所有員工的車牌、姓名、用途與起迄，符合共同查空車需求。私人申請／行程操作、個人電話及統計仍限本人；不共享密碼。未登入無法取得車輛或預約資料。

Site 依需求設為 Public，登入頁可由取得連結者開啟。員工資料 API 仍驗證員工工號登入 session。正式 Worker 不公開名冊管理、人工審核／派車或費用寫入。Python 參考版的內部基礎 CRUD 維持 SERVICE_API_KEY／loopback 保護；個人路由改用同樣 session 驗證。

## 完整性

SQL 參數化、PK／FK／UNIQUE／CHECK、日期複合主鍵。聯絡電話不是 PK；保養 PK (vehicle_id,maintenance_date)，加油 PK (vehicle_id,refueling_date)。同車或同員工預約重疊在交易中鎖定及重查，併發亦拒絕。

資料庫 schema fleetflow，DB_PASSWORD 放 Site 秘密值與本機忽略的 .env。資料庫現況連線為非 TLS，網站 HTTPS。請求不記錄密碼、Cookie 或 CSRF 值；錯誤不回傳 SQL／連線資訊。共享課程 DB 的直接 SQL 權限仍可繞過 API 業務規則。

工號：`employees.employee_code` 為 UNIQUE 字串，格式 `EMP0001` 起，從 employee_id 產生（超過四碼不截斷）。登入只接受 employee_code＋password；數字流水號不能登入。employee_id 仍是內部 PK／FK，保留既有申請與派車關聯。工號不加 PK 底線。
