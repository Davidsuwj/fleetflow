# 存取與資料規格

## 員工登入

此為課程 demo，不適用真實帳號；正式使用前須強化密碼驗證及資料庫傳輸保護。沒有另外 accounts 表。員工建立／重設工具在本機執行，初始密碼檔在被忽略的 .local，不提交公開 GitHub。未設定密碼者不可登入。

一般員工、個人 context、登入及共享預約 API 都明確選取欄位，永不輸出 password。登入成功產生隨機 256-bit token；資料庫 auth_sessions 僅保存 token 的 SHA-256 摘要、employee_id、csrf_token、expires_at、created_at。session 最長 8 小時。

Cookie 為 HttpOnly、SameSite=Strict、Path=/，HTTPS 加 Secure。本機 HTTP 預覽不加 Secure。登出撤銷 session；公司透過重設工具更新密碼會撤銷該員工所有 session。敏感狀態不放 localStorage，頁面與 API no-store，登出清除個人內容。

伺服器從 session 判定員工。query／body employee_id 不能切換身分；修改、取消、刪除、歸還再次檢查單據所屬。寫入需 session 綁定 CSRF token，Worker 拒絕不同來源 Origin。登入同員工每 15 分鐘錯 5 次／同來源錯 30 次限流，錯誤員工與密碼使用相同訊息。

## 共享範圍

車輛預約共享所有員工的車牌、姓名、用途與起迄，符合共同查空車需求。私人申請／行程操作、個人電話及統計仍限本人；不共享密碼。未登入無法取得車輛或預約資料。

Site 依需求設為 Public，登入頁可由取得連結者開啟。員工資料 API 仍驗證員工編號登入 session。正式 Worker 不公開名冊管理、人工審核／派車或費用寫入。Python 參考版的內部基礎 CRUD 維持 SERVICE_API_KEY／loopback 保護；個人路由改用同樣 session 驗證。

## 完整性

SQL 參數化、PK／FK／UNIQUE／CHECK、日期複合主鍵。聯絡電話不是 PK；保養 PK (vehicle_id,maintenance_date)，加油 PK (vehicle_id,refueling_date)。同車或同員工預約重疊在交易中鎖定及重查，併發亦拒絕。

資料庫 schema fleetflow，DB_PASSWORD 放 Site 秘密值與本機忽略的 .env。瀏覽器 HTTPS 與資料庫連線保護應分別驗證。請求不記錄密碼、Cookie 或 CSRF 值；錯誤不回傳 SQL／連線資訊。營運資料應透過 API 操作，部署採最小權限管理。

員工識別統一使用 `employees.employee_id`（數字員工編號），同時作為登入帳號與既有 PK／FK；不另設工號欄位。密碼、員工編號與既有申請／派車關聯維持不變。舊 `EMP0001` 格式及登入 JSON 的 `employee_code` 欄位僅為相容輸入，伺服器轉成同一個 employee_id，不另外儲存或回傳 employee_code。ERD／關聯綱目中員工只有 employee_id 為主鍵並加底線。

數字員工編號與舊格式相容輸入先正規化，再使用同一員工身分進行驗證及限流，不能以替換輸入格式切換身分或繞過限流。
