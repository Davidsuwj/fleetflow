from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Annotated
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

class Input(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

class Department(Input):
    department_name: str = Field(min_length=1, max_length=80)

class Employee(Input):
    department_id: int = Field(gt=0)
    employee_name: str = Field(min_length=1, max_length=80)
    phone_numbers: list[str] = Field(default_factory=list, max_length=10)
    password: Annotated[str, StringConstraints(strip_whitespace=False)] | None = Field(default=None,min_length=8,max_length=128)
    @field_validator('phone_numbers')
    @classmethod
    def valid_phones(cls, values):
        if any(not v.strip() or len(v.strip()) > 30 for v in values):
            raise ValueError('電話不可為空白或超過 30 字元')
        return sorted(set(v.strip() for v in values))

class Vehicle(Input):
    license_plate: str = Field(min_length=1, max_length=20)
    vehicle_model: Literal['Rolls-Royce Cullinan 6.75 V12'] = 'Rolls-Royce Cullinan 6.75 V12'
    vehicle_status: Literal['available','maintenance','retired'] = 'available'
    @field_validator('license_plate')
    @classmethod
    def plate(cls, value):
        return value.upper()

class Period(Input):
    @model_validator(mode='after')
    def valid_period(self):
        dates = [v for v in self.__dict__.values() if isinstance(v, datetime)]
        if any(d.tzinfo is None or d.utcoffset() is None for d in dates):
            raise ValueError('時間必須包含時區')
        if len(dates) == 2 and dates[1] <= dates[0]:
            raise ValueError('迄日必須晚於起日')
        return self

class Application(Period):
    employee_id: int = Field(gt=0)
    purpose: str = Field(min_length=1, max_length=500)
    requested_start_date: datetime
    requested_end_date: datetime

class EmployeeApplication(Application):
    vehicle_id: int | None = Field(default=None,gt=0)

class AvailabilityPeriod(Period):
    requested_start_date: datetime
    requested_end_date: datetime

class Review(Input):
    approval_status: Literal['approved','rejected']

class Dispatch(Period):
    application_id: int = Field(gt=0)
    vehicle_id: int = Field(gt=0)
    actual_start_date: datetime
    actual_end_date: datetime

class Maintenance(Input):
    vehicle_id: int = Field(gt=0)
    maintenance_date: date
    maintenance_item: str = Field(min_length=1, max_length=250)
    maintenance_cost: Decimal = Field(ge=0, max_digits=12, decimal_places=2)

class Refueling(Input):
    vehicle_id: int = Field(gt=0)
    refueling_date: date
    fuel_liters: Decimal = Field(gt=0, max_digits=9, decimal_places=3)
    fuel_cost: Decimal = Field(ge=0, max_digits=12, decimal_places=2)

