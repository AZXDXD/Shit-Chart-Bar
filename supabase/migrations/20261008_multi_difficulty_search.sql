-- NEW incremental migration. Review and deploy manually; never rerun older migrations.
-- Clone the deployed ten-argument RPC's fields and filter logic into a JSON page envelope.
-- Always return {charts: [], total_count: N}, even beyond the last page.
-- Abort atomically if the inspected clauses differ. The original RPC is never changed.
BEGIN;
DO $migration$
DECLARE
  source_oid oid := to_regprocedure('public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer,integer,text)');
  new_signature text := 'public.search_charts_multi(text,public.difficulty_type[],numeric,numeric,text,integer,integer,integer,integer,text)';
  definition text; old_owner text; old_acl aclitem[]; grant_row record;
  patterns text[]; replacements text[]; step integer; matches integer;
  page_pattern text; captured text[]; query_sql text; order_sql text;
  column_names text; envelope text;
BEGIN
  IF source_oid IS NULL OR to_regprocedure(new_signature) IS NOT NULL THEN
    RAISE EXCEPTION 'Expected existing ten-argument search_charts and absent search_charts_multi; inspect before deployment';
  END IF;
  IF (SELECT prosecdef FROM pg_proc WHERE oid=source_oid)
     OR (SELECT prolang FROM pg_proc WHERE oid=source_oid) <> (SELECT oid FROM pg_language WHERE lanname='plpgsql')
     OR (SELECT proargnames[1:10] FROM pg_proc WHERE oid=source_oid)
       IS DISTINCT FROM ARRAY['query','diff','min_r','max_r','sort_by','page_limit','page_offset','tag_filter','we_star_filter','we_attribute_filter']::text[] THEN
    RAISE EXCEPTION 'Unexpected search RPC security or parameter names';
  END IF;
  SELECT pg_get_functiondef(oid), pg_get_userbyid(proowner), coalesce(proacl,acldefault('f',proowner))
    INTO definition, old_owner, old_acl FROM pg_proc WHERE oid=source_oid;
  SELECT string_agg(quote_ident(name), ', ' ORDER BY ordinal)
    INTO column_names FROM pg_proc p,
    LATERAL unnest(p.proargnames,p.proargmodes) WITH ORDINALITY AS a(name,mode,ordinal)
    WHERE p.oid=source_oid AND a.mode='t';
  IF column_names IS NULL OR column_names LIKE '%__search_order%' THEN
    RAISE EXCEPTION 'Expected table-returning original search RPC without internal ordering column';
  END IF;
  patterns := ARRAY[
    'FUNCTION public\.search_charts\(',
    'diff (public\.)?difficulty_type DEFAULT NULL::(public\.)?difficulty_type',
    'RETURNS TABLE\([^)]*\)',
    'diff IS NULL OR c\.difficulty = diff',
    'diff IS NULL OR diff::text <> ''WORLDS_END'' OR'
  ];
  replacements := ARRAY[
    'FUNCTION public.search_charts_multi(',
    'diffs public.difficulty_type[] DEFAULT NULL::public.difficulty_type[]',
    'RETURNS jsonb',
    'coalesce(cardinality(diffs),0)=0 OR c.difficulty = ANY(diffs)',
    ''
  ];
  FOR step IN 1..array_length(patterns,1) LOOP
    SELECT count(*) INTO matches FROM regexp_matches(definition,patterns[step],'g');
    IF matches<>1 THEN
      RAISE EXCEPTION 'Multi-search step % expected one match, found %. No changes applied; inspect deployed function',step,matches;
    END IF;
    definition := regexp_replace(definition,patterns[step],replacements[step]);
  END LOOP;
  IF definition !~ 'tag_filter' OR definition !~ 'ILIKE'
     OR definition !~ 'we_star_filter' OR definition !~ 'we_attribute_filter'
     OR definition !~ 'min_r' OR definition !~ 'max_r' OR definition !~ 'sort_by'
     OR definition ~ '\mdiff\M' THEN
    RAISE EXCEPTION 'Unexpected transformed search definition';
  END IF;
  -- Capture the original query and ORDER BY. Explicit output names preserve p.id
  -- as user_id and every original return field without ambiguous duplicate IDs.
  page_pattern := '(RETURN QUERY\s+(SELECT[\s\S]*?)\s+ORDER BY\s+([\s\S]*?)\s+LIMIT page_limit OFFSET page_offset;)';
  SELECT count(*) INTO matches FROM regexp_matches(definition,page_pattern,'g');
  IF matches<>1 THEN RAISE EXCEPTION 'Expected exactly one paginated RETURN QUERY'; END IF;
  captured := regexp_match(definition,page_pattern);
  query_sql := captured[2]; order_sql := captured[3];
  SELECT count(*) INTO matches FROM regexp_matches(query_sql,'\s+FROM public\.charts c','g');
  IF matches<>1 THEN RAISE EXCEPTION 'Unexpected charts source in deployed query'; END IF;
  query_sql := regexp_replace(query_sql,'\s+FROM public\.charts c',
    ', row_number() OVER (ORDER BY '||order_sql||', c.id ASC) AS __search_order FROM public.charts c');
  envelope := 'IF page_limit IS NULL OR page_limit < 1 OR page_offset IS NULL OR page_offset < 0 THEN
    RAISE EXCEPTION ''Invalid search pagination'' USING ERRCODE = ''22023'';
  END IF;
  RETURN (WITH matched('||column_names||', __search_order) AS MATERIALIZED ('||query_sql||'),
    page_rows AS (SELECT * FROM matched ORDER BY __search_order LIMIT page_limit OFFSET page_offset)
    SELECT jsonb_build_object(
      ''total_count'', (SELECT count(*) FROM matched),
      ''charts'', coalesce((SELECT jsonb_agg(to_jsonb(page_rows)-''__search_order'' ORDER BY __search_order)
                           FROM page_rows), ''[]''::jsonb)) );';
  definition := replace(definition,captured[1],envelope);
  EXECUTE definition;
  EXECUTE 'ALTER FUNCTION '||new_signature||' OWNER TO '||quote_ident(old_owner);
  -- Remove default grants and copy the original effective EXECUTE permissions.
  EXECUTE 'REVOKE ALL ON FUNCTION '||new_signature||' FROM PUBLIC';
  FOR grant_row IN SELECT DISTINCT x.grantee FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
    WHERE p.oid=to_regprocedure(new_signature) LOOP
    IF grant_row.grantee<>0 THEN
      EXECUTE 'REVOKE ALL ON FUNCTION '||new_signature||' FROM '||quote_ident(pg_get_userbyid(grant_row.grantee));
    END IF;
  END LOOP;
  FOR grant_row IN SELECT grantee,bool_or(is_grantable) AS is_grantable
    FROM aclexplode(old_acl) WHERE privilege_type='EXECUTE' GROUP BY grantee LOOP
    EXECUTE 'GRANT EXECUTE ON FUNCTION '||new_signature||' TO '||
      CASE WHEN grant_row.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_row.grantee)) END||
      CASE WHEN grant_row.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END;
  END LOOP;
END $migration$;
NOTIFY pgrst, 'reload schema';
COMMIT;
