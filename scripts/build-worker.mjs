import fs from 'node:fs';
import path from 'node:path';
import {build} from 'esbuild';
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp'};
const assets={};
for(const file of ['index.html','style.css','app.js','config.js','favicon.svg','cullinan.webp']){
 const binary=file.endsWith('.webp');const buffer=fs.readFileSync(path.join('dist',file));
 assets['/'+file]={type:mime[path.extname(file)],binary,body:buffer.toString(binary?'base64':'utf8')};
}
fs.mkdirSync('dist/server',{recursive:true});
await build({stdin:{contents:"import {createWorker} from './worker.js';\nexport default createWorker("+JSON.stringify(assets)+');',resolveDir:process.cwd()},
  outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'neutral',conditions:['workerd','import'],
  external:['cloudflare:sockets','node:*'],target:'es2022',minify:false});
console.log('GPT Sites frontend and PostgreSQL API built; no ngrok or local backend dependency.');
