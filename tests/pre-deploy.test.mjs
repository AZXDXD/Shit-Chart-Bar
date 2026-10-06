import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Report locations only, never credential values.
const files = execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const issues=[]; let publicJwtCount=0;
for (const file of new Set(files)) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
  if (/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('.env.example')) issues.push(`${file}: environment file`);
  const source=fs.readFileSync(file,'utf8');
  const patterns=[
    /sb_secret_[A-Za-z0-9_-]{10,}/g,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/g,
    /(?:google|discord)[_ -]*(?:client[_ -]*)?secret\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/gi,
    /(?:client_secret|service_role_key|secret_key)\s*[:=]\s*["'][A-Za-z0-9_./+-]{20,}["']/gi,
  ];
  for (const regex of patterns) for (const match of source.matchAll(regex)) issues.push(`${file}:${source.slice(0,match.index).split('\n').length}: private credential pattern`);
  for (const match of source.matchAll(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)) {
    const payload=JSON.parse(Buffer.from(match[0].split('.')[1],'base64url').toString());
    if (payload.role === 'anon') publicJwtCount++;
    else issues.push(`${file}: JWT role is not public anon`);
  }
}
assert.deepEqual(issues,[],'Potential secrets found (values withheld)');

// Check actual HTML structure, not only scripts: a missing wrapper can hide tabs.
const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
for (const file of ['index.html','charter_studio.html','chart_detail.html']) {
  const source=fs.readFileSync(file,'utf8').replace(/<!--[^]*?-->/g,'').replace(/<(script|style)\b[^>]*>[^]*?<\/\1>/gi,'');
  const stack=[];
  for (const match of source.matchAll(/<(\/)?([a-z][\w:-]*)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi)) {
    const tag=match[2].toLowerCase();
    if (match[1]) assert.equal(stack.pop(),tag,`${file}: mismatched closing ${tag}`);
    else if (!voidTags.has(tag) && !match[0].endsWith('/>')) stack.push(tag);
  }
  assert.deepEqual(stack,[],`${file}: unclosed tags`);
}
console.log(`PASS: ${new Set(files).size} repository files checked; no private credential patterns found; ${publicJwtCount} allowed anon JWT occurrence(s); studio/detail HTML balanced.`);
