/* Shared pure validation for the DEV record form and CSV preview. */
(function(root){
'use strict';
const headers={maintenance:['vehicle_id','maintenance_date','maintenance_item','maintenance_cost'],refueling:['vehicle_id','refueling_date','fuel_liters','fuel_cost']};
function validateRecord(type,input,vehicles){
 if(!headers[type])throw Error('請選擇紀錄類型。');
 const out={};for(const key of headers[type]){const value=String(input[key]??'').trim();if(!value)throw Error(`${key} 為必填。`);out[key]=value;}
 if(!/^\d+$/.test(out.vehicle_id)||!vehicles.some(v=>String(v.vehicle_id)===String(Number(out.vehicle_id))))throw Error('vehicle_id 必須是現有車輛編號。');out.vehicle_id=Number(out.vehicle_id);
 const key=type==='maintenance'?'maintenance_date':'refueling_date',d=out[key];if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw Error(`${key} 必須是有效日期 YYYY-MM-DD。`);
 if(type==='maintenance'&&out.maintenance_item.length>250)throw Error('保養項目最多 250 字。');
 for(const key of type==='maintenance'?['maintenance_cost']:['fuel_liters','fuel_cost']){const places=key==='fuel_liters'?3:2,max=key==='fuel_liters'?999999.999:9999999999.99;if(!new RegExp(`^\\d+(?:\\.\\d{1,${places}})?$`).test(out[key])||Number(out[key])>max||(key==='fuel_liters'&&Number(out[key])<=0))throw Error(`${key} 請輸入有效${key==='fuel_liters'?'正':''}數值，最多 ${places} 位小數。`);out[key]=Number(out[key]);}
 return out;
}
function parseCSV(text,type,vehicles){
 if(new TextEncoder().encode(text).length>32768)throw Error('CSV 不可超過 32 KB。');text=text.replace(/^\uFEFF/,'');
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
 if(c==='"'){if(cell||closed)throw Error('CSV 引號格式錯誤。');quoted=true;}
 else if(c===','){row.push(cell);cell='';closed=false;}
 else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';closed=false;}
 else{if(closed)throw Error('CSV 引號後只能接逗號或換行。');cell+=c;}}
 if(quoted)throw Error('CSV 引號未關閉。');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 const head=rows.shift()?.map(v=>v.trim()),expected=headers[type];if(!head||!expected||head.length!==expected.length||new Set(head).size!==head.length||!expected.every(v=>head.includes(v)))throw Error('CSV 欄位不符，請下載對應範本。');
 if(!rows.length||rows.length>100)throw Error('CSV 必須包含 1 至 100 筆紀錄。');
 return rows.map((r,i)=>{try{if(r.length!==head.length)throw Error('欄位數量不符。');return validateRecord(type,Object.fromEntries(head.map((h,j)=>[h,r[j]])),vehicles);}catch(e){throw Error(`第 ${i+1} 筆：${e.message}`);}});
}
root.FleetDev={headers,validateRecord,parseCSV};
})(globalThis);
