// Isolated PostgreSQL fixture only; no Supabase connection or credentials.
const fs=require('fs'),assert=require('node:assert/strict');
const {PGlite}=require('../test-results/we-postgres/node_modules/@electric-sql/pglite');
async function fixture(searchTransform=x=>x, extra='') {
 const db=new PGlite();
 const schema=fs.readFileSync('supabase/schema.sql','utf8');
 const chartTable=schema.match(/CREATE TABLE public.charts \([\s\S]*?\n\);/)[0];
 const oldSearch=fs.readFileSync('supabase/migrations/20261006_custom_chart_tags.sql','utf8').match(/CREATE FUNCTION public.search_charts\([\s\S]*?\n\$\$;/)[0];
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
 CREATE FUNCTION uuid_generate_v4() RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
 CREATE TYPE difficulty_type AS ENUM ('BASIC','ADVANCED','EXPERT','MASTER','ULTIMA','WORLDS_END');
 CREATE TYPE music_category AS ENUM ('Original'); CREATE TYPE chart_status AS ENUM ('draft','published','unpublished');
 CREATE TABLE profiles(id uuid PRIMARY KEY,username text,is_verified boolean);
 ${chartTable}
 CREATE TABLE tags(id integer PRIMARY KEY,name text); CREATE TABLE chart_tags(chart_id uuid,tag_id integer);
 ALTER TABLE charts ENABLE ROW LEVEL SECURITY; CREATE POLICY published ON charts FOR SELECT USING(status='published');
 GRANT SELECT ON charts,profiles,tags,chart_tags TO anon,authenticated;
 ${searchTransform(oldSearch)}
 REVOKE ALL ON FUNCTION search_charts(text,difficulty_type,numeric,numeric,text,integer,integer,integer) FROM PUBLIC;
 GRANT EXECUTE ON FUNCTION search_charts(text,difficulty_type,numeric,numeric,text,integer,integer,integer) TO anon,authenticated;
 INSERT INTO profiles VALUES('00000000-0000-0000-0000-000000000001','A',false);
 INSERT INTO charts(user_id,title,composer,charter_name,rating,status) VALUES('00000000-0000-0000-0000-000000000001','existing','C','A',14.7,'published');
 ${extra}`);
 return db;
}
(async()=>{
 const db=await fixture();
 const migration=fs.readFileSync('supabase/migrations/20261007_worlds_end_chart_metadata.sql','utf8');
 assert.doesNotMatch(migration,/CREATE\s+TEMP|we_search_grants/i);
 const snapshot=async(database,signature)=>(await database.query(`SELECT pg_get_userbyid(p.proowner) AS owner,
   CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,
   bool_or(x.is_grantable) AS grant_option
   FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
   WHERE p.oid=to_regprocedure($1) AND x.privilege_type='EXECUTE'
   GROUP BY p.proowner,x.grantee ORDER BY grantee`,[signature])).rows;
 const oldSignature='public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer)';
 const newSignature='public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer,integer,text)';
 const oldGrants=await snapshot(db,oldSignature);
 const before=(await db.query('SELECT to_jsonb(c) AS c FROM charts c')).rows[0].c;
 await db.exec(migration);
 assert.deepEqual(await snapshot(db,newSignature),oldGrants);
 const validated=(await db.query("SELECT conname,convalidated FROM pg_constraint WHERE conrelid='charts'::regclass AND conname IN ('charts_rating_check','charts_we_metadata_check') ORDER BY conname")).rows;
 assert.equal(validated.length,2);assert.ok(validated.every(row=>row.convalidated));
 const rpc=(await db.query("SELECT proargnames[1:10] AS names FROM pg_proc WHERE oid='search_charts(text,difficulty_type,numeric,numeric,text,integer,integer,integer,integer,text)'::regprocedure")).rows[0].names;
 const api=fs.readFileSync('js/api.js','utf8');
 const rpcCall=api.match(/supabase\.rpc\('search_charts', \{([\s\S]*?)\n  \}\)/)[1];
 const names=[...rpcCall.matchAll(/^\s*(\w+)\s*(?::|,)/gm)].map(m=>m[1]);
 assert.deepEqual([...rpc].sort(),names.sort());
 const after=(await db.query('SELECT to_jsonb(c) AS c FROM charts c')).rows[0].c;
 delete after.we_star_level;delete after.we_attribute;assert.deepEqual(after,before);
 for(const rating of [16,16.1,17,1234.5]) await db.query("INSERT INTO charts(user_id,title,composer,charter_name,rating,status) VALUES($1,$2,'C','A',$3,'published')",[before.user_id,`constant ${rating}`,rating]);
 for(const level of [1,3,5]) for(const attr of ['狂','招','任意新特色']) await db.query("INSERT INTO charts(user_id,title,composer,charter_name,difficulty,rating,we_star_level,we_attribute,status) VALUES($1,'WE','C','A','WORLDS_END',NULL,$2,$3,'published')",[before.user_id,level,attr]);
 const search=async args=>(await db.query(`SELECT * FROM search_charts(${args})`)).rows;
 assert.equal((await search("diff=>'MASTER', min_r=>16.1, max_r=>NULL")).length,3);
 assert.equal((await search("diff=>'WORLDS_END', min_r=>17, max_r=>20, we_star_filter=>3, we_attribute_filter=>'狂'")).length,1);
 assert.equal((await search("diff=>'WORLDS_END', min_r=>17, max_r=>20")).length,9);
 for(const level of [1,3,5]) assert.equal((await search(`diff=>'WORLDS_END', we_star_filter=>${level}`)).length,3);
 assert.equal((await search("diff=>'MASTER', we_star_filter=>3, we_attribute_filter=>'狂'")).length,5);
 assert.equal((await search("query=>'任意'")).length,0); // Attributes searched only through explicit WE filter.
 assert.equal((await search("diff=>'WORLDS_END', we_attribute_filter=>'新'")).length,3);
 await db.exec(`INSERT INTO tags VALUES(42,'custom'); INSERT INTO chart_tags SELECT id,42 FROM charts WHERE title='existing';`);
 assert.equal((await search('tag_filter=>42')).length,1);assert.equal((await search("query=>'custom'")).length,1);
 assert.equal((await search("sort_by=>'rating_desc', page_limit=>1, page_offset=>0"))[0].rating,'1234.5');
 await db.query("UPDATE charts SET description='metadata edit' WHERE id=$1",[before.id]);
 assert.equal((await db.query('SELECT status FROM charts WHERE id=$1',[before.id])).rows[0].status,'published');
 assert.equal((await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='charts'::regclass")).rows[0].relrowsecurity,true);
 await db.exec('SET ROLE anon');assert.equal((await search('tag_filter=>42')).length,1);await db.exec('RESET ROLE');
 for(const [diff,rating,stars,attr] of [
   ['WORLDS_END',null,null,'狂'],['WORLDS_END',null,3,null],['WORLDS_END',3,3,'狂'],
   ['WORLDS_END',null,0,'狂'],['WORLDS_END',null,6,'狂'],
   ['WORLDS_END',null,3,''],['WORLDS_END',null,3,' 狂'],['WORLDS_END',null,3,'字'.repeat(21)],
   ['MASTER',17,3,null],['MASTER',17,null,'狂'],['MASTER',17,3,'狂'],
   ['MASTER',null,null,null],['MASTER',0,null,null],['MASTER',16.15,null,null],
   ['MASTER','NaN',null,null],['MASTER','Infinity',null,null]
 ]) {
   await assert.rejects(db.query("INSERT INTO charts(user_id,title,composer,charter_name,difficulty,rating,we_star_level,we_attribute) VALUES($1,'bad','C','A',$2,$3,$4,$5)",[before.user_id,diff,rating,stars,attr]),e=>e.code==='23514');
 }
 await db.close();
 console.log('PASS: strict metadata/search and default anon/authenticated ACL preservation.');
 for(const extra of [
   `CREATE ROLE original_owner; CREATE ROLE unwanted; ALTER FUNCTION ${oldSignature} OWNER TO original_owner;
    GRANT EXECUTE ON FUNCTION ${oldSignature} TO PUBLIC;
    GRANT EXECUTE ON FUNCTION ${oldSignature} TO anon WITH GRANT OPTION;
    ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO unwanted;`,
   `DROP FUNCTION ${oldSignature}; ${fs.readFileSync('supabase/migrations/20261006_custom_chart_tags.sql','utf8').match(/CREATE FUNCTION public.search_charts\([\s\S]*?\n\$\$;/)[0]}`
 ]) {
   const grantsDb=await fixture(x=>x,extra);
   const saved=await snapshot(grantsDb,oldSignature);
   await grantsDb.exec(migration);
   assert.deepEqual(await snapshot(grantsDb,newSignature),saved);
   await grantsDb.close();
 }
 console.log('PASS: custom owner, PUBLIC, grant options, NULL/default ACL, no leaked default-privilege grants.');
 // Simulate failure after replacing the RPC, including all previous DDL.
 const late=await fixture();
 const lateBefore=await snapshot(late,oldSignature);
 await assert.rejects(late.exec(migration.replace("  EXECUTE 'ALTER FUNCTION '", "  RAISE EXCEPTION 'injected failure after CREATE';\n  EXECUTE 'ALTER FUNCTION '")),/injected failure/);
 await late.exec('ROLLBACK');
 assert.deepEqual(await snapshot(late,oldSignature),lateBefore);
 assert.equal((await late.query('SELECT to_regprocedure($1) IS NULL AS absent',[newSignature])).rows[0].absent,true);
 const columns=(await late.query("SELECT column_name,numeric_precision,numeric_scale,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='charts' AND column_name IN ('rating','we_star_level','we_attribute')")).rows;
 assert.deepEqual(columns,[{column_name:'rating',numeric_precision:4,numeric_scale:1,is_nullable:'NO'}]);
 assert.match((await late.query("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='charts'::regclass AND conname='charts_rating_check'")).rows[0].def,/16\.0/);
 await late.exec(fs.readFileSync('supabase/inspect-worlds-end-rollback.sql','utf8'));
 await late.close();
 console.log('PASS: post-CREATE failure restores original columns/type/check/eight-input RPC/ACL, leaves no ten-input RPC; read-only inspection SQL runs.');
 // Every regexp stage must reject zero and duplicate matches. These fixtures
 // are executable deployed functions whose body differs from the expected form.
 const mutations=[
   x=>x.replace('tag_filter INTEGER DEFAULT NULL','tag_filter INTEGER DEFAULT 0'),
   x=>x.replace('max_r NUMERIC DEFAULT 16.0','max_r NUMERIC DEFAULT 15.0'),
   x=>x.replace('is_verified BOOLEAN','verified BOOLEAN'),
   x=>x.replace('p.id, p.username, p.is_verified','p.id AS id, p.username, p.is_verified'),
   x=>x.replace('c.rating BETWEEN min_r AND max_r','c.rating >= min_r AND c.rating <= max_r'),
   ...['tag_filter integer DEFAULT NULL::integer)','max_r numeric DEFAULT 16.0,','is_verified boolean)','p.id, p.username, p.is_verified','c.rating BETWEEN min_r AND max_r']
     .map(text=>x=>x.replace('BEGIN',`BEGIN\n-- ${text}`))
 ];
 for(const mutate of mutations) {
   const bad=await fixture(mutate);
   await assert.rejects(bad.exec(migration),/transformation|differs/i);
   await bad.exec('ROLLBACK');
   assert.equal((await bad.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='charts' AND column_name='we_star_level'")).rows[0].n,0);
   assert.ok((await bad.query("SELECT to_regprocedure('search_charts(text,difficulty_type,numeric,numeric,text,integer,integer,integer)') AS old_rpc")).rows[0].old_rpc);
   assert.equal((await bad.query('SELECT count(*)::int AS n FROM charts')).rows[0].n,1);
   await bad.close();
 }
 for(const extra of [
   "UPDATE charts SET difficulty='WORLDS_END'",
   'ALTER TABLE charts DROP CONSTRAINT charts_rating_check; ALTER TABLE charts ADD CONSTRAINT charts_rating_check CHECK(rating>=0); UPDATE charts SET rating=0'
 ]) {
   const bad=await fixture(x=>x,extra);
   await assert.rejects(bad.exec(migration),/rows appeared|rating violates/);
   await bad.exec('ROLLBACK');
   assert.equal((await bad.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='charts' AND column_name='we_star_level'")).rows[0].n,0);
   await bad.close();
 }
 console.log('PASS: validated constraints; all 16 invalid metadata cases rejected by DB; 16.1/17.0/1234.5 and WE 1/3/5; RPC names match frontend; omitted WE filters and NULL max; tags/keyword/sort/pages, data/RLS/grants preserved; 10 regexp failure fixtures and 2 preflight failures roll back. Isolated PostgreSQL only.');
})().catch(e=>{console.error(e);process.exitCode=1;});
