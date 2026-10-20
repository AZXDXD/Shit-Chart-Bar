import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { inspectPackage, validContent } from '../js/package-validation.js';

const jpg = [255,216,255,224];
const png = [137,80,78,71,13,10,26,10];
const entry = (name, bytes) => ({ name, async: async () => Uint8Array.from(bytes) });
const required = [entry('map.ugc',[65]), entry('music.wav',[82,73,70,70,0,0,0,0,87,65,86,69])];
const cases = [
  ['jpg', [entry('cover.jpg',jpg)], true],
  ['JPG', [entry('cover.JPG',jpg)], true],
  ['png', [entry('cover.png',png)], false],
  ['jpeg', [entry('cover.jpeg',jpg)], false],
  ['png before jpg', [entry('cover.png',png),entry('cover.jpg',jpg)], true],
  ['no cover', [], false],
  ['webp', [entry('cover.webp',jpg)], false],
  ['fake jpg', [entry('cover.jpg',png)], false],
];
for (const [label, covers, passed] of cases) {
  // Exercise the same ZIP entry API used by JSZip without an external dependency.
  globalThis.window = { JSZip: { loadAsync: async () => ({ files: Object.fromEntries([...required,...covers].map(e => [e.name,e])) }) } };
  const result = await inspectPackage({name:'package.zip',type:'application/zip',size:100,arrayBuffer:async()=>new ArrayBuffer(0)});
  assert.equal(Boolean(result.found.cover),passed,label);
  assert.ok(result.found.chart && result.found.audio,label);
  if (passed) { assert.equal(result.found.cover.ext,'jpg'); assert.deepEqual([...result.found.cover.bytes],jpg); }
  else assert.deepEqual(result.missing,['缺少曲繪封面（需要 .jpg 格式）']);
}
delete globalThis.window;

const uploads = [];
const context = vm.createContext({ currentUser:{id:'owner'}, Uint8Array, validContent, crypto:{randomUUID:()=> 'unique'}, getStorageUrl:(bucket,path)=>path, supabase:{storage:{from:bucket=>({upload:async(path,file)=>{uploads.push({bucket,path,file});return {error:null};}})}} });
const storage = fs.readFileSync('js/storage.js','utf8');
vm.runInContext(storage.replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,''),context);
for (const [label,covers,passed] of cases.filter(c=>c[1].length===1)) {
  const cover=covers[0]; context.file={name:cover.name,arrayBuffer:async()=>Uint8Array.from(await cover.async()).buffer};
  const count=uploads.length;
  if(passed) { await vm.runInContext("uploadCoverArt('chart',file)",context);assert.equal(uploads.length,count+1);assert.ok(uploads.at(-1).path.endsWith('.jpg')); }
  else { await assert.rejects(vm.runInContext("uploadCoverArt('chart',file)",context));assert.equal(uploads.length,count); }
}
const studio = fs.readFileSync('js/pages/charter_studio.js','utf8');
assert.ok(studio.includes("new File([cover.bytes], 'cover.jpg', { type: 'image/jpeg' })"));
const html=fs.readFileSync('charter_studio.html','utf8');
assert.match(html,/id="coverEditInput"[^>]*accept="\.jpg"/);
assert.match(html,/id="avatarInput"[^>]*accept="image\/png,image\/jpeg,image\/webp"/);
console.log('PASS: ZIP JPG/JPG uppercase/PNG/JPEG/mixed/no-cover/WebP/fake JPG, unchanged UGC/audio checks, storage rejects non-JPG before uploading, upload uses checked JPG bytes, cover-only input restriction. ZIP parser and storage mocked.');
