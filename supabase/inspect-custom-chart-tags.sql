-- Read-only: run before the custom tags migration and retain results.
SELECT t.id,t.name,
 (SELECT count(*) FROM public.chart_tags ct WHERE ct.tag_id=t.id) AS chart_count,
 (SELECT count(*) FROM public.chart_tag_votes v WHERE v.tag_id=t.id) AS vote_count
FROM public.tags t ORDER BY t.id;
SELECT c.id,c.title,c.status,t.name FROM public.chart_tags ct
JOIN public.charts c ON c.id=ct.chart_id JOIN public.tags t ON t.id=ct.tag_id
WHERE t.name IN ('地力譜','手速考驗','配置譜','演出譜','創意極佳','認識考驗','初心者友善','爆手風險','VOCALOID','東方系列')
ORDER BY c.id,t.name;
SELECT id,name FROM public.tags
WHERE char_length(regexp_replace(name,'^[[:space:]]+|[[:space:]]+$','','g')) NOT BETWEEN 1 AND 20;
SELECT chart_id,count(DISTINCT translate(regexp_replace(t.name,'^[[:space:]]+|[[:space:]]+$','','g'),
 'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz')) AS tag_count
FROM public.chart_tags ct JOIN public.tags t ON t.id=ct.tag_id GROUP BY chart_id
HAVING count(DISTINCT translate(regexp_replace(t.name,'^[[:space:]]+|[[:space:]]+$','','g'),
 'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz'))>10;
SELECT tablename,policyname,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN ('tags','chart_tags','chart_tag_votes');

-- Actual signatures, overloads, security mode and browser role permissions.
SELECT p.oid::regprocedure AS signature,
 pg_get_function_arguments(p.oid) AS arguments,
 p.prosecdef AS security_definer,
 has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('search_charts','set_chart_tags','popular_chart_tags')
ORDER BY p.proname,p.oid;
