import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/陳政宇/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const html = fs.readFileSync('index.html','utf8');
const styles = html.match(/<style>([\s\S]*?)<\/style>/)[1] + fs.readFileSync('css/difficulty.css','utf8');
const section = html.slice(html.indexOf('<section class="search-section" id="favoriteSearchSection"'),html.indexOf('<!-- ===== CHART GRID ===== -->')).replace('id="favoriteSearchSection" hidden','id="favoriteSearchSection"');
const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
try {
  const page = await browser.newPage();
  for (const width of [1280,390,320]) {
    await page.setViewportSize({width,height:1000});
    await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style>${section}`);
    assert.ok(await page.locator('#favoriteQuery').isVisible());
    assert.equal(await page.locator('[data-favorite-difficulty]').count(),6);
    for (const id of ['favoriteQuery','favoriteSort','favoriteMin','favoriteMax','favoriteStars','favoriteStrip','favoriteVideo','clearFavoriteFilters']) {
      const box=await page.locator('#'+id).boundingBox();assert.ok(box && box.x>=0 && box.x+box.width<=width+1,`${width}: ${id}`);
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: no horizontal overflow`);
    fs.mkdirSync('test-results/favorites',{recursive:true});
    await page.screenshot({path:`test-results/favorites/filters-${width}.png`,fullPage:true});
  }
} finally {await browser.close();}
console.log('PASS: real browser favorites filters at 1280/390/320, every control visible within viewport, six difficulty buttons, no horizontal overflow. Fixture only; no network/database.');
