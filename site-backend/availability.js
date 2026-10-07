export const teamBookingsSQL=`SELECT ds.dispatch_id,ds.application_id,ds.vehicle_id,v.license_plate,e.employee_name,
  a.purpose,ds.actual_start_date,ds.actual_end_date,ds.returned_at
  FROM dispatches ds JOIN applications a USING(application_id) JOIN employees e USING(employee_id) JOIN vehicles v USING(vehicle_id)
  WHERE ds.returned_at IS NULL AND ds.actual_end_date>now() ORDER BY ds.actual_start_date,ds.vehicle_id`;
export async function availability(sql,start,end,except=0){
  const vehicles=await sql.unsafe(`SELECT v.vehicle_id,v.license_plate,v.vehicle_model,v.vehicle_status,
    (v.vehicle_status='available' AND NOT EXISTS(SELECT 1 FROM dispatches ds WHERE ds.vehicle_id=v.vehicle_id
     AND ds.application_id<>$3 AND ds.actual_start_date<$2 AND COALESCE(LEAST(ds.actual_end_date,ds.returned_at),ds.actual_end_date)>$1)) AS available_in_period
    FROM vehicles v WHERE vehicle_status<>'retired' ORDER BY vehicle_id`,[start,end,except]);
  const bookings=await sql.unsafe(`SELECT ds.dispatch_id,ds.vehicle_id,v.license_plate,e.employee_name,a.purpose,ds.actual_start_date,ds.actual_end_date
    FROM dispatches ds JOIN applications a USING(application_id) JOIN employees e USING(employee_id) JOIN vehicles v USING(vehicle_id)
    WHERE ds.application_id<>$3 AND ds.actual_start_date<$2 AND COALESCE(LEAST(ds.actual_end_date,ds.returned_at),ds.actual_end_date)>$1 ORDER BY ds.actual_start_date,ds.vehicle_id`,[start,end,except]);
  return {vehicles,bookings};
}
