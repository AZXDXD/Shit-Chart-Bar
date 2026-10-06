// Run: node tests/custom-tag-migration-postgres.cjs <PGlite package directory>
// Isolated PostgreSQL WASM database; never connects to Supabase.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {PGlite}=require(path.resolve(process.argv[2],'dist/index.cjs'));
const {pg_trgm}=require(path.resolve(process.argv[2],'dist/contrib/pg_trgm.cjs'));
const init=fs.readFileSync('supabase/initialize-backend.sql','utf8');
const migration=fs.readFileSync('supabase/migrations/20261006_custom_chart_tags.sql','utf8');
const a='00000000-0000-0000-0000-000000000001',b='00000000-0000-0000-0000-000000000002';
const chart='10000000-0000-0000-0000-000000000001',draft='10000000-0000-0000-0000-000000000002';
const table=name=>init.match(new RegExp(`CREATE TABLE public.${name} \\([\\s\\S]*?\\n\\);`))[0];
async function fixture(){
 const db=new PGlite({extensions:{pg_trgm}});
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 CREATE TABLE auth.users(id uuid PRIMARY KEY);
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,username text,is_verified boolean);
 CREATE TYPE public.difficulty_type AS ENUM ('EXPERT','MASTER','ULTIMA','WORLDS_END');
 CREATE TYPE public.music_category AS ENUM ('Original','Gekimai','Touhou','Variety','VOCALOID','Other');
 CREATE TYPE public.chart_status AS ENUM ('draft','published','unpublished');
 ${table('charts')} ${table('tags')} ${table('chart_tags')} ${table('chart_tag_votes')}
 ALTER TABLE public.charts ENABLE ROW LEVEL SECURITY;
 CREATE POLICY charts_select_published ON public.charts FOR SELECT USING(status='published' OR auth.uid()=user_id);
 ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
 CREATE POLICY tags_select_all ON public.tags FOR SELECT USING(true);
 GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
 GRANT SELECT ON public.charts,public.profiles,public.tags,public.chart_tags TO anon,authenticated;
 INSERT INTO auth.users VALUES('${a}'),('${b}');
 INSERT INTO public.profiles VALUES('${a}','A',false),('${b}','B',false);
 INSERT INTO public.charts(id,user_id,title,composer,charter_name,rating,status) VALUES
 ('${chart}','${a}','Song','Composer','A',13,'published'),('${draft}','${b}','Private','Composer','B',12,'draft');
 INSERT INTO public.tags(id,name) VALUES(1,'Tech'),(2,' tech '),(3,'TECH'),(4,'高難度'),(5,'地力譜');
 SELECT setval('public.tags_id_seq',5);
 INSERT INTO public.chart_tags VALUES('${chart}',2),('${chart}',3),('${chart}',4),('${draft}',3);
 INSERT INTO public.chart_tag_votes VALUES('${chart}',1,'${a}'),('${chart}',2,'${a}'),('${chart}',3,'${b}');
 ${init.slice(init.indexOf('CREATE FUNCTION public.search_charts('),init.indexOf('$$;',init.indexOf('CREATE FUNCTION public.search_charts('))+3)}
 `);return db;
}
async function snapshot(db){return (await db.query(`SELECT json_build_object('tags',(SELECT json_agg(t ORDER BY id) FROM public.tags t),
 'relations',(SELECT json_agg(ct ORDER BY chart_id,tag_id) FROM public.chart_tags ct),
 'votes',(SELECT json_agg(v ORDER BY chart_id,tag_id,user_id) FROM public.chart_tag_votes v),
 'charts',(SELECT json_agg(c ORDER BY id) FROM public.charts c),'profiles',(SELECT json_agg(p ORDER BY id) FROM public.profiles p)) data`)).rows[0].data;}
(async()=>{
 const lifetime=new PGlite();
 await lifetime.exec('BEGIN; CREATE TEMP TABLE tag_canonical_map ON COMMIT DROP AS SELECT 1 id;');
 assert.equal((await lifetime.query('SELECT id FROM tag_canonical_map')).rows[0].id,1);
 await lifetime.exec('ROLLBACK');
 await lifetime.exec('CREATE TEMP TABLE tag_canonical_map ON COMMIT DROP AS SELECT 1 id;');
 await assert.rejects(()=>lifetime.query('SELECT id FROM tag_canonical_map'),e=>e.code==='42P01');
 await lifetime.close();
 const db=await fixture();const before=await snapshot(db);
 await db.exec(migration);
 await db.exec(fs.readFileSync('supabase/migrations/20261006_chart_tag_autocomplete.sql','utf8'));
 await db.exec("INSERT INTO public.tags(name) VALUES('voca'),('vocal'),('vocaloid'),('xxvoca'),('tag%literal'),('tag_literal');");
 const suggested=(await db.query("SELECT * FROM public.search_chart_tags(' VOCA ',10)")).rows;
 assert.equal(suggested[0].name,'voca');assert.equal(suggested.at(-1).name,'xxvoca');
 assert.equal((await db.query("SELECT * FROM public.search_chart_tags('%',20)")).rows.length,1);
 assert.equal((await db.query("SELECT * FROM public.search_chart_tags('_',20)")).rows.length,1);
 assert.equal((await db.query("SELECT * FROM public.search_chart_tags('',20)")).rows.length,0);
 assert.equal((await db.query("SELECT * FROM public.search_chart_tags('voca',1)")).rows.length,1);
 await db.exec("INSERT INTO public.tags(name) SELECT 'loadtest'||lpad(i::text,6,'0') FROM generate_series(1,100000) i; ANALYZE public.tags;");
 const started=Date.now();
 assert.equal((await db.query("SELECT * FROM public.search_chart_tags('loadtest099',999)")).rows.length,20);
 console.log(`100,000-tag fixture: bounded result (20 max), selective search ${Date.now()-started}ms in local PostgreSQL WASM; not a production benchmark.`);
 await db.exec("DELETE FROM public.tags WHERE name LIKE 'loadtest%';");
 await db.exec("DELETE FROM public.tags WHERE name IN ('voca','vocal','vocaloid','xxvoca','tag%literal','tag_literal');");
 const after=await snapshot(db);
 assert.deepEqual(after.charts,before.charts);assert.deepEqual(after.profiles,before.profiles);
 assert.deepEqual(after.tags.map(t=>[t.id,t.name]),[[1,'tech'],[4,'高難度']]);
 assert.equal(after.relations.length,3);assert.equal(after.votes.length,2);
 assert.ok(after.relations.some(r=>r.chart_id===draft&&r.tag_id===1));
 assert.deepEqual(after.votes.map(v=>v.user_id).sort(),[a,b]);
 assert.equal((await db.query("SELECT to_regclass('public.tag_canonical_map') AS name")).rows[0].name,null);
 const funcs=(await db.query("SELECT pronargs FROM pg_proc WHERE proname='search_charts'")).rows;
 assert.deepEqual(funcs,[{pronargs:8}]);
 for(const role of ['anon','authenticated']){
  await db.exec(`SET ROLE ${role}`);
  assert.equal((await db.query("SELECT * FROM public.search_chart_tags('tech',10)")).rows.length,1);
  assert.equal((await db.query('SELECT * FROM public.search_charts()')).rows.length,1);
  assert.equal((await db.query("SELECT * FROM public.search_charts(query=>'高難度',tag_filter=>4)")).rows.length,1);
  assert.equal((await db.query('SELECT * FROM public.search_charts(tag_filter=>99)')).rows.length,0);
  assert.equal((await db.query("SELECT * FROM public.search_charts(diff=>'EXPERT')")).rows.length,0);
  assert.equal((await db.query('SELECT * FROM public.search_charts(min_r=>14,max_r=>16)')).rows.length,0);
  assert.equal((await db.query('SELECT * FROM public.search_charts(page_offset=>1)')).rows.length,0);
  await db.exec('RESET ROLE');
 }
 await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${a}',false)`);
 await db.query(`SELECT public.set_chart_tags('${chart}',ARRAY['耐力','Tech','TECH'])`);
 await assert.rejects(()=>db.query(`SELECT public.set_chart_tags('${draft}',ARRAY['bad'])`));
 await db.exec('RESET ROLE');
 assert.equal((await db.query(`SELECT status FROM public.charts WHERE id='${chart}'`)).rows[0].status,'published');
 await db.close();
 const rollback=await fixture();const original=await snapshot(rollback);
 const fail=migration.replace("NOTIFY pgrst, 'reload schema';","SELECT 1/0;\nNOTIFY pgrst, 'reload schema';");
 await assert.rejects(()=>rollback.exec(fail));await rollback.exec('ROLLBACK');
 assert.deepEqual(await snapshot(rollback),original);
 assert.deepEqual((await rollback.query("SELECT pronargs FROM pg_proc WHERE proname='search_charts'")).rows,[{pronargs:7}]);
 await rollback.close();
 console.log('PASS: temporary table survives explicit transaction but reproduces 42P01 after autocommit; full PostgreSQL migration, duplicate canonicalization, relation/vote preservation, anon/authenticated search, tag/query/difficulty/rating/pagination, RPC ownership, published status, forced late failure full rollback and old RPC restoration.');
})().catch(e=>{console.error(e);process.exitCode=1});
