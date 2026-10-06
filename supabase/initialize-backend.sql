-- A. 首次初始化 SQL：僅適用於網站資料表 / buckets 尚未建立的 Supabase 專案。
-- 到 Supabase SQL Editor 以 postgres 執行整份。尚未在線上執行。
-- 不 DROP / TRUNCATE、不刪除 Auth 使用者、不修改 OAuth providers。
-- profiles / charts / tags / chart_tags 加上既有 API 的評論、收藏、下載、投票相依表。
-- 所有操作在同一 transaction；若已初始化或發生錯誤則整筆 rollback。
-- 成功後不要重跑；未來變更使用 B. migration。
BEGIN;
DO $$
DECLARE existing_name text;
BEGIN
  SELECT t INTO existing_name FROM unnest(ARRAY[
    'profiles','charts','tags','chart_tags','chart_tag_votes','reviews',
    'review_helpful','favorites','downloads','community_ratings'
  ]) AS names(t) WHERE to_regclass('public.' || t) IS NOT NULL LIMIT 1;
  IF existing_name IS NOT NULL THEN
    RAISE EXCEPTION 'First initialization stopped: public.% already exists. Inspect schema and use migration.', existing_name;
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('avatars','chart-packages','cover-art','chart-strips')) THEN
    RAISE EXCEPTION 'First initialization stopped: application bucket already exists. Inspect before migration.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal AND tgname = 'on_auth_user_created') THEN
    RAISE EXCEPTION 'Existing profile trigger detected; inspect before initializing.';
  END IF;
END;
$$;

-- ============================================================
-- 1. PROFILES (擴展 auth.users)
-- ============================================================
CREATE TABLE public.profiles (
  id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT        NOT NULL,
  charter_name  TEXT,                          -- 製譜專用名義
  avatar_url    TEXT,
  bio           TEXT,
  provider      TEXT,                          -- 'discord' | 'google'
  provider_id   TEXT,                          -- 原始第三方 ID
  yt_channel    TEXT,
  twitter_handle TEXT,
  discord_invite TEXT,
  is_verified   BOOLEAN     DEFAULT FALSE,     -- 管理員驗證創作者
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles_select_all"   ON public.profiles FOR SELECT USING (TRUE);
CREATE POLICY "profiles_insert_own"   ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own"   ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- 新用戶自動建立 profile
CREATE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url, provider, provider_id)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->'custom_claims'->>'global_name', ''), NULLIF(NEW.raw_user_meta_data->>'global_name', ''), NULLIF(NEW.raw_user_meta_data->>'full_name', ''), NULLIF(NEW.raw_user_meta_data->>'name', ''), NULLIF(NEW.raw_user_meta_data->>'user_name', ''), NULLIF(NEW.raw_user_meta_data->>'preferred_username', ''), NULLIF(NEW.raw_user_meta_data->>'username', ''), NULLIF(NEW.raw_user_meta_data->>'email', ''), NULLIF(NEW.email, ''), '使用者'),
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'avatar_url', ''), NULLIF(NEW.raw_user_meta_data->>'picture', '')),
    NEW.raw_app_meta_data->>'provider',
    COALESCE(NEW.raw_user_meta_data->>'provider_id', NEW.raw_user_meta_data->>'sub')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at 自動更新
CREATE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 2. TAGS
-- ============================================================
CREATE TABLE public.tags (
  id    SERIAL      PRIMARY KEY,
  name  TEXT        NOT NULL UNIQUE,
  color TEXT        DEFAULT '#ff6f00'
);

INSERT INTO public.tags (name, color) VALUES
  ('地力譜',    '#ff6f00'),
  ('手速考驗',  '#b04dff'),
  ('配置譜',    '#3de4ff'),
  ('演出譜',    '#ffd700'),
  ('創意極佳',  '#22c55e'),
  ('認識考驗',  '#f97316'),
  ('初心者友善','#84cc16'),
  ('爆手風險',  '#ef4444'),
  ('VOCALOID',  '#ec4899'),
  ('東方系列',  '#8b5cf6');

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tags_select_all" ON public.tags FOR SELECT USING (TRUE);

-- ============================================================
-- 3. CHARTS
-- ============================================================
CREATE TYPE public.difficulty_type AS ENUM ('EXPERT','MASTER','ULTIMA','WORLDS_END');
CREATE TYPE public.music_category  AS ENUM ('Original','Gekimai','Touhou','Variety','VOCALOID','Other');
CREATE TYPE public.chart_status    AS ENUM ('draft','published','unpublished');

CREATE TABLE public.charts (
  id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
                                  REFERENCES public.profiles(id) ON DELETE CASCADE,
  title           TEXT            NOT NULL,
  composer        TEXT            NOT NULL,
  charter_name    TEXT            NOT NULL,
  difficulty      difficulty_type NOT NULL DEFAULT 'MASTER',
  rating          NUMERIC(4,1)   NOT NULL CHECK (rating BETWEEN 1.0 AND 16.0),
  bpm             SMALLINT,
  music_category  music_category  DEFAULT 'Original',
  description     TEXT,
  status          chart_status    DEFAULT 'draft',

  -- File paths (Supabase Storage)
  package_path    TEXT,           -- chart-packages bucket
  package_size_mb NUMERIC(8,2),
  cover_path      TEXT,           -- cover-art bucket
  strip_path      TEXT,           -- chart-strips bucket (展譜圖)
  youtube_url     TEXT,

  -- Computed stats (updated by triggers / functions)
  download_count  INTEGER         DEFAULT 0,
  view_count      INTEGER         DEFAULT 0,
  avg_rating      NUMERIC(3,2)   DEFAULT 0,
  review_count    INTEGER         DEFAULT 0,
  avg_community_rating NUMERIC(4,1),

  created_at      TIMESTAMPTZ     DEFAULT NOW(),
  updated_at      TIMESTAMPTZ     DEFAULT NOW(),
  published_at    TIMESTAMPTZ
);

CREATE INDEX charts_user_id_idx    ON public.charts(user_id);
CREATE INDEX charts_status_idx     ON public.charts(status);
CREATE INDEX charts_rating_idx     ON public.charts(rating);
CREATE INDEX charts_difficulty_idx ON public.charts(difficulty);

ALTER TABLE public.charts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "charts_select_published" ON public.charts FOR SELECT
  USING (status = 'published' OR auth.uid() = user_id);
CREATE POLICY "charts_insert_own"       ON public.charts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "charts_update_own"       ON public.charts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "charts_delete_own"       ON public.charts FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER charts_updated_at BEFORE UPDATE ON public.charts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 發布時自動設 published_at
CREATE FUNCTION public.handle_chart_publish()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'published' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.published_at = NOW();
    ELSIF OLD.status IS DISTINCT FROM 'published' THEN
      NEW.published_at = NOW();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER chart_publish_trigger BEFORE INSERT OR UPDATE ON public.charts
  FOR EACH ROW EXECUTE FUNCTION public.handle_chart_publish();

-- ============================================================
-- 4. CHART_TAGS (many-to-many)
-- ============================================================
CREATE TABLE public.chart_tags (
  chart_id  UUID    REFERENCES public.charts(id) ON DELETE CASCADE,
  tag_id    INTEGER REFERENCES public.tags(id)   ON DELETE CASCADE,
  PRIMARY KEY (chart_id, tag_id)
);

ALTER TABLE public.chart_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chart_tags_select_all" ON public.chart_tags FOR SELECT USING (EXISTS (SELECT 1 FROM public.charts WHERE id = chart_id));
CREATE POLICY "chart_tags_manage_own" ON public.chart_tags FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.charts WHERE id = chart_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.charts WHERE id = chart_id AND user_id = auth.uid()));

-- ============================================================
-- 5. CHART TAG VOTES (玩家 +1 標籤)
-- ============================================================
CREATE TABLE public.chart_tag_votes (
  chart_id  UUID    NOT NULL REFERENCES public.charts(id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES public.tags(id)   ON DELETE CASCADE,
  user_id   UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (chart_id, tag_id, user_id)
);

ALTER TABLE public.chart_tag_votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tag_votes_select_all"  ON public.chart_tag_votes FOR SELECT USING (TRUE);
CREATE POLICY "tag_votes_own"         ON public.chart_tag_votes FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 6. REVIEWS
-- ============================================================
CREATE TABLE public.reviews (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id        UUID        NOT NULL REFERENCES public.charts(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating          SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body            TEXT,
  measure_number  SMALLINT,   -- 小節標註
  helpful_count   INTEGER     DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (chart_id, user_id)  -- 每人只能評一次
);

CREATE INDEX reviews_chart_id_idx ON public.reviews(chart_id);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "reviews_select_all"  ON public.reviews FOR SELECT USING (TRUE);
CREATE POLICY "reviews_insert_own"  ON public.reviews FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reviews_update_own"  ON public.reviews FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reviews_delete_own"  ON public.reviews FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER reviews_updated_at BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 自動更新 charts.avg_rating / review_count
CREATE FUNCTION public.update_chart_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID;
BEGIN
  cid := COALESCE(NEW.chart_id, OLD.chart_id);
  UPDATE public.charts SET
    avg_rating   = (SELECT ROUND(AVG(rating)::NUMERIC, 2) FROM public.reviews WHERE chart_id = cid),
    review_count = (SELECT COUNT(*) FROM public.reviews WHERE chart_id = cid)
  WHERE id = cid;
  RETURN NEW;
END;
$$;
CREATE TRIGGER reviews_update_chart AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_chart_rating();

-- ============================================================
-- 7. REVIEW HELPFUL VOTES
-- ============================================================
CREATE TABLE public.review_helpful (
  review_id UUID NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (review_id, user_id)
);

ALTER TABLE public.review_helpful ENABLE ROW LEVEL SECURITY;
CREATE POLICY "helpful_select_all" ON public.review_helpful FOR SELECT USING (TRUE);
CREATE POLICY "helpful_own"        ON public.review_helpful FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 8. FAVORITES (收藏)
-- ============================================================
CREATE TABLE public.favorites (
  user_id   UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chart_id  UUID NOT NULL REFERENCES public.charts(id)   ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (user_id, chart_id)
);

ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "favorites_own" ON public.favorites FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- 9. DOWNLOADS (下載紀錄)
-- ============================================================
CREATE TABLE public.downloads (
  id         BIGSERIAL   PRIMARY KEY,
  chart_id   UUID        NOT NULL REFERENCES public.charts(id) ON DELETE CASCADE,
  user_id    UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  ip_hash    TEXT,       -- 匿名 IP hash
  downloaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX downloads_chart_id_idx ON public.downloads(chart_id);

ALTER TABLE public.downloads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "downloads_insert_all" ON public.downloads FOR INSERT TO anon, authenticated
  WITH CHECK ((user_id IS NULL OR user_id = auth.uid())
    AND EXISTS (SELECT 1 FROM public.charts c WHERE c.id = chart_id AND c.status = 'published'));
CREATE POLICY "downloads_select_own" ON public.downloads FOR SELECT
  USING (auth.uid() = user_id);

-- 自動更新 download_count
CREATE FUNCTION public.update_download_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.charts SET download_count = download_count + 1 WHERE id = NEW.chart_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER downloads_count_trigger AFTER INSERT ON public.downloads
  FOR EACH ROW EXECUTE FUNCTION public.update_download_count();

-- ============================================================
-- 10. COMMUNITY RATINGS (體感難度投票)
-- ============================================================
CREATE TABLE public.community_ratings (
  chart_id   UUID        NOT NULL REFERENCES public.charts(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating     NUMERIC(4,1) NOT NULL CHECK (rating BETWEEN 1.0 AND 16.0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (chart_id, user_id)
);

ALTER TABLE public.community_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cr_select_all" ON public.community_ratings FOR SELECT USING (TRUE);
CREATE POLICY "cr_own"        ON public.community_ratings FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- 自動更新 avg_community_rating
CREATE FUNCTION public.update_community_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid UUID;
BEGIN
  cid := COALESCE(NEW.chart_id, OLD.chart_id);
  UPDATE public.charts SET
    avg_community_rating = (
      SELECT ROUND(AVG(rating)::NUMERIC, 1)
      FROM public.community_ratings WHERE chart_id = cid
    )
  WHERE id = cid;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cr_update_chart AFTER INSERT OR UPDATE OR DELETE ON public.community_ratings
  FOR EACH ROW EXECUTE FUNCTION public.update_community_rating();

-- ============================================================
-- 11. VIEW COUNTER (瀏覽計數 RPC)
-- ============================================================
CREATE FUNCTION public.increment_view(chart_uuid UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.charts SET view_count = view_count + 1 WHERE id = chart_uuid AND status = 'published';
END;
$$;

-- ============================================================
-- 12. SEARCH RPC (全文搜尋)
-- ============================================================
CREATE FUNCTION public.search_charts(
  query TEXT DEFAULT '',
  diff  difficulty_type DEFAULT NULL,
  min_r NUMERIC DEFAULT 1.0,
  max_r NUMERIC DEFAULT 16.0,
  sort_by TEXT DEFAULT 'published_at',
  page_limit INTEGER DEFAULT 20,
  page_offset INTEGER DEFAULT 0
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
    AND (query = '' OR c.title ILIKE '%' || query || '%'
                    OR c.composer ILIKE '%' || query || '%'
                    OR c.charter_name ILIKE '%' || query || '%')
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

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES
  ('chart-packages', 'chart-packages', FALSE),
  ('cover-art',      'cover-art',      TRUE),
  ('chart-strips',   'chart-strips',   TRUE),
  ('avatars',        'avatars',        TRUE)
ON CONFLICT (id) DO NOTHING;


-- Existing Auth users: create missing profiles once, keep any custom profile intact.
INSERT INTO public.profiles (id, username, avatar_url, provider, provider_id)
SELECT u.id,
  COALESCE(NULLIF(u.raw_user_meta_data->'custom_claims'->>'global_name',''),
    NULLIF(u.raw_user_meta_data->>'global_name',''), NULLIF(u.raw_user_meta_data->>'full_name',''),
    NULLIF(u.raw_user_meta_data->>'name',''), NULLIF(u.raw_user_meta_data->>'user_name',''),
    NULLIF(u.raw_user_meta_data->>'preferred_username',''), NULLIF(u.raw_user_meta_data->>'username',''),
    NULLIF(u.raw_user_meta_data->>'email',''), NULLIF(u.email,''), '使用者'),
  COALESCE(NULLIF(u.raw_user_meta_data->>'avatar_url',''), NULLIF(u.raw_user_meta_data->>'picture','')),
  u.raw_app_meta_data->>'provider',
  COALESCE(u.raw_user_meta_data->>'provider_id', u.raw_user_meta_data->>'sub')
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- Ownership is immutable; stored chart paths must stay in the author's directory.
CREATE FUNCTION public.validate_chart_owner_and_files()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Chart owner cannot be changed';
    END IF;
  END IF;
  IF (NEW.package_path IS NOT NULL AND (
        split_part(NEW.package_path, '/', 1) <> NEW.user_id::text
        OR split_part(NEW.package_path, '/', 2) <> NEW.id::text))
     OR (NEW.cover_path IS NOT NULL AND split_part(NEW.cover_path, '/', 1) <> NEW.user_id::text)
     OR (NEW.strip_path IS NOT NULL AND split_part(NEW.strip_path, '/', 1) <> NEW.user_id::text) THEN
    RAISE EXCEPTION 'Storage paths must belong to chart owner';
  END IF;
  IF NEW.status = 'published' AND (NULLIF(NEW.package_path,'') IS NULL OR NULLIF(NEW.cover_path,'') IS NULL) THEN
    RAISE EXCEPTION 'Upload package and cover before publishing';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER charts_validate_owner_and_files BEFORE INSERT OR UPDATE ON public.charts
  FOR EACH ROW EXECUTE FUNCTION public.validate_chart_owner_and_files();

-- Images remain public. Packages are private: no public URL bypasses these policies.
-- Exact package_path match prevents access to unlinked packages / other files in a folder.
CREATE POLICY studio_storage_select ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id IN ('cover-art','chart-strips','avatars'));
CREATE POLICY studio_packages_select ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'chart-packages' AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR EXISTS (
      SELECT 1 FROM public.charts c
      WHERE c.status = 'published'
        AND c.package_path = storage.objects.name
        AND c.user_id::text = (storage.foldername(storage.objects.name))[1]
        AND c.id::text = (storage.foldername(storage.objects.name))[2]
    )
  ));
CREATE POLICY studio_storage_insert_own ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id IN ('chart-packages','cover-art','chart-strips','avatars')
    AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY studio_storage_update_own ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id IN ('chart-packages','cover-art','chart-strips','avatars')
    AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id IN ('chart-packages','cover-art','chart-strips','avatars')
    AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY studio_storage_delete_own ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id IN ('chart-packages','cover-art','chart-strips','avatars')
    AND (storage.foldername(name))[1] = auth.uid()::text);
-- Supabase already owns/enables RLS and supplies grants on storage.objects.
-- Do not alter managed Auth or Storage table ownership / definitions.

GRANT USAGE ON SCHEMA public TO anon, authenticated;
-- Clear project default grants only on these newly created application tables.
REVOKE ALL ON public.profiles, public.charts, public.tags, public.chart_tags,
  public.chart_tag_votes, public.reviews, public.review_helpful, public.favorites,
  public.downloads, public.community_ratings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.profiles, public.charts, public.tags, public.chart_tags,
  public.chart_tag_votes, public.reviews, public.review_helpful, public.community_ratings
  TO anon, authenticated;
GRANT SELECT ON public.favorites, public.downloads TO authenticated;
-- Profiles: is_verified is server-managed; browser may not grant itself verification.
GRANT INSERT (id,username,charter_name,avatar_url,bio,yt_channel,twitter_handle,discord_invite)
  ON public.profiles TO authenticated;
GRANT UPDATE (id,username,charter_name,avatar_url,bio,yt_channel,twitter_handle,discord_invite)
  ON public.profiles TO authenticated;
-- Charts: browser may edit metadata, never computed counters or ratings.
GRANT INSERT (user_id,title,composer,charter_name,difficulty,rating,bpm,music_category,
  description,status,package_path,package_size_mb,cover_path,strip_path,youtube_url)
  ON public.charts TO authenticated;
GRANT UPDATE (title,composer,charter_name,difficulty,rating,bpm,music_category,
  description,status,package_path,package_size_mb,cover_path,strip_path,youtube_url)
  ON public.charts TO authenticated;
GRANT DELETE ON public.charts TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.chart_tags, public.chart_tag_votes,
  public.reviews, public.review_helpful, public.favorites, public.community_ratings TO authenticated;
GRANT INSERT ON public.downloads TO anon, authenticated;
GRANT USAGE ON SEQUENCE public.downloads_id_seq TO anon, authenticated;
-- Only these two RPCs are intended for browser calls. Trigger functions are not RPCs.
REVOKE ALL ON FUNCTION public.handle_new_user(), public.set_updated_at(),
  public.handle_chart_publish(), public.update_chart_rating(), public.update_download_count(),
  public.update_community_rating(), public.validate_chart_owner_and_files() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.increment_view(uuid),
  public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_view(uuid),
  public.search_charts(text,public.difficulty_type,numeric,numeric,text,integer,integer)
  TO anon, authenticated;

COMMIT;

-- Inspection output after successful initialization (no fake charts inserted).
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('profiles','charts','tags','chart_tags',
  'chart_tag_votes','reviews','review_helpful','favorites','downloads','community_ratings');
SELECT id, name, public FROM storage.buckets
WHERE id IN ('avatars','chart-packages','cover-art','chart-strips');
SELECT schemaname, tablename, policyname, cmd, qual, with_check
FROM pg_policies WHERE (schemaname = 'public' AND tablename IN ('profiles','charts','tags',
  'chart_tags','chart_tag_votes','reviews','review_helpful','favorites','downloads','community_ratings'))
  OR (schemaname = 'storage' AND tablename = 'objects');
