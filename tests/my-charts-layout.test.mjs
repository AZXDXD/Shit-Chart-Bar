import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('C:/Users/陳政宇/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const html=fs.readFileSync('charter_studio.html','utf8');
const styles=html.match(/<style>([\s\S]*?)<\/style>/)[1]+fs.readFileSync('css/difficulty.css','utf8');
const section=html.slice(html.indexOf('<form id="myChartSearchForm"'),html.indexOf('<div id="myChartList"'));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try {
  const page=await browser.newPage();
  for(const width of [1280,390,320]) {
    await page.setViewportSize({width,height:1000});
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style><main style="padding:16px">${section}</main>`);
    assert.equal(await page.locator('[data-my-chart-difficulty]').count(),6);
    for(const id of ['myChartQuery','myChartSort','myChartMin','myChartMax','myChartStars','myChartStatus','myChartStrip','myChartVideo','clearMyChartFilters']) {
      const box=await page.locator('#'+id).boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1,`${width}: ${id}`);
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    fs.mkdirSync('test-results/my-charts',{recursive:true});await page.screenshot({path:`test-results/my-charts/filters-${width}.png`,fullPage:true});
  }
} finally {await browser.close();}
console.log('PASS: my charts filters at 1280/390/320, controls within viewport and no horizontal overflow. Local fixture; no database.');
