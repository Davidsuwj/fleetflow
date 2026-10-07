"""Render the domain relational schema as a repo-native, editable SVG."""
from pathlib import Path
from html import escape

# These are the seven entities and attributes from the user-supplied Chen ERD.
# Only relationship FKs are added; implementation-only attributes are excluded.
tables = [
    ('departments','部門',0,0,[('department_id','部門編號','PK'),('department_name','部門名稱','')]),
    ('employees','員工',0,0,[('employee_id','員工編號','PK'),('employee_name','姓名',''),('phone_number','聯絡電話','多值'),('password','密碼',''),('employee_code','工號','UQ'),('department_id','部門編號','FK')]),
    ('vehicles','車輛',0,0,[('vehicle_id','車輛編號','PK'),('license_plate','車牌號碼',''),('vehicle_model','車型','')]),
    ('applications','借用申請',0,0,[('application_id','申請編號','PK'),('purpose','借用用途',''),('requested_start_date','預計起日',''),('requested_end_date','預計迄日',''),('approval_status','審核狀態',''),('employee_id','員工編號','FK')]),
    ('dispatches','派車紀錄',0,0,[('dispatch_id','派車編號','PK'),('actual_start_date','使用起日',''),('actual_end_date','使用迄日',''),('application_id','申請編號','FK UQ'),('vehicle_id','車輛編號','FK')]),
    ('maintenance_records','保養紀錄',0,0,[('vehicle_id','車輛編號','PK FK'),('maintenance_date','保養日期','PK'),('maintenance_item','保養項目',''),('maintenance_cost','保養費用','')]),
    ('refueling_records','加油紀錄',0,0,[('vehicle_id','車輛編號','PK FK'),('refueling_date','加油日期','PK'),('fuel_liters','公升數',''),('fuel_cost','金額','')]),
]

def label(x,y,value,size=20,fill='#202020',**attrs):
    extra=' '.join(f'{k.replace("_","-")}="{escape(str(v))}"' for k,v in attrs.items() if v is not None)
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{fill}" {extra}>{escape(value)}</text>'

by_name={name:(chinese,fields) for name,chinese,_,_,fields in tables}
order=['departments','employees','vehicles','applications','dispatches','maintenance_records','refueling_records']
svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1940" height="1580" viewBox="0 0 1940 1580" role="img" aria-labelledby="title desc">',
     '<title id="title">公司公務車借用系統資料表關聯圖</title>',
     '<desc id="desc">橫列關聯綱目，僅主鍵加底線，外鍵箭頭指向參照主鍵，複合主鍵的各個欄位分別加底線。</desc>',
     '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10" fill="#393939"/></marker></defs>',
     '<rect width="1940" height="1580" fill="white"/>',
     '<g font-family="Microsoft JhengHei, Noto Sans CJK TC, Arial, sans-serif">',
     label(55,52,'公司公務車借用系統・資料表關聯圖',32,font_weight=700),
     label(55,91,'僅主鍵（PK）加底線；外鍵（FK）以箭頭指向參照主鍵；複合主鍵各欄位分別加底線。',20,fill='#646464')]

# Child FK routes join a bus only when they reference the same parent PK.
# No route crosses a table or an unrelated relationship.
paths=[
    ('M1570 340V295H330V260H470V232',True),
    ('M1570 720V675H300V445H470V422',True),
    ('M1130 910V865H280V825H470V802',True),
    ('M1740 1410V495H470V530',True),
    ('M1350 992V1025H1740',False),
    ('M470 1100V1060H1740',False),
    ('M470 1372V1410H1740',False),
]
for path,arrow in paths:
    marker=' marker-end="url(#arrow)"' if arrow else ''
    svg.append(f'<path d="{path}" fill="none" stroke="#535353" stroke-width="1.6" stroke-linejoin="round"{marker}/>')

for row,name in enumerate(order):
    chinese,fields=by_name[name];y=150+row*190
    if name=='maintenance_records':chinese='保養紀錄'
    if name=='employee_phones':chinese='員工聯絡電話'
    svg.append(label(110,y+30,chinese,23,text_anchor='middle',font_weight=700))
    svg.append(label(110,y+61,name,16,fill='#32966c',text_anchor='middle'))
    for col,(field,chinese,tags) in enumerate(fields):
        x=360+col*220
        if name=='vehicles' and field=='vehicle_model':chinese='車型'
        if field=='returned_at':chinese='歸還時間'
        svg.append(f'<rect x="{x}" y="{y}" width="220" height="82" fill="white" stroke="#333333" stroke-width="1.6"/>')
        svg.append(label(x+110,y+28,chinese,19,fill='#32966c',text_anchor='middle'))
        svg.append(label(x+110,y+52,field,17,font_family='Arial, sans-serif',textLength=190 if len(field)>18 else None,text_anchor='middle',text_decoration='underline' if 'PK' in tags else 'none'))
        if tags:svg.append(label(x+110,y+73,tags.replace(' ', ', '),11,fill='#7a7a7a',text_anchor='middle'))
svg += [label(55,1470,'複合主鍵：保養 (vehicle_id, maintenance_date)；加油 (vehicle_id, refueling_date)。日期為各弱實體的部分鍵。',20),
        label(55,1508,'dispatches.application_id 為 UNIQUE：每筆申請最多一筆派車；員工與車輛的 M:N 經申請、派車連結。',20),
        label(55,1546,'聯絡電話為 ERD 的多值屬性，不是主鍵；本圖保留 ERD 原屬性，正規化電話儲存方式另見資料庫規格。',19,fill='#646464'),
        '</g></svg>']
Path('docs/relational-schema.svg').write_text('\n'.join(svg),encoding='utf-8')
print('Created horizontal docs/relational-schema.svg')
