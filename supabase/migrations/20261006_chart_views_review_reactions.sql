-- Run this new migration in Supabase SQL Editor, once initialization is complete.
-- Historical view_count, reviews, and helpful rows are preserved. No Storage/Auth changes.
BEGIN;

CREATE TABLE IF NOT EXISTS public.chart_views (
  chart_id uuid NOT NULL REFERENCES public.charts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chart_id, user_id)
);
ALTER TABLE public.chart_views ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chart_views FROM PUBLIC, anon, authenticated;
-- Only the RPC writes this private ledger; browsers cannot impersonate viewers.

CREATE OR REPLACE FUNCTION public.record_chart_view(chart_uuid uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE viewer uuid := auth.uid(); total integer; inserted integer;
BEGIN
  IF viewer IS NULL THEN RAISE EXCEPTION 'Login required' USING ERRCODE = '42501'; END IF;
  SELECT c.view_count INTO total FROM public.charts c
    WHERE c.id = chart_uuid AND (c.status = 'published' OR c.user_id = viewer)
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chart unavailable' USING ERRCODE = '42501'; END IF;
  -- Draft/unpublished owner previews retain the existing count without incrementing.
  IF NOT EXISTS (SELECT 1 FROM public.charts c WHERE c.id = chart_uuid AND c.status = 'published') THEN
    RETURN total;
  END IF;
  INSERT INTO public.chart_views(chart_id, user_id) VALUES (chart_uuid, viewer)
    ON CONFLICT (chart_id, user_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 1 THEN
    UPDATE public.charts SET view_count = coalesce(view_count, 0) + 1
      WHERE id = chart_uuid RETURNING view_count INTO total;
  END IF;
  RETURN total;
END;
$$;
-- Preserve the old signature while removing the old non-unique counting path.
CREATE OR REPLACE FUNCTION public.increment_view(chart_uuid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN PERFORM public.record_chart_view(chart_uuid); END;
$$;
REVOKE ALL ON FUNCTION public.record_chart_view(uuid), public.increment_view(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_chart_view(uuid), public.increment_view(uuid) TO authenticated;

ALTER TABLE public.review_helpful ADD COLUMN IF NOT EXISTS reaction text NOT NULL DEFAULT 'like';
-- Existing helpful rows become likes without deleting or replacing any votes.
ALTER TABLE public.review_helpful DROP CONSTRAINT IF EXISTS review_helpful_reaction_check;
ALTER TABLE public.review_helpful ADD CONSTRAINT review_helpful_reaction_check CHECK (reaction IN ('like', 'dislike'));
-- The initialized PRIMARY KEY(review_id,user_id) remains the uniqueness guarantee.
ALTER TABLE public.review_helpful ALTER COLUMN user_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS helpful_own ON public.review_helpful;
DROP POLICY IF EXISTS helpful_select_all ON public.review_helpful;
DROP POLICY IF EXISTS reactions_read ON public.review_helpful;
DROP POLICY IF EXISTS reactions_insert ON public.review_helpful;
DROP POLICY IF EXISTS reactions_update ON public.review_helpful;
DROP POLICY IF EXISTS reactions_delete ON public.review_helpful;
CREATE POLICY reactions_read ON public.review_helpful FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.reviews r JOIN public.charts c ON c.id = r.chart_id
    WHERE r.id = review_id AND (c.status = 'published' OR c.user_id = auth.uid())));
CREATE POLICY reactions_insert ON public.review_helpful FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.reviews r JOIN public.charts c ON c.id = r.chart_id
    WHERE r.id = review_id AND (c.status = 'published' OR c.user_id = auth.uid())));
CREATE POLICY reactions_update ON public.review_helpful FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND EXISTS
    (SELECT 1 FROM public.reviews r JOIN public.charts c ON c.id = r.chart_id
      WHERE r.id = review_id AND (c.status = 'published' OR c.user_id = auth.uid())));
CREATE POLICY reactions_delete ON public.review_helpful FOR DELETE TO authenticated USING (user_id = auth.uid());
ALTER TABLE public.review_helpful ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.review_helpful FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.review_helpful TO anon, authenticated;
GRANT INSERT (review_id, reaction), UPDATE (reaction) ON public.review_helpful TO authenticated;
GRANT DELETE ON public.review_helpful TO authenticated;

CREATE OR REPLACE FUNCTION public.get_review_reactions(review_ids uuid[])
RETURNS TABLE(review_id uuid, like_count bigint, dislike_count bigint, my_reaction text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT r.id, count(h.user_id) FILTER (WHERE h.reaction = 'like'),
    count(h.user_id) FILTER (WHERE h.reaction = 'dislike'),
    max(h.reaction) FILTER (WHERE h.user_id = auth.uid())
  FROM public.reviews r JOIN public.charts c ON c.id = r.chart_id
  LEFT JOIN public.review_helpful h ON h.review_id = r.id
  WHERE r.id = ANY(review_ids) AND cardinality(review_ids) <= 100
    AND (c.status = 'published' OR c.user_id = auth.uid())
  GROUP BY r.id;
$$;

CREATE OR REPLACE FUNCTION public.toggle_review_reaction(review_uuid uuid, requested_reaction text)
RETURNS TABLE(review_id uuid, like_count bigint, dislike_count bigint, my_reaction text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE viewer uuid := auth.uid(); previous text;
BEGIN
  IF viewer IS NULL THEN RAISE EXCEPTION 'Login required' USING ERRCODE = '42501'; END IF;
  IF requested_reaction IS NULL OR requested_reaction NOT IN ('like', 'dislike') THEN
    RAISE EXCEPTION 'Invalid reaction' USING ERRCODE = '22023';
  END IF;
  -- Serialize toggles on a review; the composite PK also prevents duplicate votes.
  PERFORM r.id FROM public.reviews r JOIN public.charts c ON c.id = r.chart_id
    WHERE r.id = review_uuid AND (c.status = 'published' OR c.user_id = viewer) FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review unavailable' USING ERRCODE = '42501'; END IF;
  SELECT h.reaction INTO previous FROM public.review_helpful h
    WHERE h.review_id = review_uuid AND h.user_id = viewer;
  IF previous = requested_reaction THEN
    DELETE FROM public.review_helpful h WHERE h.review_id = review_uuid AND h.user_id = viewer;
  ELSE
    INSERT INTO public.review_helpful AS h(review_id, user_id, reaction)
      VALUES (review_uuid, viewer, requested_reaction)
      ON CONFLICT ON CONSTRAINT review_helpful_pkey DO UPDATE SET reaction = EXCLUDED.reaction;
  END IF;
  RETURN QUERY SELECT * FROM public.get_review_reactions(ARRAY[review_uuid]);
END;
$$;
REVOKE ALL ON FUNCTION public.get_review_reactions(uuid[]), public.toggle_review_reaction(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_review_reactions(uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_review_reaction(uuid,text) TO authenticated;
-- reviews.measure_number and helpful_count remain as historical columns; the UI no longer uses them.
NOTIFY pgrst, 'reload schema';
COMMIT;
