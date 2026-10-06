-- ============================================================
-- 大份吧 (ShitChartBar) — Supabase Database Schema
-- 執行方式：貼入 Supabase Dashboard > SQL Editor > Run
-- ============================================================

-- ── Extensions ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- 全文搜尋

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
CREATE POLICY "profiles_insert_own"   ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_own"   ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- 新用戶自動建立 profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, username, avatar_url, provider, provider_id)
  VALUES (
    NEW.id,
    COALESCE(NULLIF(NEW.raw_user_meta_data->'custom_claims'->>'global_name', ''), NULLIF(NEW.raw_user_meta_data->>'global_name', ''), NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'preferred_username', NEW.raw_user_meta_data->>'username', NEW.raw_user_meta_data->>'name', NULLIF(split_part(NEW.email, '@', 1), ''), '使用者'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture'),
    NEW.raw_app_meta_data->>'provider',
    COALESCE(NEW.raw_user_meta_data->>'provider_id', NEW.raw_user_meta_data->>'sub')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at 自動更新
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
  id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID            NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
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
CREATE INDEX charts_title_trgm     ON public.charts USING gin(title gin_trgm_ops);
CREATE INDEX charts_composer_trgm  ON public.charts USING gin(composer gin_trgm_ops);

ALTER TABLE public.charts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "charts_select_published" ON public.charts FOR SELECT
  USING (status = 'published' OR auth.uid() = user_id);
CREATE POLICY "charts_insert_own"       ON public.charts FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "charts_update_own"       ON public.charts FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "charts_delete_own"       ON public.charts FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER charts_updated_at BEFORE UPDATE ON public.charts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 發布時自動設 published_at
CREATE OR REPLACE FUNCTION public.handle_chart_publish()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'published' AND OLD.status != 'published' THEN
    NEW.published_at = NOW();
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER chart_publish_trigger BEFORE UPDATE ON public.charts
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
CREATE POLICY "chart_tags_select_all" ON public.chart_tags FOR SELECT USING (TRUE);
CREATE POLICY "chart_tags_manage_own" ON public.chart_tags FOR ALL
  USING (EXISTS (SELECT 1 FROM public.charts WHERE id = chart_id AND user_id = auth.uid()));

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
  id              UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
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
CREATE POLICY "reviews_insert_own"  ON public.reviews FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "reviews_update_own"  ON public.reviews FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "reviews_delete_own"  ON public.reviews FOR DELETE
  USING (auth.uid() = user_id);

CREATE TRIGGER reviews_updated_at BEFORE UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 自動更新 charts.avg_rating / review_count
CREATE OR REPLACE FUNCTION public.update_chart_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
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
CREATE POLICY "downloads_insert_all" ON public.downloads FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "downloads_select_own" ON public.downloads FOR SELECT
  USING (auth.uid() = user_id);

-- 自動更新 download_count
CREATE OR REPLACE FUNCTION public.update_download_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
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
CREATE OR REPLACE FUNCTION public.update_community_rating()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
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
CREATE OR REPLACE FUNCTION public.increment_view(chart_uuid UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE public.charts SET view_count = view_count + 1 WHERE id = chart_uuid;
END;
$$;

-- ============================================================
-- 12. SEARCH RPC (全文搜尋)
-- ============================================================
CREATE OR REPLACE FUNCTION public.search_charts(
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
  music_category music_category, cover_path TEXT, strip_path TEXT,
  package_size_mb NUMERIC, avg_rating NUMERIC, review_count INTEGER,
  download_count INTEGER, view_count INTEGER, published_at TIMESTAMPTZ,
  user_id UUID, username TEXT, is_verified BOOLEAN
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.title, c.composer, c.charter_name, c.difficulty, c.rating,
         c.bpm, c.music_category, c.cover_path, c.strip_path, c.package_size_mb,
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
  ('chart-packages', 'chart-packages', TRUE),
  ('cover-art',      'cover-art',      TRUE),
  ('chart-strips',   'chart-strips',   TRUE),
  ('avatars',        'avatars',        TRUE)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS
CREATE POLICY "packages_read_all"  ON storage.objects FOR SELECT USING (bucket_id = 'chart-packages');
CREATE POLICY "packages_write_own" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'chart-packages' AND auth.uid()::TEXT = (storage.foldername(name))[1]
);
CREATE POLICY "packages_delete_own" ON storage.objects FOR DELETE USING (
  bucket_id = 'chart-packages' AND auth.uid()::TEXT = (storage.foldername(name))[1]
);

CREATE POLICY "covers_read_all"   ON storage.objects FOR SELECT USING (bucket_id = 'cover-art');
CREATE POLICY "covers_write_own"  ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'cover-art' AND auth.uid()::TEXT = (storage.foldername(name))[1]
);
CREATE POLICY "strips_read_all"   ON storage.objects FOR SELECT USING (bucket_id = 'chart-strips');
CREATE POLICY "strips_write_own"  ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'chart-strips' AND auth.uid()::TEXT = (storage.foldername(name))[1]
);
CREATE POLICY "avatars_read_all"  ON storage.objects FOR SELECT USING (bucket_id = 'avatars');
CREATE POLICY "avatars_write_own" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'avatars' AND auth.uid()::TEXT = (storage.foldername(name))[1]
);

