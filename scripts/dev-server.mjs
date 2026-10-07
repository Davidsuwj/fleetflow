import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createWorker} from '../worker.js';
import {handleApi} from '../site-backend/api.js';
import {openDatabase} from '../site-backend/db.js';
const previewSchema=process.env.DEV_DB_SCHEMA||'fleetflow';
if(previewSchema!=='fleetflow'&&!/^fleetflow_test_[a-f0-9]{12}$/.test(previewSchema))throw new Error('Preview schema must be a disposable test schema');
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp'};
function loadAssets(){
  const assets={};
  for(const file of ['index.html','style.css','app.js','config.js','favicon.svg','cullinan.webp']){
    const binary=file.endsWith('.webp');assets['/'+file]={body:fs.readFileSync(path.join('dist',file)).toString(binary?'base64':'utf8'),binary,type:mime[path.extname(file)]};
  }
  return assets;
}
const port=Number(process.env.DEV_PORT||8770);
const origin='http://127.0.0.1:'+port;
http.createServer(async(incoming,outgoing)=>{
  try{
    let body;const chunks=[];let size=0;
    if(!['GET','HEAD'].includes(incoming.method)){
      for await(const chunk of incoming){size+=chunk.length;if(size>32768){outgoing.writeHead(413);outgoing.end('Request too large');return;}chunks.push(chunk);}
      body=Buffer.concat(chunks);
    }
    const response=await createWorker(loadAssets(),(request,env)=>handleApi(request,env,()=>openDatabase(env,previewSchema))).fetch(new Request(new URL(incoming.url,origin),{method:incoming.method,headers:incoming.headers,...(body?{body}:{})}),process.env);
    outgoing.writeHead(response.status,Object.fromEntries(response.headers));outgoing.end(Buffer.from(await response.arrayBuffer()));
  }catch{outgoing.writeHead(500,{'Content-Type':'application/json'});outgoing.end(JSON.stringify({detail:'本機開發服務發生錯誤。'}));}
}).listen(port,'127.0.0.1',()=>console.log('FleetFlow direct PostgreSQL preview: '+origin));
