import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { chartLevel, renderWeAttribute } from '../js/chart-metadata.js';

const track={style:{},innerHTML:'',querySelectorAll:()=>[]};
const dots={innerHTML:''};
const charts=[
  {id:'uuid-a',title:'<Bright>',composer:'A',charter_name:'Alpha',difficulty:'MASTER',rating:14,cover_url:'https://example.test/a.png'},
  {id:'uuid-b',title:'Second',composer:'B',charter_name:'Beta',difficulty:'EXPERT',rating:12,cover_url:null},
];
const slides=charts.map(()=>({setAttribute(){}}));
const context=vm.createContext({chartLevel,renderWeAttribute,URL,console,window:{addEventListener(){}},setInterval(){},
  document:{addEventListener(){},getElementById:id=>id==='carouselTrack'?track:dots,
    querySelectorAll:selector=>selector.includes('carousel-slide')?slides:[]},
  searchCharts:async()=>charts,
  supabase:{from:()=>({select:()=>({in:async()=>({data:[{chart_id:'uuid-a',tags:{name:'<tag>'}}]})})})},
});
vm.runInContext(fs.readFileSync('js/chart-cover.js','utf8').replaceAll('export ',''),context);
vm.runInContext(fs.readFileSync('js/pages/index.js','utf8').replace(/^import .*;\r?\n/gm,''),context);
await context.loadFeatured();
const [first,second]=track.innerHTML.split('<div class="carousel-slide"').slice(1);
assert.match(first,/src="https:\/\/example.test\/a.png"/);
assert.match(first,/loading="eager" fetchpriority="high"/);
assert.match(first,/chart_detail.html\?id=uuid-a/);
assert.match(first,/&lt;Bright&gt;/);
assert.match(first,/# &lt;tag&gt;/);
assert.match(second,/chart_detail.html\?id=uuid-b/);
assert.match(second,/aria-label="尚無曲繪"/);
assert.doesNotMatch(second,/<img/);
context.window.nextSlide();
assert.equal(track.style.transform,'translateX(-50%)');
assert.equal(slides[0].inert,true);
assert.equal(slides[1].inert,false);
assert.equal(track.innerHTML.includes('src="https://example.test/a.png"'),true);
const image=context.renderChartCover(charts[0]);
assert.match(image,/loading="lazy"/);
assert.match(image,/this\.style\.display='none';this\.nextElementSibling\.hidden=false/);
assert.doesNotMatch(context.renderChartCover({cover_url:'javascript:alert(1)'}),/<img/);
console.log('PASS: Featured slide cover/UUID/tag binding, priority, missing/invalid cover fallback and slide switching. DOM/Supabase mocked.');
