// Self-contained browser fixtures; writes only ignored test-results, no Supabase requests.
// Run: node tests/strip-viewer-preview.mjs (http://127.0.0.1:8766/test-results/strip-viewer/index.html)
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createDeflate } from 'node:zlib';
import { once } from 'node:events';

// fileURLToPath handles non-ASCII Windows workspace paths correctly.
const { fileURLToPath } = await import('node:url');
const workspace=fileURLToPath(new URL('..',import.meta.url));
const output=path.join(workspace,'test-results','strip-viewer');
await fs.mkdir(output,{recursive:true});
const crcTable=Array.from({length:256},(_,value)=>{for(let i=0;i<8;i++)value=value&1?0xedb88320^(value>>>1):value>>>1;return value>>>0;});
function chunk(type,data) {
  const name=Buffer.from(type), content=Buffer.concat([name,data]);
  let crc=0xffffffff;for(const value of content)crc=crcTable[(crc^value)&255]^(crc>>>8);
  const header=Buffer.alloc(4),footer=Buffer.alloc(4);header.writeUInt32BE(data.length);footer.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([header,content,footer]);
}
async function png(width) {
  const height=1048, header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  const rows=[false,true].map(notes=>{
    const row=Buffer.alloc(1+width*3);
    for(let x=0;x<width;x++) {
      let color=x<128?[48,180,100]:x>=width-128?[220,70,90]:x%256<2?[180,180,210]:notes&&x%96<40?[255,160,64]:[24+(Math.floor(x/256)%2)*12,24,42];
      row[1+x*3]=color[0];row[2+x*3]=color[1];row[3+x*3]=color[2];
    }return row;
  });
  const compressor=createDeflate({level:6}),chunks=[];
  compressor.on('data',data=>chunks.push(data));
  for(let y=0;y<height;y++)if(!compressor.write(rows[y%64<10?1:0]))await once(compressor,'drain');
  compressor.end();await once(compressor,'end');
  await fs.writeFile(path.join(output,`strip-${width}.png`),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',Buffer.concat(chunks)),chunk('IEND',Buffer.alloc(0))]));
}
for(const width of [3000,10000,30000])await png(width);
const page=await fs.readFile(path.join(workspace,'chart_detail.html'),'utf8');
const styles=page.match(/<style>([\s\S]*?)<\/style>/)[1];
const viewer=page.slice(page.indexOf('  <section class="strip-viewer"'),page.indexOf('  </section>',page.indexOf('  <section class="strip-viewer"'))+12);
await fs.writeFile(path.join(output,'avatar.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#b04dff"/></svg>');
await fs.writeFile(path.join(output,'index.html'),`<!DOCTYPE html><html lang="zh-TW"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>展譜圖三尺寸測試</title><link rel="stylesheet" href="/css/chart-strip-viewer.css"><style>${styles}</style></head><body>
<header><h1 style="font-size:16px;">展譜圖三尺寸測試（本機，無後端）</h1></header><div style="padding:20px;">
<label>測試原圖 <select id="size"><option value="3000">3000 × 1048</option><option value="10000">10000 × 1048</option><option value="30000">30000 × 1048</option></select></label>
<button id="wheelTest">執行 Ctrl + Wheel 測試</button><output id="wheelResult" style="display:block;overflow-wrap:anywhere;"></output>
<p>左端綠色、右端紅色；原圖直接顯示。方向鍵與 End 可測試水平移動。</p>
<img id="otherImage" src="avatar.svg" alt="不受影響的其他圖片" style="width:64px;height:64px;object-fit:cover;border-radius:50%;"></div>
<main><div class="tabs-wrap">${viewer}</div></main>
<script type="module">import {getStripViewer} from '/js/chart-strip-viewer.js';
const viewer=getStripViewer(),size=document.getElementById('size');
size.onchange=()=>viewer.setSource('strip-'+size.value+'.png');size.onchange();
document.getElementById('wheelTest').onclick=()=>{
 const stage=viewer.viewport,rect=stage.getBoundingClientRect(),x=stage.clientWidth/2,y=stage.clientHeight/2;
 const before=(stage.scrollLeft+x)/viewer.scale,scale=viewer.scale;
 const wheel=new WheelEvent('wheel',{ctrlKey:true,deltaY:-120,deltaMode:0,clientX:rect.left+x,clientY:rect.top+y,cancelable:true,bubbles:true});
 stage.dispatchEvent(wheel);
 document.getElementById('wheelResult').textContent=JSON.stringify({before,after:(stage.scrollLeft+x)/viewer.scale,oldScale:scale,newScale:viewer.scale,prevented:wheel.defaultPrevented});
};</script></body></html>`);
const counts=new Map();
http.createServer(async (request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');
  if(url.pathname==='/__viewer_requests'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify(Object.fromEntries(counts)));return;}
  const file=path.resolve(workspace,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(path.resolve(workspace)+path.sep)){response.writeHead(403);response.end();return;}
  try {
    const content=await fs.readFile(file);counts.set(url.pathname,(counts.get(url.pathname)||0)+1);
    response.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
    response.setHeader('Cache-Control','no-store');response.end(content);
  } catch {response.writeHead(404);response.end();}
}).listen(8766,'127.0.0.1',()=>console.log('Viewer fixtures: http://127.0.0.1:8766/test-results/strip-viewer/index.html'));
