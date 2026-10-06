import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';

let row, databaseError, storageError, signed = [];
const context = vm.createContext({
  currentUser: null,
  supabase: {
    from(table) {
      assert.equal(table,'charts');
      return { select() { return this; }, eq(key,id) { assert.equal(key,'id'); this.id=id; return this; },
        async single() { return { data: row, error: databaseError }; } };
    },
    storage: { from(bucket) { return { async createSignedUrl(path,expires,options) {
      signed.push({bucket,path,expires,options});
      return { data: storageError ? null : { signedUrl: 'https://example.com/storage/v1/object/sign/chart-packages/file?token=short-lived' }, error: storageError };
    } }; } },
  },
});
vm.runInContext(fs.readFileSync(new URL('../js/storage.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,''),context);
const run = expression => vm.runInContext(expression,context);
row = { id:'chart-id',user_id:'owner-id',status:'published',package_path:'owner-id/chart-id/package.zip' };
await run("getChartDownload({id:'chart-id',package_path:'forged-path',package_url:'https://evil.example'})");
assert.equal(signed.at(-1).path,row.package_path);
assert.equal(signed.at(-1).bucket,'chart-packages'); assert.equal(signed.at(-1).expires,60);
assert.equal(signed.at(-1).options.download,true);
row.status='draft'; signed=[];
await assert.rejects(run("getChartDownload('chart-id')")); assert.equal(signed.length,0);
context.currentUser={id:'other-user'};
await assert.rejects(run("getChartDownload('chart-id')")); assert.equal(signed.length,0);
context.currentUser={id:'owner-id'};
await run("getChartDownload('chart-id')"); assert.equal(signed.length,1);
row.status='unpublished'; context.currentUser=null;
await assert.rejects(run("getChartDownload('chart-id')")); assert.equal(signed.length,1);
row.status='published'; storageError=new Error('RLS denied after unpublish');
await assert.rejects(run("getChartDownload('chart-id')"),/RLS denied/);
storageError=null; row.package_path='other-user/chart-id/package.zip';
await assert.rejects(run("getChartDownload('chart-id')"),/路徑/);
databaseError=new Error('RLS denied');
await assert.rejects(run("getChartDownload('chart-id')"),/RLS denied/);
const sql=fs.readFileSync(new URL('../supabase/initialize-backend.sql',import.meta.url),'utf8');
assert.ok(sql.includes("('chart-packages', 'chart-packages', FALSE)"));
for (const bucket of ['cover-art','avatars','chart-strips']) assert.match(sql,new RegExp(`\\('${bucket}',\\s*'${bucket}',\\s*TRUE\\)`));
const publicPolicy=sql.match(/CREATE POLICY studio_storage_select[\s\S]*?;/)[0];
assert.ok(!publicPolicy.includes('chart-packages'));
const packagePolicy=sql.match(/CREATE POLICY studio_packages_select[\s\S]*?;/)[0];
assert.ok(packagePolicy.includes("c.status = 'published'"));
assert.ok(packagePolicy.includes('c.package_path = storage.objects.name'));
assert.ok(packagePolicy.includes('(storage.foldername(name))[1] = auth.uid()::text'));
for (const action of ['insert_own','update_own','delete_own']) {
  const policy=sql.match(new RegExp(`CREATE POLICY studio_storage_${action}[\\s\\S]*?;`))[0];
  assert.ok(policy.includes('TO authenticated')); assert.ok(policy.includes('(storage.foldername(name))[1] = auth.uid()::text'));
}
const supabaseSource=fs.readFileSync(new URL('../js/supabase.js',import.meta.url),'utf8');
assert.ok(supabaseSource.includes("bucket === 'chart-packages'"));
const html=fs.readFileSync(new URL('../chart_detail.html',import.meta.url),'utf8');
assert.ok(html.includes('js/pages/chart-download.js'));
console.log('PASS: private bucket + published/owner SQL declarations, guest/other-user draft denial, owner draft signing, authoritative path, storage denial propagation, expiry and detail button wiring. Uses mocks; live RLS not executed.');
