-- Review and run ONLY this new migration in Supabase SQL Editor.
-- Existing chart totals are historical baselines: never recalculate or reset them.
BEGIN;

-- Prevent concurrent legacy INSERTs while deduplicating and replacing its write path.
LOCK TABLE public.downloads IN ACCESS EXCLUSIVE MODE;
DROP TRIGGER IF EXISTS downloads_count_trigger ON public.downloads;
-- Keep the earliest id for each known account/chart. Anonymous historical rows remain.
-- Only redundant log rows are removed; charts.download_count is untouched.
DELETE FROM public.downloads d USING public.downloads earlier
  WHERE d.user_id IS NOT NULL AND d.user_id = earlier.user_id
    AND d.chart_id = earlier.chart_id AND d.id > earlier.id;
CREATE UNIQUE INDEX IF NOT EXISTS downloads_user_chart_unique
  ON public.downloads(user_id, chart_id);

ALTER TABLE public.downloads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS downloads_insert_all ON public.downloads;
-- RLS defaults to deny writes. The existing own-row SELECT policy remains.
REVOKE ALL ON public.downloads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.downloads TO authenticated;
REVOKE ALL ON SEQUENCE public.downloads_id_seq FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.update_download_count() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_chart_download(target_chart uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE downloader uuid := auth.uid(); total integer; chart_status public.chart_status;
  inserted integer;
BEGIN
  SELECT c.download_count, c.status INTO total, chart_status
    FROM public.charts c
    WHERE c.id = target_chart AND (c.status = 'published' OR c.user_id = downloader)
      AND c.package_path IS NOT NULL
      AND split_part(c.package_path, '/', 1) = c.user_id::text
      AND split_part(c.package_path, '/', 2) = c.id::text
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Chart unavailable for download' USING ERRCODE = '42501'; END IF;
  -- Guests may download published packages; owner previews do not add public statistics.
  IF downloader IS NULL OR chart_status <> 'published' THEN RETURN total; END IF;
  INSERT INTO public.downloads(user_id, chart_id) VALUES (downloader, target_chart)
    ON CONFLICT (user_id, chart_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  IF inserted = 1 THEN
    UPDATE public.charts SET download_count = coalesce(download_count, 0) + 1
      WHERE id = target_chart RETURNING download_count INTO total;
  END IF;
  RETURN total;
END;
$$;
REVOKE ALL ON FUNCTION public.record_chart_download(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_chart_download(uuid) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
