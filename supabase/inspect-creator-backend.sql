-- 唯讀：整份貼入 Supabase SQL Editor，一次 Run。只有一個 WITH ... SELECT。
-- 不查使用者/譜面內容，不變更資料庫，不執行 trigger。
-- 詳細資料為 JSON。policy/權限存在不代表通過 RLS 或實際操作一定成功。
WITH expected(schema_name,table_name,required) AS (
 VALUES ('public','charts',true),('public','profiles',true),('public','tags',true),
 ('public','chart_tags',true),('public','submissions',false),('public','creators',false),
 ('storage','objects',true),('auth','users',true)
), targets AS (
 SELECT e.*,c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity
 FROM expected e LEFT JOIN pg_namespace n ON n.nspname=e.schema_name
 LEFT JOIN pg_class c ON c.relnamespace=n.oid AND c.relname=e.table_name
 AND c.relkind IN ('r','p','v','m','f')
), roles AS (
 SELECT e.role_name,r.oid FROM (VALUES ('authenticated'),('anon')) e(role_name)
 LEFT JOIN pg_roles r ON r.rolname=e.role_name
), report AS (
 SELECT 0 AS sort_order,'執行資訊'::text AS item,current_database()::text AS name,
 '唯讀檢查'::text AS status,jsonb_build_object('role',current_user,'checked_at',statement_timestamp(),
 'expected_relation','public.charts.user_id → public.profiles.id → auth.users.id',
 'note','submissions / creators 是候選名稱；不存在不代表專案有錯') AS details
 UNION ALL
 SELECT 10,'資料表',schema_name||'.'||table_name,
 CASE WHEN oid IS NULL THEN CASE WHEN required THEN '缺少：專案使用' ELSE '不存在：候選名稱' END
 WHEN relkind IN ('r','p') THEN '存在' ELSE '存在但不是一般資料表' END,
 jsonb_build_object('required_by_project',required,'kind',relkind) FROM targets
 UNION ALL
 SELECT 11,'public 物件清單','public','實際部署清單',
 COALESCE(jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind) ORDER BY c.relname),'[]'::jsonb)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')
 UNION ALL
 SELECT 20,'實際欄位',t.schema_name||'.'||t.table_name,
 CASE WHEN t.oid IS NULL THEN '資料表不存在' ELSE '欄位清單' END,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('position',a.attnum,'name',a.attname,
 'type',format_type(a.atttypid,a.atttypmod),'nullable',NOT a.attnotnull,
 'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,
 'owner_or_identity_candidate',a.attname IN ('user_id','creator_id','id')) ORDER BY a.attnum)
 FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb) FROM targets t
 UNION ALL
 SELECT 30,'Constraints / foreign keys',t.schema_name||'.'||t.table_name,
 CASE WHEN t.oid IS NULL THEN '資料表不存在' ELSE '約束清單（可能為空）' END,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('name',k.conname,'type',k.contype,
 'definition',pg_get_constraintdef(k.oid),'validated',k.convalidated,
 'referenced_table',CASE WHEN k.confrelid<>0 THEN k.confrelid::regclass::text END) ORDER BY k.conname)
 FROM pg_constraint k WHERE k.conrelid=t.oid),'[]'::jsonb) FROM targets t
 UNION ALL
 SELECT 40,'RLS',schema_name||'.'||table_name,
 CASE WHEN oid IS NULL THEN '資料表不存在' WHEN relrowsecurity THEN '已啟用' ELSE '未啟用' END,
 jsonb_build_object('enabled',relrowsecurity,'forced',relforcerowsecurity) FROM targets
 UNION ALL
 SELECT 50,'Policies：'||op.command,t.schema_name||'.'||t.table_name,
 CASE WHEN t.oid IS NULL THEN '資料表不存在'
 WHEN EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname=t.schema_name
 AND p.tablename=t.table_name AND p.cmd IN (op.command,'ALL'))
 THEN '有 policy；須核對角色與條件' ELSE '無對應 policy' END,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('name',p.policyname,'command',p.cmd,
 'roles',p.roles,'permissive',p.permissive,'using',p.qual,'with_check',p.with_check) ORDER BY p.policyname)
 FROM pg_policies p WHERE p.schemaname=t.schema_name AND p.tablename=t.table_name
 AND p.cmd IN (op.command,'ALL')),'[]'::jsonb)
 FROM targets t CROSS JOIN (VALUES ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) op(command)
 UNION ALL
 SELECT 60,'Storage bucket',e.bucket,CASE WHEN b.id IS NULL THEN '不存在' ELSE '存在' END,
 CASE WHEN b.id IS NULL THEN '{}'::jsonb ELSE to_jsonb(b) END
 FROM (VALUES ('chart-packages'),('cover-art'),('chart-strips'),('avatars')) e(bucket)
 LEFT JOIN storage.buckets b ON b.id=e.bucket
 UNION ALL
 SELECT 61,'Storage bucket 清單','storage.buckets','全部 bucket 設定',
 COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.id),'[]'::jsonb) FROM storage.buckets b
 UNION ALL
 SELECT 70,'Triggers（含 profile trigger）',t.schema_name||'.'||t.table_name,
 CASE WHEN t.oid IS NULL THEN '資料表不存在'
 WHEN EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid=t.oid AND NOT g.tgisinternal)
 THEN '有 trigger；須核對函式與啟用狀態' ELSE '沒有非內部 trigger' END,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('name',g.tgname,'enabled',g.tgenabled,
 'definition',pg_get_triggerdef(g.oid),'function',g.tgfoid::regprocedure::text,
 'function_definition',pg_get_functiondef(g.tgfoid)) ORDER BY g.tgname)
 FROM pg_trigger g WHERE g.tgrelid=t.oid AND NOT g.tgisinternal),'[]'::jsonb) FROM targets t
 UNION ALL
 SELECT 80,'角色權限：'||r.role_name,t.schema_name||'.'||t.table_name,
 CASE WHEN r.oid IS NULL THEN '角色不存在' WHEN t.oid IS NULL THEN '資料表不存在'
 ELSE '有效權限（仍受 RLS 限制）' END,
 CASE WHEN r.oid IS NULL OR t.oid IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
 'schema_usage',has_schema_privilege(r.oid,t.schema_name,'USAGE'),
 'SELECT',has_table_privilege(r.oid,t.oid,'SELECT'),'INSERT',has_table_privilege(r.oid,t.oid,'INSERT'),
 'UPDATE',has_table_privilege(r.oid,t.oid,'UPDATE'),'DELETE',has_table_privilege(r.oid,t.oid,'DELETE'),
 'columns',(SELECT COALESCE(jsonb_agg(jsonb_build_object('name',a.attname,
 'SELECT',has_column_privilege(r.oid,t.oid,a.attnum,'SELECT'),
 'INSERT',has_column_privilege(r.oid,t.oid,a.attnum,'INSERT'),
 'UPDATE',has_column_privilege(r.oid,t.oid,a.attnum,'UPDATE')) ORDER BY a.attnum),'[]'::jsonb)
 FROM pg_attribute a WHERE a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped)) END
 FROM targets t CROSS JOIN roles r
 UNION ALL
 SELECT 81,'authenticated sequence 權限',n.nspname||'.'||c.relname,
 CASE WHEN r.oid IS NULL THEN '角色不存在' ELSE '有效權限' END,
 CASE WHEN r.oid IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
 'USAGE',has_sequence_privilege(r.oid,c.oid,'USAGE'),
 'SELECT',has_sequence_privilege(r.oid,c.oid,'SELECT'),
 'UPDATE',has_sequence_privilege(r.oid,c.oid,'UPDATE')) END
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_roles r ON r.rolname='authenticated' WHERE n.nspname='public' AND c.relkind='S'
)
SELECT item AS "檢查項目",name AS "名稱",status AS "狀態",details AS "詳細資料"
FROM report ORDER BY sort_order,name,item;
