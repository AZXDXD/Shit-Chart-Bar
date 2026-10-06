-- Run once in Supabase SQL Editor if the old schema.sql was already installed.
-- Replaces only the function; the existing on_auth_user_created trigger stays attached.
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
