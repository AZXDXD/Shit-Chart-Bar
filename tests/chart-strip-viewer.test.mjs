import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../js/chart-strip-viewer.js', import.meta.url), 'utf8').replace(/\bexport /g, '');
let scheduled, resizeCallback;
const context = vm.createContext({ document: { body: { style: { overflow: 'auto' } }, addEventListener() {}, activeElement: null },
  ResizeObserver: class { constructor(callback) { resizeCallback = callback; } observe() {} },
  requestAnimationFrame(callback) { scheduled = callback; return 1; }, cancelAnimationFrame() { scheduled = null; } });
vm.runInContext(source, context);
const Viewer = vm.runInContext('ChartStripViewer', context);
function classes() { const values = new Set(); return { add: value => values.add(value), remove: value => values.delete(value),
  contains: value => values.has(value), toggle(value, enabled) { if(enabled) values.add(value); else values.delete(value); } }; }
function makeElement() { return { style: {}, dataset: {}, classList: classes(), attributes: {}, events: {}, hidden: false,
  addEventListener(type, callback) { this.events[type] = callback; }, setAttribute(key,value) { this.attributes[key] = value; },
  removeAttribute(key) { delete this.attributes[key]; }, focus() { context.document.activeElement = this; } }; }
function fixture(width) {
  const root = makeElement(), image = makeElement(), surface = makeElement(), viewport = makeElement();
  image.naturalWidth = width; image.naturalHeight = 1048;
  let assignments = 0, src = '', left = 0, top = 0;
  Object.defineProperty(image, 'src', { get: () => src, set(value) { assignments++; src = value; } });
  const buttons = ['out','in','original','fit','reset','fullscreen'].map(action => ({...makeElement(), dataset: {stripAction: action}}));
  const elements = { '.strip-viewport': viewport, '.strip-image': image, '.strip-surface': surface,
    '.strip-status': makeElement(), '.strip-zoom-label': makeElement(), '.strip-dimensions': makeElement() };
  root.querySelector = selector => elements[selector]; root.querySelectorAll = () => buttons;
  Object.defineProperties(viewport, {
    clientWidth: { get: () => root.classList.contains('is-expanded') ? 1280 : 1000 },
    clientHeight: { get: () => (root.classList.contains('is-expanded') ? 860 : 500) - (parseFloat(surface.style.width) > viewport.clientWidth ? 12 : 0) },
    scrollWidth: { get: () => Math.max(viewport.clientWidth, parseFloat(surface.style.width) || 0) },
    scrollHeight: { get: () => Math.max(viewport.clientHeight, parseFloat(surface.style.height) || 0) },
    scrollLeft: { get: () => left, set: value => left = Math.max(0, Math.min(value, viewport.scrollWidth - viewport.clientWidth)) },
    scrollTop: { get: () => top, set: value => top = Math.max(0, Math.min(value, viewport.scrollHeight - viewport.clientHeight)) },
  });
  viewport.clientLeft = viewport.clientTop = 0;
  viewport.getBoundingClientRect = () => ({left: 0, top: 0});
  const captures = new Set();
  viewport.setPointerCapture = id => captures.add(id); viewport.hasPointerCapture = id => captures.has(id); viewport.releasePointerCapture = id => captures.delete(id);
  const viewer = new Viewer(root); viewer.setSource(`/strip-${width}.png`); image.events.load();
  return {viewer, image, surface, viewport, root, buttons, assignments: () => assignments};
}
function close(actual, expected, label) { assert.ok(Math.abs(actual - expected) < 0.001, `${label}: ${actual} vs ${expected}`); }
function pointer(id,x,y,type='mouse') { return {pointerId:id,clientX:x,clientY:y,pointerType:type,button:0,preventDefault(){}}; }
for(const width of [3000,10000,30000]) {
  const {viewer,image,surface,viewport,root,assignments} = fixture(width);
  close(viewer.scale,488/1048, 'Fit Height independent of image width');
  close(parseFloat(image.style.height),488,'Fits visible height including horizontal scrollbar');
  close(parseFloat(image.style.width)/parseFloat(image.style.height),width/1048,'Aspect ratio');
  viewer.setScale(1); assert.equal(image.style.width,`${width}px`); assert.equal(image.style.height,'1048px');
  viewport.events.keydown({key:'End',preventDefault(){}}); assert.equal(viewport.scrollLeft,width-1000,'Can reach far right');
  viewer.setScale(.5); assert.equal(image.style.width,`${width/2}px`); assert.equal(image.style.height,'524px');
  viewer.setScale(2); assert.equal(image.style.width,`${width*2}px`); assert.equal(image.style.height,'2096px');
  viewer.setScale(1); viewport.scrollLeft=600; viewport.scrollTop=100;
  const pixel=(viewport.scrollLeft+250)/viewer.scale;
  viewer.setScale(2,{x:250,y:150}); close((viewport.scrollLeft+250)/viewer.scale,pixel,'Zoom anchor stays on same image pixel');
  const normalWheel={deltaY:120,ctrlKey:false,preventDefault(){throw new Error('Ordinary wheel must remain native');}};
  const beforeScale=viewer.scale; viewport.events.wheel(normalWheel); assert.equal(viewer.scale,beforeScale);
  let prevented=false; viewport.events.wheel({deltaY:-120,deltaMode:0,ctrlKey:true,clientX:250,clientY:150,preventDefault(){prevented=true;}});
  assert.equal(prevented,true); assert.ok(viewer.scale>beforeScale);
  close((viewport.scrollLeft+250)/viewer.scale,pixel,'Ctrl+wheel preserves pointer anchor');
  viewer.setScale(1); viewport.scrollLeft=400; viewport.scrollTop=100;
  viewer.pointerDown(pointer(1,500,200)); viewer.pointerMove(pointer(1,300,100)); viewer.flushGesture();
  assert.equal(viewport.scrollLeft,600); assert.equal(viewport.scrollTop,200); assert.ok(viewport.classList.contains('is-dragging'));
  viewer.pointerEnd(pointer(1,300,100)); assert.equal(viewport.classList.contains('is-dragging'),false);
  viewer.pointerDown(pointer(9,500,viewport.clientHeight+2)); assert.equal(viewer.pointers.size,0,'Native horizontal scrollbar stays usable');
  viewport.scrollLeft=400; viewport.scrollTop=100;
  viewer.pointerDown(pointer(2,100,200,'touch')); viewer.pointerDown(pointer(3,300,200,'touch'));
  viewer.pointerMove(pointer(3,500,200,'touch')); viewer.flushGesture();
  assert.equal(viewer.scale,2); close((viewport.scrollLeft+300)/viewer.scale,600,'Pinch keeps midpoint pixel');
  viewer.stopGesture(); assert.equal(viewer.pointers.size,0);
  viewer.setExpanded(true); assert.ok(root.classList.contains('is-expanded')); assert.equal(context.document.body.style.overflow,'hidden');
  assert.equal(root.attributes['aria-modal'],'true'); viewer.fitHeight(); close(parseFloat(surface.style.height),848,'Expanded height');
  viewer.onKeyDown({key:'Escape',preventDefault(){}}); assert.equal(viewer.expanded,false); assert.equal(context.document.body.style.overflow,'auto');
  viewer.setScale(1); viewer.setExpanded(true); resizeCallback(); assert.equal(viewer.scale,1,'Manual 100% survives resize'); viewer.setExpanded(false);
  viewer.setScale(50); assert.equal(viewer.scale,8); viewer.setScale(.001); assert.equal(viewer.scale,.05);
  viewer.reset(); assert.equal(viewer.mode,'fit-height'); assert.equal(viewport.scrollLeft,0); assert.equal(viewport.scrollTop,0);
  viewer.setScale(2); viewport.scrollLeft=600; viewer.setSource(`/strip-${width}.png`);
  assert.equal(viewer.scale,2); assert.equal(viewport.scrollLeft,600); assert.equal(assignments(),1,'Zoom/fullscreen/refresh must not reload the original');
  viewer.setExpanded(true); viewer.unavailable('讀取失敗');
  const closeButton=viewer.buttons.find(button=>button.dataset.stripAction==='fullscreen');
  assert.equal(closeButton.disabled,false,'Mobile can exit expanded mode even after image load failure');
  root.events.click({target:{closest:()=>closeButton}}); assert.equal(viewer.expanded,false);
}
const css=fs.readFileSync(new URL('../css/chart-strip-viewer.css',import.meta.url),'utf8');
assert.match(css,/\.strip-viewport img\.strip-image[^}]*max-width: none/);
assert.match(css,/\.strip-viewport[^}]*overflow: auto/);
assert.ok(!source.includes('canvas') && !source.includes('getPublicUrl'));
console.log('PASS: 3000/10000/30000 × 1048, aspect ratio, fit-height scrollbar allowance, exact 100%/50%/200% dimensions, far-right scroll, pointer-anchored Ctrl+wheel, native ordinary wheel, drag, two-finger pinch, expanded controls/ESC, resize, 5–800% bounds, reset and one original image assignment. DOM layout uses mocks; browser fixtures verify real layout separately.');
