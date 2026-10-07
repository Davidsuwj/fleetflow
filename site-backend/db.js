import postgres from 'postgres';

export function openDatabase(env, schema='fleetflow') {
  if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error('Invalid schema');
  if (!env.DB_HOST || !env.DB_NAME || !env.DB_USER || !env.DB_PASSWORD) throw new Error('Database configuration missing');
  return postgres({host:env.DB_HOST,port:Number(env.DB_PORT||5432),database:env.DB_NAME,
    username:env.DB_USER,password:env.DB_PASSWORD,ssl:env.DB_SSLMODE==='require'?'require':false,
    max:1,connect_timeout:8,idle_timeout:1,max_lifetime:60,prepare:false,
    connection:{search_path:schema,TimeZone:'Asia/Taipei',statement_timeout:'12000',application_name:'FleetFlow GPT Site'},
    types:{safeInteger:{to:20,from:[20],serialize:String,parse:value=>{
      const number=Number(value);if(!Number.isSafeInteger(number))throw new Error('ID outside safe range');return number;
    }},calendarDate:{to:1082,from:[1082],serialize:String,parse:value=>value}},onnotice:()=>{}});
}
