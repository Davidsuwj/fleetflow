"""Add historical demonstration costs without replacing existing records."""
from datetime import date, timedelta
from backend.db import connection


def seed():
    inserted = {'maintenance': 0, 'refueling': 0}
    with connection() as conn:
        cars = conn.execute(
            "SELECT vehicle_id, license_plate FROM vehicles WHERE license_plate IN "
            "('DEMO-101','DEMO-102','DEMO-103','DEMO-104') ORDER BY license_plate"
        ).fetchall()
        for index, car in enumerate(cars):
            for day, item, cost in [
                (date(2026, 7, 10), '示範：定期保養', 18000),
                (date(2026, 9, 10), '示範：輪胎與煞車檢查', 6500),
            ]:
                result = conn.execute(
                    'INSERT INTO maintenance_records(vehicle_id, maintenance_date, maintenance_item, maintenance_cost) '
                    'VALUES (%s,%s,%s,%s) ON CONFLICT (vehicle_id,maintenance_date) DO NOTHING RETURNING vehicle_id',
                    (car['vehicle_id'], day + timedelta(days=index), item, cost + index * 500),
                ).fetchone()
                inserted['maintenance'] += bool(result)
            for index_day, liters in [(5, 65), (15, 72), (25, 60)]:
                amount = liters + index
                result = conn.execute(
                    'INSERT INTO refueling_records(vehicle_id, refueling_date, fuel_liters, fuel_cost) '
                    'VALUES (%s,%s,%s,%s) ON CONFLICT (vehicle_id,refueling_date) DO NOTHING RETURNING vehicle_id',
                    (car['vehicle_id'], date(2026, 9, index_day) + timedelta(days=index), amount, amount * 31),
                ).fetchone()
                inserted['refueling'] += bool(result)
    return inserted


if __name__ == '__main__':
    print(seed())
