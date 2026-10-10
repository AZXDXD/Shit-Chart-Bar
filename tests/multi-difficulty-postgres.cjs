// Actual isolated PostgreSQL (PGlite/WASM). No URLs, Supabase clients or credentials.
// Run: node tests/multi-difficulty-postgres.cjs [path/to/@electric-sql/pglite]
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {PGlite}=require(path.resolve(process.argv[2] || 'test-results/we-postgres/node_modules/@electric-sql/pglite','dist/index.cjs'));
const migration=fs.readFileSync('supabase/migrations/20261008_multi_difficulty_search.sql','utf8');
const oldSig='public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer,integer,text)';
const newSig='public.search_charts_multi(text,public.difficulty_type[],numeric,numeric,text,integer,integer,integer,integer,text)';
const six=['BASIC','ADVANCED','EXPERT','MASTER','ULTIMA','WORLDS_END'];
let checks=0;function equal(a,b){assert.deepEqual(a,b);checks++;}
function exportedDefinition(file) {
 const text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');
 if(!file.toLowerCase().endsWith('.csv'))return text;
 // CSV exports often contain a multiline pg_get_functiondef cell.
 const cells=[];let cell='',quoted=false;
 for(let i=0;i<text.length;i++) {
  const ch=text[i];
  if(ch==='"') {
   if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;
  } else if(!quoted&&(ch===','||ch==='\n'||ch==='\r')) {
   cells.push(cell);cell='';if(ch==='\r'&&text[i+1]==='\n')i++;
  } else cell+=ch;
 }
 cells.push(cell);assert.equal(quoted,false,'Unclosed CSV field');
 const definitions=cells.filter(value=>/^\s*CREATE(?: OR REPLACE)? FUNCTION (?:public\.)?search_charts\s*\(/i.test(value));
 assert.equal(definitions.length,1,'Expected one search_charts function definition in CSV');
 return definitions[0];
}
async function fixture(extra='') {
 const db=new PGlite();
 const schema=fs.readFileSync('supabase/schema.sql','utf8');
 const chartTable=schema.match(/CREATE TABLE public.charts \([\s\S]*?\n\);/)[0];
 const oldSearch=fs.readFileSync('supabase/migrations/20261006_custom_chart_tags.sql','utf8').match(/CREATE FUNCTION public.search_charts\([\s\S]*?\n\$\$;/)[0];
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE outsider; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
 CREATE TYPE difficulty_type AS ENUM ('BASIC','ADVANCED','EXPERT','MASTER','ULTIMA','WORLDS_END');
 CREATE TYPE music_category AS ENUM ('Original'); CREATE TYPE chart_status AS ENUM ('draft','published','unpublished');
 CREATE TABLE profiles(id uuid PRIMARY KEY,username text,is_verified boolean);
 ${chartTable}
 CREATE TABLE tags(id integer PRIMARY KEY,name text); CREATE TABLE chart_tags(chart_id uuid,tag_id integer);
 ALTER TABLE charts ENABLE ROW LEVEL SECURITY;
 CREATE POLICY visible ON charts FOR SELECT USING(status='published' OR user_id=auth.uid());
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
 GRANT SELECT ON charts,profiles,tags,chart_tags TO anon,authenticated;
 ${oldSearch}
 REVOKE ALL ON FUNCTION search_charts(text,difficulty_type,numeric,numeric,text,integer,integer,integer) FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION search_charts(text,difficulty_type,numeric,numeric,text,integer,integer,integer) TO anon,authenticated;
 INSERT INTO profiles VALUES('00000000-0000-0000-0000-000000000001','Author',false);`);
 // These OLD migrations only build an in-memory fixture, never a live database.
 await db.exec(fs.readFileSync('supabase/migrations/20261007_worlds_end_chart_metadata.sql','utf8'));
 // Optional exported production function can be supplied after constructing its schema.
 if(process.env.SEARCH_RPC_FIXTURE_FILE) await db.exec(exportedDefinition(process.env.SEARCH_RPC_FIXTURE_FILE));
 for(let i=0;i<36;i++) {
  const diff=six[i%6],we=diff==='WORLDS_END';
  await db.query(`INSERT INTO charts(id,user_id,title,composer,charter_name,difficulty,rating,we_star_level,we_attribute,status,avg_rating,download_count,published_at)
    VALUES($1,'00000000-0000-0000-0000-000000000001',$2,'Composer needle','Author',$3,$4,$5,$6,'published',$7,$8,'2026-10-01')`,
   [`10000000-0000-0000-0000-${String(i+1).padStart(12,'0')}`,`Song ${i+1}`,diff,we?null:12+i%3,we?3:null,we?(i%12===5?'狂':'宴'):null,i%5,i]);
 }
 await db.exec(`INSERT INTO charts(user_id,title,composer,charter_name,difficulty,rating,status)
 VALUES('00000000-0000-0000-0000-000000000001','Private needle','Composer','Author','MASTER',13,'draft');
 INSERT INTO tags VALUES(7,'自訂測試標籤');
 INSERT INTO chart_tags SELECT id,7 FROM charts WHERE id IN
 ('10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000006');
 ${extra}`);
 return db;
}
async function snapshot(db,sig) {
 return (await db.query(`SELECT pg_get_userbyid(proowner) AS owner,prosecdef AS definer,proconfig AS settings,
  (SELECT jsonb_agg(jsonb_build_array(x.grantee,x.privilege_type,x.is_grantable) ORDER BY x.grantee,x.privilege_type)
   FROM aclexplode(coalesce(proacl,acldefault('f',proowner))) x) AS acl
 FROM pg_proc WHERE oid=to_regprocedure($1)`,[sig])).rows[0];
}
const page=async(db,args='')=>(await db.query(`SELECT search_charts_multi(${args}) AS result`)).rows[0].result;
const legacy=async(db,args='')=>(await db.query(`SELECT * FROM search_charts(${args})`)).rows;
async function verify(db) {
 const version=(await db.query('SELECT version() AS version')).rows[0].version;
 const beforeDef=(await db.query('SELECT pg_get_functiondef(to_regprocedure($1)) AS def',[oldSig])).rows[0].def;
 const beforeAcl=await snapshot(db,oldSig),beforeRows=await legacy(db);
 const beforeData=(await db.query('SELECT jsonb_agg(to_jsonb(c) ORDER BY id) AS rows FROM charts c')).rows[0].rows;
 await db.exec(migration);
 equal((await db.query('SELECT pg_get_functiondef(to_regprocedure($1)) AS def',[oldSig])).rows[0].def,beforeDef);
 equal(await snapshot(db,oldSig),beforeAcl);equal(await snapshot(db,newSig),beforeAcl);equal(await legacy(db),beforeRows);
 equal((await db.query('SELECT jsonb_agg(to_jsonb(c) ORDER BY id) AS rows FROM charts c')).rows[0].rows,beforeData);
 equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='charts'::regclass")).rows[0].relrowsecurity,true);
 for(const args of ['',"diffs=>NULL","diffs=>ARRAY[]::difficulty_type[]",`diffs=>ARRAY['${six.join("','")}']::difficulty_type[]`]) {
  const result=await page(db,args);equal(result.total_count,36);equal(result.charts.length,20);
 }
 for(const diff of six) {const result=await page(db,`diffs=>ARRAY['${diff}']::difficulty_type[]`);equal(result.total_count,6);equal(result.charts.every(c=>c.difficulty===diff),true);}
 const multi=await page(db,"diffs=>ARRAY['EXPERT','MASTER']::difficulty_type[]");equal(multi.total_count,12);
 equal(multi.charts.every(c=>['EXPERT','MASTER'].includes(c.difficulty)),true);
 equal((await page(db,"diffs=>ARRAY['MASTER','MASTER']::difficulty_type[]")).total_count,6);
 for(const args of ["query=>'absent'","diffs=>ARRAY['MASTER']::difficulty_type[],min_r=>100"]) {
  equal(await page(db,args),{charts:[],total_count:0});equal(await page(db,args+',page_offset=>999'),{charts:[],total_count:0});
 }
 equal(await page(db,'page_offset=>999'),{charts:[],total_count:36});
 const first=await page(db),second=await page(db,'page_offset=>20');equal(second.total_count,36);equal(second.charts.length,16);
 equal(new Set([...first.charts,...second.charts].map(c=>c.id)).size,36);
 equal(first.charts.map(c=>c.id),[...first.charts.map(c=>c.id)].sort());
 equal((await page(db)).charts,first.charts);
 equal(first.charts.some(c=>'__search_order' in c),false);
 equal(first.charts.every(c=>c.user_id==='00000000-0000-0000-0000-000000000001'),true);
 for(const sort of ['avg_rating','download_count','rating_desc','published_at']) {
  const result=await page(db,`sort_by=>'${sort}',page_limit=>100`);equal(result.total_count,36);
  if(sort!=='published_at') {
   const values=result.charts.map(c=>c[sort==='rating_desc'?'rating':sort]).filter(v=>v!==null);
   equal(values,[...values].sort((a,b)=>Number(b)-Number(a)));
  }
 }
 const combined=await page(db,"diffs=>ARRAY['EXPERT','MASTER','WORLDS_END']::difficulty_type[],query=>'needle',tag_filter=>7,min_r=>12,max_r=>13,we_star_filter=>3,we_attribute_filter=>'狂',sort_by=>'download_count',page_limit=>1");
 equal(combined.total_count,2);equal(combined.charts[0].difficulty,'WORLDS_END');
 equal((await page(db,"diffs=>ARRAY['EXPERT','MASTER','WORLDS_END']::difficulty_type[],query=>'needle',tag_filter=>7,min_r=>12,max_r=>13,we_star_filter=>3,we_attribute_filter=>'狂',sort_by=>'download_count',page_limit=>1,page_offset=>1")).charts[0].difficulty,'MASTER');
 equal((await page(db,"query=>'自訂測試標籤'")).total_count,3);
 equal((await page(db,"tag_filter=>7")).total_count,3);
 equal((await page(db,"diffs=>ARRAY['WORLDS_END']::difficulty_type[],min_r=>100,max_r=>101,we_star_filter=>3,we_attribute_filter=>'狂'")).total_count,3);
 equal((await page(db,"diffs=>ARRAY['MASTER','WORLDS_END']::difficulty_type[],min_r=>12,max_r=>12,we_star_filter=>4")).total_count,6);
 // Revoke base-table access to prove INVOKER does not bypass RLS/permissions.
 await db.exec('SET ROLE anon');equal((await page(db)).total_count,36);
 equal(Number((await db.query("SELECT count(*) FROM charts WHERE status='draft'")).rows[0].count),0);
 await db.exec('RESET ROLE; SET ROLE authenticated');equal((await page(db)).total_count,36);
 await db.exec("SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false)");
 equal(Number((await db.query("SELECT count(*) FROM charts WHERE status='draft'")).rows[0].count),1);
 equal((await page(db)).total_count,36);await db.exec('RESET ROLE');
 await db.exec('SET ROLE outsider');await assert.rejects(page(db),e=>e.code==='42501');await db.exec('RESET ROLE');
 await db.exec('REVOKE SELECT ON charts FROM anon; SET ROLE anon');await assert.rejects(page(db),e=>e.code==='42501');await db.exec('RESET ROLE; GRANT SELECT ON charts TO anon');
 for(const args of ['page_limit=>0','page_limit=>NULL','page_offset=>-1','page_offset=>NULL']) await assert.rejects(page(db,args),e=>e.code==='22023');
 console.log(`PASS: ${version}; OR/none/all, empty and out-of-range totals, count/page consistency, full filters and sorting, anon/authenticated RLS, permissions, unchanged original RPC/data.`);
}
(async()=>{
 const db=await fixture();await verify(db);await db.close();
 for(const extra of [
  `CREATE ROLE original_owner; CREATE ROLE unwanted; ALTER FUNCTION ${oldSig} OWNER TO original_owner;
   GRANT EXECUTE ON FUNCTION ${oldSig} TO PUBLIC;
   GRANT EXECUTE ON FUNCTION ${oldSig} TO anon WITH GRANT OPTION;
   ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO unwanted;`,
  `REVOKE ALL ON FUNCTION ${oldSig} FROM anon,authenticated; GRANT EXECUTE ON FUNCTION ${oldSig} TO PUBLIC;`
 ]) {
  const aclDb=await fixture(extra),saved=await snapshot(aclDb,oldSig);await aclDb.exec(migration);
  equal(await snapshot(aclDb,newSig),saved);equal(await snapshot(aclDb,oldSig),saved);await aclDb.close();
 }
 const defaults=await fixture();
 const original=(await defaults.query('SELECT pg_get_functiondef(to_regprocedure($1)) AS def',[oldSig])).rows[0].def;
 await defaults.exec(`DROP FUNCTION ${oldSig}; ${original}`);
 equal((await defaults.query('SELECT proacl IS NULL AS is_default FROM pg_proc WHERE oid=to_regprocedure($1)',[oldSig])).rows[0].is_default,true);
 const defaultAcl=await snapshot(defaults,oldSig);await defaults.exec(migration);
 equal(await snapshot(defaults,newSig),defaultAcl);equal(await snapshot(defaults,oldSig),defaultAcl);await defaults.close();
 // Abort must preserve original RPC and leave no new one, including late ACL failure.
 for(const mutate of [
  sql=>sql.replace('diff IS NULL OR c\\.difficulty = diff','nonmatching predicate'),
  sql=>sql.replace("  EXECUTE 'ALTER FUNCTION '","  RAISE EXCEPTION 'injected late failure';\n  EXECUTE 'ALTER FUNCTION '")
 ]) {
  const bad=await fixture(),saved=await snapshot(bad,oldSig);
  await assert.rejects(bad.exec(mutate(migration)));await bad.exec('ROLLBACK');
  equal(await snapshot(bad,oldSig),saved);equal((await bad.query('SELECT to_regprocedure($1) IS NULL AS absent',[newSig])).rows[0].absent,true);await bad.close();
 }
 console.log(`PASS: ${checks} PostgreSQL assertions, custom/default ACL + grant options, no default-grant leaks, early/late atomic rollback. No Supabase SQL executed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
