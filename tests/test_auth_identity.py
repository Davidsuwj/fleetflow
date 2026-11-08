"""DB-free input compatibility tests for the canonical employee identifier."""
import pytest
from pydantic import ValidationError
from backend.auth import Login,normalize_employee_id

@pytest.mark.parametrize('value',[1,'1','0001','EMP0001'])
def test_normalized_id(value):
    assert normalize_employee_id(value)==1
    for key in ['employee_id','employee_code']:
        assert Login.model_validate({key:value,'password':'test'}).employee_id==1

@pytest.mark.parametrize('value',[None,True,False,{},[],0,-1,1.5,'',' 1','1 ','1e2','+1','EMP1','emp0001','EMP0000','9007199254740992',9007199254740992])
def test_invalid_ids(value):
    with pytest.raises(ValueError):
        normalize_employee_id(value)

@pytest.mark.parametrize('body',[{}, {'employee_id':1,'employee_code':'EMP0001','password':'test'}, {'employee_id':None,'employee_code':'EMP0001','password':'test'}, {'employee_id':1,'password':''}, {'employee_id':1,'password':'x'*129}, {'employee_id':1,'password':'test','extra':True}])
def test_invalid_login(body):
    with pytest.raises(ValidationError):
        Login.model_validate(body)
