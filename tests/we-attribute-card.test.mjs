import { renderChartMediaStatus } from '../js/chart-media-status.js';
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {chartLevel,renderWeAttribute} from '../js/chart-metadata.js';
const source=fs.readFileSync('js/pages/index.js','utf8').replace(/^import[^;]*;\r?\n/gm,'');
const ctx=vm.createContext({renderChartMediaStatus,chartLevel,renderWeAttribute,console,location:{hash:''},window:{addEventListener(){}},document:{addEventListener(){}},renderChartCover:()=>'',escapeHtml:s=>String(s??'')});
vm.runInContext(source,ctx);
const charts=[{difficulty:'WORLDS_END',we_star_level:5,we_attribute:'狂'},{difficulty:'WORLDS_END',we_star_level:3,we_attribute:'宴'},{difficulty:'MASTER',rating:17,we_attribute:'狂'},{difficulty:'ULTIMA',rating:16.1,we_attribute:'宴'}].map((c,i)=>({...c,id:'588ab3bc-14a4-4cf1-b6f5-b6598371196b',title:'Test',composer:'Composer',avg_rating:4,review_count:0,strip_path:i%2===0?'strip.png':null,youtube_url:i<2?'https://youtu.be/abc':null}));
const cards=charts.map(c=>ctx.renderCard(c));
assert.match(cards[0],/★★★★★/);assert.match(cards[0],/>狂<\/span>/);assert.match(cards[1],/★★★/);assert.match(cards[1],/>宴<\/span>/);
for(const c of cards.slice(2))assert.doesNotMatch(c,/we-attribute-badge/);
for(const c of cards)assert.match(c,/chart_detail.html\?id=588ab3bc/);
assert.doesNotMatch(renderWeAttribute({difficulty:'WORLDS_END',we_attribute:'<img>'}),/<img>/);
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/陳政宇/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try {
 const page=await browser.newPage();
 const styles=fs.readFileSync('index.html','utf8').match(/<style>([\s\S]*?)<\/style>/)[1]+fs.readFileSync('css/difficulty.css','utf8')+fs.readFileSync('css/chart-media-status.css','utf8');
 for(const width of [1280,390,320]){
  await page.setViewportSize({width,height:900});
  await page.setContent(`<style>${styles} * {transition:none!important}</style><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;padding:12px;max-width:980px">${cards.join('')}</div>`);
  for(const badge of await page.locator('.we-attribute-badge').all()){
   const b=await badge.boundingBox(), cover=await badge.locator('..').locator('..').boundingBox(), diff=await badge.locator('..').locator('.card-diff-badge').boundingBox();
   assert.equal(b.width,b.height);assert.ok(b.y>=diff.y+diff.height+5);assert.ok(b.x+b.width<=cover.x+cover.width);assert.ok(b.y+b.height<=cover.y+cover.height);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  for(const stack of await page.locator('.chart-media-status').all()) {
   const badges=stack.locator('.media-status');
   const strip=await badges.nth(0).boundingBox(),video=await badges.nth(1).boundingBox();
   const cover=await stack.locator('..').boundingBox();
   assert.ok(Math.abs(strip.x-cover.x-12)<0.1);assert.ok(Math.abs(strip.y-cover.y-12)<0.1);
   assert.ok(video.y+video.height<=cover.y+cover.height);assert.ok(strip.x+strip.width<=cover.x+cover.width);
   const difficulty=await stack.locator('..').locator('.card-diff-badge').boundingBox();
   assert.ok(strip.x+strip.width<=difficulty.x);
   assert.ok(Math.abs(strip.width-video.width)<0.1);assert.ok(Math.abs(strip.height-video.height)<0.1);
   assert.ok(Math.abs(video.y-(strip.y+strip.height)-6)<0.1);
  }
  await page.locator('.chart-card').first().hover();
  assert.equal(await page.locator('.chart-card button, .card-hover-actions').count(),0);
  await fs.promises.mkdir('test-results/we-attribute',{recursive:true});
  await page.screenshot({path:`test-results/we-attribute/${width}.png`,fullPage:true});
 }
}finally{await browser.close();}
console.log('PASS: real home renderer dynamic 狂/宴, WE 5/3 stars, MASTER/ULTIMA excluded, UUID links/escaping; browser layout at 1280/390/320, square badges below label inside cover, no horizontal overflow. Fixture only, no DB writes.');
