-- Run inspect-custom-chart-tags.sql first. This transaction aborts on invalid
-- legacy names or charts over the new limit; no chart associations are discarded.
BEGIN;
LOCK TABLE public.tags, public.chart_tags, public.chart_tag_votes IN ACCESS EXCLUSIVE MODE;

CREATE OR REPLACE FUNCTION public.normalize_chart_tag(value text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = pg_catalog AS $$
  SELECT translate(regexp_replace(value, '^[[:space:]]+|[[:space:]]+$', '', 'g'),
                   'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz');
$$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.tags WHERE char_length(public.normalize_chart_tag(name)) NOT BETWEEN 1 AND 20) THEN
    RAISE EXCEPTION 'Invalid legacy tag names. Inspect and resolve before migration.';
  END IF;
  IF EXISTS (SELECT ct.chart_id FROM public.chart_tags ct JOIN public.tags t ON t.id=ct.tag_id
    GROUP BY ct.chart_id HAVING count(DISTINCT public.normalize_chart_tag(t.name))>10) THEN
    RAISE EXCEPTION 'Legacy charts exceed 10 tags. Inspect and resolve before migration.';
  END IF;
END $$;

-- Only remove unused seeded dictionary entries; preserve associated/voted tags.
DELETE FROM public.tags t WHERE t.name IN
 ('地力譜','手速考驗','配置譜','演出譜','創意極佳','認識考驗','初心者友善','爆手風險','VOCALOID','東方系列')
 AND NOT EXISTS (SELECT 1 FROM public.chart_tags ct WHERE ct.tag_id=t.id)
 AND NOT EXISTS (SELECT 1 FROM public.chart_tag_votes v WHERE v.tag_id=t.id);

-- Each statement owns its CTE: no temporary relation/session lifetime dependency.
-- tags remain unchanged until every relation has been copied and cleaned up,
-- so each CTE computes exactly the same smallest-ID canonical mapping.
WITH tag_canonical_map AS (
 SELECT id, min(id) OVER (PARTITION BY public.normalize_chart_tag(name)) AS canonical_id FROM public.tags
)
INSERT INTO public.chart_tags(chart_id,tag_id)
 SELECT ct.chart_id,m.canonical_id FROM public.chart_tags ct JOIN tag_canonical_map m ON m.id=ct.tag_id
 ON CONFLICT DO NOTHING;
WITH tag_canonical_map AS (
 SELECT id, min(id) OVER (PARTITION BY public.normalize_chart_tag(name)) AS canonical_id FROM public.tags
)
INSERT INTO public.chart_tag_votes(chart_id,tag_id,user_id)
 SELECT v.chart_id,m.canonical_id,v.user_id FROM public.chart_tag_votes v JOIN tag_canonical_map m ON m.id=v.tag_id
 ON CONFLICT DO NOTHING;
WITH tag_canonical_map AS (
 SELECT id, min(id) OVER (PARTITION BY public.normalize_chart_tag(name)) AS canonical_id FROM public.tags
)
DELETE FROM public.chart_tag_votes v USING tag_canonical_map m WHERE v.tag_id=m.id AND m.id<>m.canonical_id;
WITH tag_canonical_map AS (
 SELECT id, min(id) OVER (PARTITION BY public.normalize_chart_tag(name)) AS canonical_id FROM public.tags
)
DELETE FROM public.chart_tags ct USING tag_canonical_map m WHERE ct.tag_id=m.id AND m.id<>m.canonical_id;
WITH tag_canonical_map AS (
 SELECT id, min(id) OVER (PARTITION BY public.normalize_chart_tag(name)) AS canonical_id FROM public.tags
)
DELETE FROM public.tags t USING tag_canonical_map m WHERE t.id=m.id AND m.id<>m.canonical_id;
UPDATE public.tags SET name=public.normalize_chart_tag(name);
CREATE UNIQUE INDEX IF NOT EXISTS tags_normalized_name_unique ON public.tags(public.normalize_chart_tag(name));
ALTER TABLE public.tags ADD CONSTRAINT tags_custom_name_valid
 CHECK (name=public.normalize_chart_tag(name) AND char_length(name) BETWEEN 1 AND 20);

-- Clients cannot bypass atomic ownership and count checks with direct writes.
REVOKE INSERT,UPDATE,DELETE ON public.tags,public.chart_tags,public.chart_tag_votes FROM PUBLIC,anon,authenticated;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chart_tags_manage_own ON public.chart_tags;
DROP POLICY IF EXISTS chart_tags_select_all ON public.chart_tags;
CREATE POLICY chart_tags_select_all ON public.chart_tags FOR SELECT
 USING (EXISTS (SELECT 1 FROM public.charts c WHERE c.id=chart_id));

CREATE OR REPLACE FUNCTION public.set_chart_tags(target_chart uuid, tag_names text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE names text[]; owner_id uuid; tag_name text; dictionary_id integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Login required' USING ERRCODE='42501'; END IF;
  SELECT user_id INTO owner_id FROM public.charts WHERE id=target_chart FOR UPDATE;
  IF owner_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Chart ownership required' USING ERRCODE='42501'; END IF;
  IF tag_names IS NULL OR EXISTS (SELECT 1 FROM unnest(tag_names) n
    WHERE n IS NULL OR char_length(public.normalize_chart_tag(n)) NOT BETWEEN 1 AND 20) THEN
    RAISE EXCEPTION 'Tags must contain 1 to 20 characters';
  END IF;
  SELECT coalesce(array_agg(n ORDER BY n),ARRAY[]::text[]) INTO names
    FROM (SELECT DISTINCT public.normalize_chart_tag(value) n FROM unnest(tag_names) value) normalized;
  IF cardinality(names)>10 THEN RAISE EXCEPTION 'At most 10 tags per chart'; END IF;
  -- Sorted dictionary writes prevent reversed tag order deadlocks across charts.
  DELETE FROM public.chart_tags WHERE chart_id=target_chart;
  FOREACH tag_name IN ARRAY names LOOP
    INSERT INTO public.tags(name) VALUES(tag_name) ON CONFLICT DO NOTHING;
    SELECT id INTO dictionary_id FROM public.tags WHERE name=tag_name;
    INSERT INTO public.chart_tags(chart_id,tag_id) VALUES(target_chart,dictionary_id);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.set_chart_tags(uuid,text[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_chart_tags(uuid,text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.popular_chart_tags()
RETURNS TABLE(id integer,name text) LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT t.id,t.name FROM public.tags t JOIN public.chart_tags ct ON ct.tag_id=t.id
 JOIN public.charts c ON c.id=ct.chart_id WHERE c.status='published'
 GROUP BY t.id,t.name ORDER BY count(*) DESC,t.name LIMIT 20;
$$;
REVOKE ALL ON FUNCTION public.popular_chart_tags() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.popular_chart_tags() TO anon,authenticated;

DROP FUNCTION public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer);
CREATE FUNCTION public.search_charts(
  query TEXT DEFAULT '',
  diff  difficulty_type DEFAULT NULL,
  min_r NUMERIC DEFAULT 1.0,
  max_r NUMERIC DEFAULT 16.0,
  sort_by TEXT DEFAULT 'published_at',
  page_limit INTEGER DEFAULT 20,
  page_offset INTEGER DEFAULT 0,
  tag_filter INTEGER DEFAULT NULL
)
RETURNS TABLE (
  id UUID, title TEXT, composer TEXT, charter_name TEXT,
  difficulty difficulty_type, rating NUMERIC, bpm SMALLINT,
  music_category music_category, cover_path TEXT, strip_path TEXT, package_path TEXT,
  package_size_mb NUMERIC, avg_rating NUMERIC, review_count INTEGER,
  download_count INTEGER, view_count INTEGER, published_at TIMESTAMPTZ,
  user_id UUID, username TEXT, is_verified BOOLEAN
) LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.title, c.composer, c.charter_name, c.difficulty, c.rating,
         c.bpm, c.music_category, c.cover_path, c.strip_path, c.package_path, c.package_size_mb,
         c.avg_rating, c.review_count, c.download_count, c.view_count, c.published_at,
         p.id, p.username, p.is_verified
  FROM public.charts c
  JOIN public.profiles p ON p.id = c.user_id
  WHERE c.status = 'published'
    AND c.rating BETWEEN min_r AND max_r
    AND (diff IS NULL OR c.difficulty = diff)
    AND (tag_filter IS NULL OR EXISTS (SELECT 1 FROM public.chart_tags ct WHERE ct.chart_id=c.id AND ct.tag_id=tag_filter))
    AND (query = '' OR c.title ILIKE '%' || query || '%'
                    OR c.composer ILIKE '%' || query || '%'
                    OR c.charter_name ILIKE '%' || query || '%'
                    OR EXISTS (SELECT 1 FROM public.chart_tags ct JOIN public.tags t ON t.id=ct.tag_id
                      WHERE ct.chart_id=c.id AND t.name ILIKE '%' || query || '%'))
  ORDER BY
    CASE sort_by
      WHEN 'avg_rating'      THEN c.avg_rating
      WHEN 'download_count'  THEN c.download_count::NUMERIC
      WHEN 'rating_desc'     THEN c.rating
      ELSE NULL
    END DESC NULLS LAST,
    CASE WHEN sort_by = 'published_at' OR sort_by IS NULL THEN c.published_at END DESC
  LIMIT page_limit OFFSET page_offset;
END;
$$;
REVOKE ALL ON FUNCTION public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer,integer) TO anon,authenticated;
-- Delivered only after the migration commits successfully.
NOTIFY pgrst, 'reload schema';
COMMIT;

