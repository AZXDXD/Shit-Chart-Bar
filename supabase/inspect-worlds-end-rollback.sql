-- READ ONLY. No DDL, DML, privilege changes, or transaction commands.
-- Expected after rollback: no WE columns; rating numeric(4,1) NOT NULL;
-- original rating check; old eight-input RPC present; new ten-input RPC absent.
SELECT column_name, data_type, numeric_precision, numeric_scale, is_nullable
FROM information_schema.columns
WHERE table_schema='public' AND table_name='charts'
  AND column_name IN ('rating','we_star_level','we_attribute')
ORDER BY column_name;

SELECT
  NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='charts' AND column_name='we_star_level') AS no_we_star_level,
  NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='charts' AND column_name='we_attribute') AS no_we_attribute,
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='charts' AND column_name='rating'
      AND data_type='numeric' AND numeric_precision=4 AND numeric_scale=1 AND is_nullable='NO') AS original_rating_type_and_not_null,
  to_regprocedure('public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer)') IS NOT NULL AS old_eight_input_rpc_exists,
  to_regprocedure('public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer,integer,text)') IS NULL AS no_new_ten_input_rpc;

SELECT conname, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_catalog.pg_constraint
WHERE conrelid=to_regclass('public.charts')
  AND conname IN ('charts_rating_check','charts_we_metadata_check')
ORDER BY conname;

SELECT p.oid::regprocedure AS signature, pg_get_userbyid(p.proowner) AS owner,
       pg_get_function_arguments(p.oid) AS arguments, p.proacl,
       pg_get_functiondef(p.oid) AS definition
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname='search_charts'
ORDER BY p.oid;

SELECT p.oid::regprocedure AS signature,
       CASE WHEN x.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(x.grantee) END AS grantee,
       pg_get_userbyid(x.grantor) AS grantor, x.privilege_type, x.is_grantable
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
WHERE n.nspname='public' AND p.proname='search_charts'
ORDER BY p.oid, grantee;

SELECT relrowsecurity, relforcerowsecurity
FROM pg_catalog.pg_class WHERE oid=to_regclass('public.charts');
