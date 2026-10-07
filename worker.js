import {handleApi} from './site-backend/api.js';
// Frontend and API both run on GPT Sites. Owner-private access is enforced by the platform.
export function createWorker(assets, apiHandler=handleApi) {
  return {async fetch(request, env) {
    const url=new URL(request.url);
    const common={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Cache-Control':'no-store'};
    if(url.pathname.startsWith('/api/')) {
      if(!['GET','POST','PUT','DELETE'].includes(request.method)) return Response.json({detail:'不支援的操作。'},{status:405,headers:common});
      const origin=request.headers.get('Origin');
      if(origin && origin!==url.origin) return Response.json({detail:'請在此網站內操作。'},{status:403,headers:common});
      const resource=url.pathname.split('/')[2];
      if(!['auth','employee-context','my-applications','my-dispatches','availability','vehicles','health'].includes(resource)
        || (['vehicles','health'].includes(resource)&&request.method!=='GET')) return Response.json({detail:'找不到指定 API。'},{status:404,headers:common});
      if(!env.DB_HOST || !env.DB_NAME || !env.DB_USER || !env.DB_PASSWORD) return Response.json({detail:'資料庫連線設定尚未完成。'},{status:503,headers:common});
      const response=await apiHandler(request,env);
      const headers=new Headers(response.headers);for(const [key,value] of Object.entries(common))headers.set(key,value);headers.set('Content-Type','application/json; charset=utf-8');
      return new Response(response.body,{status:response.status,headers});
    }
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:common});
    const asset=assets[url.pathname==='/'?'/index.html':url.pathname];
    if(!asset)return new Response('Not found',{status:404,headers:common});
    const body=asset.binary?Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)):asset.body;
    return new Response(request.method==='HEAD'?null:body,{headers:{...common,'Content-Type':asset.type,
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'"}});
  }};
}
