-- New migration only. Requires the already-applied custom chart tags migration.
BEGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
-- Existing installations may have pg_trgm in a different schema.
DO $$ DECLARE extension_schema text;
BEGIN
 SELECT n.nspname INTO extension_schema FROM pg_extension e
 JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm';
 EXECUTE format('CREATE INDEX IF NOT EXISTS tags_autocomplete_trgm_idx ON public.tags USING gin (name %I.gin_trgm_ops)',extension_schema);
END $$;
CREATE INDEX IF NOT EXISTS chart_tags_tag_chart_idx ON public.chart_tags(tag_id,chart_id);

CREATE FUNCTION public.search_chart_tags(search_query text, result_limit integer DEFAULT 10)
RETURNS TABLE(id integer,name text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 WITH input AS (
   SELECT public.normalize_chart_tag(coalesce(search_query,'')) q,
          greatest(1,least(coalesce(result_limit,10),20)) lim
 ), matches AS (
   SELECT t.id,t.name,
     CASE WHEN t.name=i.q THEN 0 WHEN starts_with(t.name,i.q) THEN 1 ELSE 2 END match_rank
   FROM public.tags t CROSS JOIN input i
   -- Escape LIKE metacharacters: input is literal text, not a wildcard pattern.
   WHERE char_length(i.q) BETWEEN 1 AND 20
     AND t.name LIKE '%' || replace(replace(replace(i.q, E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') || '%' ESCAPE E'\\'
 )
 SELECT m.id,m.name FROM matches m
 ORDER BY m.match_rank,
   (SELECT count(*) FROM public.chart_tags ct JOIN public.charts c ON c.id=ct.chart_id
     WHERE ct.tag_id=m.id AND c.status='published') DESC,
   m.name,m.id
 LIMIT (SELECT lim FROM input);
$$;
REVOKE ALL ON FUNCTION public.search_chart_tags(text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_chart_tags(text,integer) TO anon,authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
