export const queries={
  "employees": [
    "SELECT e.employee_id,e.employee_code,e.employee_name,e.department_id,d.department_name,\n            COALESCE((SELECT array_agg(p.phone_number ORDER BY p.phone_number) FROM employee_phones p\n                      WHERE p.employee_id=e.employee_id), ARRAY[]::varchar[]) AS phone_numbers\n            FROM employees e JOIN departments d USING(department_id)\n            ORDER BY e.employee_id"
  ],
  "vehicles": [
    "SELECT v.*, EXISTS(SELECT 1 FROM dispatches d WHERE d.vehicle_id=v.vehicle_id\n            AND d.returned_at IS NULL AND now() >= d.actual_start_date AND now() < d.actual_end_date) AS in_use\n            FROM vehicles v ORDER BY vehicle_id"
  ],
  "applications_base": "SELECT a.*,e.employee_name,d.department_name,ds.dispatch_id,ds.vehicle_id,v.license_plate,\n    ds.returned_at,ds.actual_start_date AS dispatch_start_date,ds.actual_end_date AS dispatch_end_date FROM applications a JOIN employees e USING(employee_id)\n    JOIN departments d ON d.department_id=e.department_id\n    LEFT JOIN dispatches ds USING(application_id) LEFT JOIN vehicles v ON v.vehicle_id=ds.vehicle_id",
  "dispatches_base": "SELECT ds.*,v.license_plate,v.vehicle_model,a.purpose,e.employee_name,a.employee_id\n    FROM dispatches ds JOIN vehicles v USING(vehicle_id) JOIN applications a USING(application_id)\n    JOIN employees e USING(employee_id)",
  "maintenance": [
    "SELECT m.*,v.license_plate FROM maintenance_records m JOIN vehicles v USING(vehicle_id) ORDER BY maintenance_date DESC, m.vehicle_id"
  ],
  "refueling": [
    "SELECT r.*,v.license_plate FROM refueling_records r JOIN vehicles v USING(vehicle_id) ORDER BY refueling_date DESC,r.vehicle_id"
  ],
  "dashboard": [
    "SELECT count(*) AS n FROM vehicles WHERE vehicle_status<>'retired'",
    "SELECT count(*) FILTER(WHERE approval_status='pending') AS pending,\n            count(*) FILTER(WHERE approval_status='approved') AS approved FROM applications",
    "SELECT count(*) AS n FROM dispatches ds JOIN applications a USING(application_id)\n            WHERE ds.returned_at IS NULL",
    "SELECT\n            COALESCE((SELECT sum(maintenance_cost) FROM maintenance_records WHERE date_trunc('month',maintenance_date)=date_trunc('month',CURRENT_DATE)),0)\n            + COALESCE((SELECT sum(fuel_cost) FROM refueling_records WHERE date_trunc('month',refueling_date)=date_trunc('month',CURRENT_DATE)),0) AS cost"
  ],
  "statistics": [
    "SELECT approval_status,count(*) AS count FROM applications GROUP BY approval_status ORDER BY approval_status",
    "SELECT d.department_name,count(a.application_id) AS applications,\n            count(ds.dispatch_id) AS dispatches FROM departments d\n            LEFT JOIN employees e USING(department_id) LEFT JOIN applications a USING(employee_id)\n            LEFT JOIN dispatches ds USING(application_id) GROUP BY d.department_id,d.department_name\n            ORDER BY applications DESC,d.department_name",
    "WITH months AS (\n            SELECT generate_series(date_trunc('month',CURRENT_DATE)-interval '5 months',\n                                   date_trunc('month',CURRENT_DATE),interval '1 month')::date AS month\n        ), maintenance AS (\n            SELECT date_trunc('month',maintenance_date)::date AS month,sum(maintenance_cost) AS cost\n            FROM maintenance_records GROUP BY 1\n        ), fuel AS (\n            SELECT date_trunc('month',refueling_date)::date AS month,sum(fuel_cost) AS cost\n            FROM refueling_records GROUP BY 1\n        ) SELECT to_char(m.month,'YYYY-MM') AS month,COALESCE(a.cost,0) AS maintenance_cost,\n            COALESCE(f.cost,0) AS fuel_cost,COALESCE(a.cost,0)+COALESCE(f.cost,0) AS total\n            FROM months m LEFT JOIN maintenance a USING(month) LEFT JOIN fuel f USING(month) ORDER BY m.month",
    "SELECT (SELECT count(*) FROM applications) AS applications,\n            (SELECT count(*) FROM dispatches) AS dispatches,\n            (SELECT count(*) FROM dispatches WHERE returned_at IS NOT NULL) AS returned,\n            (SELECT COALESCE(sum(maintenance_cost),0) FROM maintenance_records)\n            + (SELECT COALESCE(sum(fuel_cost),0) FROM refueling_records) AS lifetime_cost"
  ]
};
