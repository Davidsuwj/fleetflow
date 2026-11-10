# 測試與驗收

```powershell
npm test
npm run check
npm run build
python -m pytest -q
```

本次員工編號整併驗證：隔離本機 PostgreSQL 18.6，`npm test` **39/39 通過**（Site API 23、身分驗證 2、介面 3、Worker 6、折線圖 5）；`python -m pytest -q` **58/58 通過**（包含日期 migration 3 案例）。全新建置與重複執行 migration 通過；OpenAPI 已由實際 FastAPI app 重新產生並比對一致。測試未連線正式資料庫。

JavaScript API、Worker、折線圖與 Python 測試涵蓋登入及資料存取，另包含日期 migration 與員工識別整併 migration 保留資料案例；實際項數以當次測試輸出為準。每次整合測試在獨立 fleetflow_test_<12 hex> schema，結束只刪除自己的 schema。

折線圖與 Worker 可不連資料庫單獨驗證：`node --test tests/monthly-chart.test.mjs tests/worker.test.mjs`。折線圖測試涵蓋六個月份、全零、單一非零、混合與較大筆數、整數刻度及文字 escaping；畫面以可縮放 SVG 線條搭配不隨 SVG 壓縮的月份與筆數文字，並提供螢幕閱讀器等價資訊。

| 範圍 | 驗證 |
|---|---|
| 登入 | 正確／錯誤密碼、未登入拒絕、HttpOnly Cookie、登出撤銷、過期、持續登入 |
| 身分 | session 決定員工，偽造 query／body 403、他人單不能修改或刪除 |
| CSRF | 缺 CSRF 的寫入拒絕、外站 Origin 拒絕 |
| 密碼 | employees.password 欄位；一般 API 與共享預約不回傳密碼 |
| 員工編號 | 數字 employee_id 登入；舊 EMP0001／employee_code 輸入映射到同一員工；合併保留密碼、session 與申請關聯，移除獨立欄位 |
| 限流 | 錯誤登入次數交易後保留、達上限 429 |
| 共享預約 | 本人 context 可讀他人的共享用車，但本人申請與統計不混入他人 |
| 查空車 | 起迄無效 422，占用車不可借；修改只可排除本人本筆預約 |
| 指定車 | 同車時段重疊 409、相鄰可借，另有空車也不可默默替換指定車 |
| 併發 | 同員工衝突、搶唯一車、兩員工指定同一車均只能一筆成功 |
| 交易 | 核准及派車原子性，修改失敗保留原預約，無半套訂單 |
| 刪單／歸還 | 本人未開始可刪改／取消，釋放預約；開始／歸還受保護 |
| 弱實體 | 同車同日保養／加油重複 409，不同車或日期允許，併發同鍵僅一筆成功 |
| Migration | 日期 key 轉換保留紀錄，兩種重複資料 rollback，不丟資料 |
| Worker | 缺設定 fail closed、Cookie header 保留、管理路由不公開 |

ERD 七實體：員工含一般 password，只有員工編號為 PK；電話雙圓，不是 PK；兩種紀錄弱實體雙框、識別關係雙菱形、日期虛線底線。綱目只有 PK 底線，無複合欄位括線。

網站驗收：簡潔登入／登出、無員工切換、五頁員工工作區，申請按鈕只在我的申請、我的申請包含行程狀態與歸還、大家的預約、起迄查空車、指定車申請、錯誤提示、375px 無整頁水平溢出、鍵盤表單可用。API 與畫面不顯示密碼。

未進行長時負載、全面跨瀏覽器或災難復原測試。CI 範本 docs/CI_TEMPLATE.yml 尚未啟用。
介面整合驗證：隔離資料包含未來、使用中及已歸還申請；歸還操作使用 dispatch_id（刻意不同於 application_id），已歸還篩選正確。移除我的行程導覽；申請按鈕僅在我的申請。Chrome 320px／375px 日期欄位各占整列，無頁面橫向溢出，日期時間完整可見；桌面仍同列。未實測 iOS Safari。

車輛紀錄驗收：未選車不顯示紀錄；切換車牌只顯示該車資料；保養／加油可切換；鍵盤 Enter 可選車；登出清除紀錄與選擇。模擬資料匯入可重複執行，不重複建立既有紀錄。

## DEV 管理與車輛封存驗證

`npm run test:unit` 包含 DEV 獨立 session／CSRF、車牌正規化及重複、空車隊新增、伺服器產生 ID、封存保留歷史、復原、未歸還預約阻擋、重複送出與失敗表單保留。這些為隔離 SQL contract fake 與前端 VM 測試，不連正式資料庫。

`tests/site-api.test.mjs` 的 DEV 整合案例使用隨機 fleetflow_test_<12 hex> schema，驗證實際 PostgreSQL 新增、唯一性、封存／復原及外鍵關聯不變。執行需可連線的測試用 DB 環境設定；沒有設定時不得將單元測試結果當成資料庫整合通過。
