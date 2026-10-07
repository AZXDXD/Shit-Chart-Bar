-- Read-only inspection. Run in Supabase SQL Editor and return all result sets.
-- Does not change schema, data, privileges, or counters.
SELECT column_name, data_type, udt_schema, udt_name,
       numeric_precision, numeric_scale, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'charts'
ORDER BY ordinal_position;

SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.charts'::regclass
ORDER BY conname;

SELECT p.oid::regprocedure AS signature,
       pg_get_function_arguments(p.oid) AS arguments,
       pg_get_function_result(p.oid) AS result,
       pg_get_functiondef(p.oid) AS definition,
       p.prosecdef AS security_definer, p.proconfig, p.proacl
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'search_charts';

SELECT enumlabel, enumsortorder
FROM pg_enum WHERE enumtypid = 'public.difficulty_type'::regtype
ORDER BY enumsortorder;

-- JSON preserves the actual columns without assuming play_level exists.
SELECT to_jsonb(c) AS legacy_worlds_end
FROM public.charts c WHERE c.difficulty::text = 'WORLDS_END'
ORDER BY c.created_at;

SELECT c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c WHERE c.oid = 'public.charts'::regclass;
