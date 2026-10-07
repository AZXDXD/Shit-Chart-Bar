-- NEW migration for manual review/execution only. No existing rows are updated.
BEGIN;

-- All changes and saved ACL state live in one atomic procedural statement.
DO $migration$
DECLARE
  old_def text; new_def text; old_owner text; grant_row record; new_signature text;
  old_acl aclitem[];
  patterns text[]; replacements text[]; step integer; matches integer;
BEGIN
  LOCK TABLE public.charts IN ACCESS EXCLUSIVE MODE;
  IF to_regprocedure('public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.charts'::regclass AND conname='charts_rating_check') THEN
    RAISE EXCEPTION 'Expected inspected charts constraint and eight-parameter search_charts; inspect again before proceeding';
  END IF;
  IF EXISTS (SELECT 1 FROM public.charts WHERE difficulty::text='WORLDS_END') THEN
    RAISE EXCEPTION 'WORLD''S END rows appeared since inspection; transaction aborted without converting data';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.charts
    WHERE difficulty IS NULL OR rating IS NULL OR rating < 1
       OR rating::text IN ('NaN','Infinity','-Infinity')
       OR rating <> round(rating,1)
  ) THEN
    RAISE EXCEPTION 'Existing ordinary chart rating violates finite >=1 / one-decimal rules; transaction aborted without changing data';
  END IF;

ALTER TABLE public.charts ADD COLUMN we_star_level smallint NULL;
ALTER TABLE public.charts ADD COLUMN we_attribute text NULL;
-- Unconstrained numeric removes numeric(4,1)'s implicit 999.9 ceiling too.
ALTER TABLE public.charts ALTER COLUMN rating TYPE numeric;
ALTER TABLE public.charts ALTER COLUMN rating DROP NOT NULL;
ALTER TABLE public.charts DROP CONSTRAINT charts_rating_check;
ALTER TABLE public.charts ADD CONSTRAINT charts_rating_check CHECK (
  CASE WHEN difficulty::text='WORLDS_END' THEN rating IS NULL
       ELSE rating IS NOT NULL AND rating >= 1 AND rating::text NOT IN ('NaN','Infinity','-Infinity') AND rating=round(rating,1) END
);
ALTER TABLE public.charts ADD CONSTRAINT charts_we_metadata_check CHECK (
  CASE WHEN difficulty::text='WORLDS_END' THEN
    rating IS NULL
    AND we_star_level IS NOT NULL AND we_star_level BETWEEN 1 AND 5
    AND we_attribute IS NOT NULL
    AND we_attribute=btrim(we_attribute)
    AND char_length(we_attribute) BETWEEN 1 AND 20
  ELSE we_star_level IS NULL AND we_attribute IS NULL END
);
-- ADD CHECK validates existing rows by default; both constraints are validated.

-- Transform the deployed body, rather than overwrite custom-tag functionality
-- with a guessed/old implementation. Abort if the expected clauses changed.
  -- acldefault expands NULL ACL to the original effective owner/PUBLIC grants.
  -- Store the array before DROP; it survives solely as a local variable.
  SELECT pg_get_functiondef(p.oid), pg_get_userbyid(p.proowner),
         coalesce(p.proacl,acldefault('f',p.proowner))
  INTO old_def, old_owner, old_acl FROM pg_proc p
  WHERE p.oid='public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer)'::regprocedure;
  IF old_def NOT ILIKE '%tag_filter%' OR old_def NOT ILIKE '%ILIKE%'
     OR old_def NOT ILIKE '%page_offset%' OR old_def NOT ILIKE '%sort_by%'
     OR (SELECT prosecdef FROM pg_proc WHERE oid='public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer)'::regprocedure) THEN
    RAISE EXCEPTION 'Unexpected search_charts definition; return full inspection before migration';
  END IF;
  IF (SELECT proargnames[1:8] FROM pg_proc WHERE oid='public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer)'::regprocedure)
     IS DISTINCT FROM ARRAY['query','diff','min_r','max_r','sort_by','page_limit','page_offset','tag_filter']::text[] THEN
    RAISE EXCEPTION 'Unexpected deployed RPC parameter names; transaction aborted';
  END IF;
  patterns := ARRAY[
    'tag_filter integer DEFAULT NULL::integer\)',
    'max_r numeric DEFAULT 16(\.0)?(?=,)',
    'is_verified boolean\)',
    'p\.id,\s*p\.username,\s*p\.is_verified',
    'c\.rating BETWEEN min_r AND max_r'
  ];
  replacements := ARRAY[
    'tag_filter integer DEFAULT NULL::integer, we_star_filter integer DEFAULT NULL::integer, we_attribute_filter text DEFAULT NULL::text)',
    'max_r numeric DEFAULT NULL::numeric',
    'is_verified boolean, we_star_level smallint, we_attribute text)',
    'p.id, p.username, p.is_verified, c.we_star_level, c.we_attribute',
    $clause$(
      (c.difficulty::text = 'WORLDS_END' AND
        (diff IS NULL OR diff::text <> 'WORLDS_END' OR
          ((we_star_filter IS NULL OR c.we_star_level=we_star_filter) AND
           (we_attribute_filter IS NULL OR strpos(lower(c.we_attribute),lower(btrim(we_attribute_filter)))>0))))
      OR (c.difficulty::text <> 'WORLDS_END' AND
          (min_r IS NULL OR c.rating>=min_r) AND (max_r IS NULL OR c.rating<=max_r))
    )$clause$
  ];
  new_def := old_def;
  FOR step IN 1..array_length(patterns,1) LOOP
    SELECT count(*) INTO matches FROM regexp_matches(new_def,patterns[step],'g');
    IF matches<>1 THEN
      RAISE EXCEPTION 'Search transformation step % expected exactly one match, found %. Entire transaction aborted; return full function definition', step, matches;
    END IF;
    new_def := regexp_replace(new_def,patterns[step],replacements[step]);
  END LOOP;
  -- All required transformations must be visible before touching the old RPC.
  IF new_def NOT LIKE '%we_star_filter integer%' OR new_def NOT LIKE '%we_attribute text)%'
     OR new_def NOT LIKE '%c.we_star_level, c.we_attribute%'
     OR new_def LIKE '%c.rating BETWEEN min_r AND max_r%'
     OR new_def NOT LIKE '%max_r numeric DEFAULT NULL::numeric%'
     OR new_def NOT LIKE '%strpos(lower(c.we_attribute)%' THEN
    RAISE EXCEPTION 'Search body differs from inspected implementation; transaction rolled back, send full function definition';
  END IF;
  DROP FUNCTION public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer);
  EXECUTE new_def;
  new_signature := 'public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer,integer,text)';
  IF (SELECT proargnames[1:10] FROM pg_proc WHERE oid=to_regprocedure(new_signature))
     IS DISTINCT FROM ARRAY['query','diff','min_r','max_r','sort_by','page_limit','page_offset','tag_filter','we_star_filter','we_attribute_filter']::text[] THEN
    RAISE EXCEPTION 'New RPC parameters do not match frontend; entire transaction aborted';
  END IF;
  EXECUTE 'ALTER FUNCTION '||new_signature||' OWNER TO '||quote_ident(old_owner);
  -- Default privileges may add grants. Restore the original effective ACL.
  EXECUTE 'REVOKE ALL ON FUNCTION '||new_signature||' FROM PUBLIC';
  FOR grant_row IN SELECT DISTINCT x.grantee FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x
    WHERE p.oid=to_regprocedure(new_signature) LOOP
    IF grant_row.grantee<>0 THEN
      EXECUTE 'REVOKE ALL ON FUNCTION '||new_signature||' FROM '||quote_ident(pg_get_userbyid(grant_row.grantee));
    END IF;
  END LOOP;
  FOR grant_row IN SELECT grantee, bool_or(is_grantable) AS is_grantable
    FROM aclexplode(old_acl) WHERE privilege_type='EXECUTE' GROUP BY grantee LOOP
    EXECUTE 'GRANT EXECUTE ON FUNCTION '||new_signature||' TO '||
      CASE WHEN grant_row.grantee=0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(grant_row.grantee)) END||
      CASE WHEN grant_row.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END;
  END LOOP;
  NOTIFY pgrst, 'reload schema';
END $migration$;

COMMIT;
