-- 需要到 Supabase SQL Editor 執行。沿用 schema.sql 的既有 tables / buckets。
-- B. 已部署舊 schema 的升級 migration。Authentication-only 專案請勿執行本檔。
-- 本次新專案只需要 A. initialize-backend.sql；完成 A 後也不用接著執行本檔。
BEGIN;
-- Abort rather than invent a new schema when deployed tables differ from this repository.
DO $$
BEGIN
  IF to_regclass('public.charts') IS NULL OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.tags') IS NULL OR to_regclass('public.chart_tags') IS NULL THEN
    RAISE EXCEPTION 'Existing tables missing. Run inspect-creator-backend.sql and review deployed schema first.';
  END IF;
END;
$$;
ALTER TABLE public.charts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chart_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS charts_select_published ON public.charts;
CREATE POLICY charts_select_published ON public.charts FOR SELECT
  USING (status = 'published' OR auth.uid() = user_id);
DROP POLICY IF EXISTS profiles_select_all ON public.profiles;
CREATE POLICY profiles_select_all ON public.profiles FOR SELECT USING (true);
DROP POLICY IF EXISTS tags_select_all ON public.tags;
CREATE POLICY tags_select_all ON public.tags FOR SELECT USING (true);
DROP POLICY IF EXISTS chart_tags_select_all ON public.chart_tags;
CREATE POLICY chart_tags_select_all ON public.chart_tags FOR SELECT USING (true);
DROP POLICY IF EXISTS chart_tags_manage_own ON public.chart_tags;
CREATE POLICY chart_tags_manage_own ON public.chart_tags FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.charts c WHERE c.id = chart_id AND c.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.charts c WHERE c.id = chart_id AND c.user_id = auth.uid()));
GRANT SELECT ON public.charts, public.profiles, public.tags, public.chart_tags TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.charts TO authenticated;
GRANT INSERT, UPDATE ON public.profiles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.chart_tags TO authenticated;
DROP POLICY IF EXISTS charts_update_own ON public.charts;
CREATE POLICY charts_update_own ON public.charts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS charts_insert_own ON public.charts;
CREATE POLICY charts_insert_own ON public.charts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS charts_delete_own ON public.charts;
CREATE POLICY charts_delete_own ON public.charts FOR DELETE TO authenticated
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);
-- Initial profile only. Never overwrite an existing creator's custom identity.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url, provider, provider_id)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->'custom_claims'->>'global_name',''),
      NULLIF(NEW.raw_user_meta_data->>'global_name',''), NULLIF(NEW.raw_user_meta_data->>'full_name',''),
      NULLIF(NEW.raw_user_meta_data->>'name',''), NULLIF(NEW.raw_user_meta_data->>'user_name',''),
      NULLIF(NEW.raw_user_meta_data->>'preferred_username',''), NULLIF(NEW.raw_user_meta_data->>'username',''),
      NULLIF(NEW.email,''), '使用者'),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'avatar_url',''), NULLIF(NEW.raw_user_meta_data->>'picture','')),
    NEW.raw_app_meta_data->>'provider',
    COALESCE(NEW.raw_user_meta_data->>'provider_id', NEW.raw_user_meta_data->>'sub')
  ) ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
-- Existing Auth users may predate the profile trigger. Fill missing rows only.
INSERT INTO public.profiles (id, username, avatar_url, provider, provider_id)
SELECT u.id,
  COALESCE(NULLIF(u.raw_user_meta_data->'custom_claims'->>'global_name',''),
    NULLIF(u.raw_user_meta_data->>'global_name',''), NULLIF(u.raw_user_meta_data->>'full_name',''),
    NULLIF(u.raw_user_meta_data->>'name',''), NULLIF(u.raw_user_meta_data->>'user_name',''),
    NULLIF(u.raw_user_meta_data->>'preferred_username',''), NULLIF(u.raw_user_meta_data->>'username',''),
    NULLIF(u.email,''), '使用者'),
  COALESCE(NULLIF(u.raw_user_meta_data->>'avatar_url',''), NULLIF(u.raw_user_meta_data->>'picture','')),
  u.raw_app_meta_data->>'provider',
  COALESCE(u.raw_user_meta_data->>'provider_id', u.raw_user_meta_data->>'sub')
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
ON CONFLICT (id) DO NOTHING;
-- Published charts remain publicly visible. My Charts additionally filters user_id.
-- Prevent transfer of ownership, including when the old owner still has update access.
CREATE OR REPLACE FUNCTION public.keep_chart_owner()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Chart owner cannot be changed';
  END IF;
  IF NEW.status = 'published' AND (NEW.package_path IS NULL OR NEW.cover_path IS NULL) THEN
    RAISE EXCEPTION 'Upload package and cover before publishing';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS charts_keep_owner ON public.charts;
CREATE TRIGGER charts_keep_owner BEFORE UPDATE ON public.charts
  FOR EACH ROW EXECUTE FUNCTION public.keep_chart_owner();
INSERT INTO storage.buckets (id,name,public) VALUES
  ('chart-packages','chart-packages',true), ('cover-art','cover-art',true),
  ('chart-strips','chart-strips',true), ('avatars','avatars',true)
ON CONFLICT (id) DO NOTHING;
-- Required for upsert and signed downloads; only these public media buckets.
DROP POLICY IF EXISTS studio_storage_read ON storage.objects;
CREATE POLICY studio_storage_read ON storage.objects FOR SELECT
  USING (bucket_id IN ('chart-packages','cover-art','chart-strips','avatars'));
DROP POLICY IF EXISTS studio_storage_update_own ON storage.objects;
CREATE POLICY studio_storage_update_own ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('chart-packages','cover-art','chart-strips','avatars') AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id IN ('chart-packages','cover-art','chart-strips','avatars') AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS studio_storage_insert_own ON storage.objects;
CREATE POLICY studio_storage_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('chart-packages','cover-art','chart-strips','avatars') AND (storage.foldername(name))[1] = auth.uid()::text);
-- Allows existing file cleanup helper; deleting a charts row does not itself delete objects.
DROP POLICY IF EXISTS studio_storage_delete_own ON storage.objects;
CREATE POLICY studio_storage_delete_own ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('chart-packages','cover-art','chart-strips','avatars') AND (storage.foldername(name))[1] = auth.uid()::text);
COMMIT;
-- Review existing policies: permissive policies combine with OR. Remove any unexpected
-- broad write policy manually after checking its purpose; this migration preserves data.
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies WHERE (schemaname = 'public' AND tablename IN ('charts','profiles','chart_tags'))
 OR (schemaname = 'storage' AND tablename = 'objects');
