# 公司公務車借用系統關聯綱目（依原始 ERD）

![依指定 ERD 的關聯綱目](relational-schema.png)

[SVG 原圖](relational-schema.svg) · [原始 ERD](erd.svg) · [實作資料庫規格](DATABASE_SPEC.md)

本圖依使用者提供的 Chen ERD 呈現七個實體與原有屬性，只加入關係映射所需外鍵。只有主鍵（PK）加底線；一般外鍵（FK）不加底線，保留 FK 標籤與指向參照 PK 的箭頭。保養及加油皆為弱實體，分別以車輛編號加保養日期、車輛編號加加油日期組成複合主鍵；日期為部分鍵，兩個 PK 欄位分別加底線，欄位下方不畫連接括線；車輛編號兼任 FK，因同時是 PK 而加底線。

以下 **粗體**為主鍵。聯絡電話 phone_number 不是主鍵；圖中以「多值」標示雙圓屬性。

| 實體 | ERD 對應綱目 | 外鍵 |
|---|---|---|
| 部門 | (**department_id**, department_name) | — |
| 員工 | (**employee_id**, employee_name, phone_number［多值］, password, employee_code, department_id) | department_id → 部門.department_id |
| 車輛 | (**vehicle_id**, license_plate, vehicle_model) | — |
| 借用申請 | (**application_id**, purpose, requested_start_date, requested_end_date, approval_status, employee_id) | employee_id → 員工.employee_id |
| 派車紀錄 | (**dispatch_id**, actual_start_date, actual_end_date, application_id, vehicle_id) | application_id → 借用申請.application_id，UNIQUE；vehicle_id → 車輛.vehicle_id |
| 保養紀錄 | (**vehicle_id**, **maintenance_date**, maintenance_item, maintenance_cost) | vehicle_id → 車輛.vehicle_id |
| 加油紀錄 | (**vehicle_id**, **refueling_date**, fuel_liters, fuel_cost) | vehicle_id → 車輛.vehicle_id |

部門－員工、員工－借用申請、車輛－派車／保養／加油依 ERD 為 1:N；申請－派車為 1:1 關係，派車完全參與，申請可尚未派車，實作 UNIQUE FK 表示一個申請最多一筆派車。員工與車輛的跨期間 M:N 由申請與派車串接。

本圖保留 ERD 的多值電話表示，因此電話不是單一純量欄位的第一正規化實體表。實際 SQL 為支援多筆電話，另使用 employee_phones 輔助表，phone_id 為該輔助表代理鍵，phone_number 為一般欄位；這是實作轉換，未將額外電話編號畫入原 ERD 綱目。詳見 DATABASE_SPEC。

主圖也不加入實作操作欄位 vehicle_status、created_at、returned_at 或 schema_migrations。員工新增 password 一般屬性（明碼），仍以 employee_id 為 PK；登入以工號及密碼驗證，不增加 accounts 或駕駛授權實體。auth_sessions／auth_login_limits 為實作支援表，不列入主圖。繪圖來源 scripts/render-relational-schema.py。

工號：`employees.employee_code` 為 UNIQUE 字串，格式 `EMP0001` 起，從 employee_id 產生（超過四碼不截斷）。登入只接受 employee_code＋password；數字流水號不能登入。employee_id 仍是內部 PK／FK，保留既有申請與派車關聯。工號不加 PK 底線。
