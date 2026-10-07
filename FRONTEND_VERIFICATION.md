# Frontend verification against the confirmed ten-input RPC

No SQL was executed, no migration created/modified/redeployed, and no live data was written during this frontend follow-up. The user's inspection is authoritative: WORLD'S END schema and ten-input search RPC are already deployed.

## Detail trace and regression

Home/search/favorites share renderCard and use persisted chart.id in `chart_detail.html?id=...`; featured and related links also use chart.id, and studio management uses chart.id. Detail parses URLSearchParams and validates UUID before getChart. getChart selects charts `*` plus existing profiles/chart_tags/tags relationships, preserving both new WE fields in enrichChart's object spread. Detail uses chartLevel and escapes custom Attribute text.

The previously established regression was an obsolete breadcrumb textContent assignment after header cleanup removed that element; the assignment was already removed. The current failure was not reproduced. A real public chart's exact detail relationship query succeeds, as do reviews/tags. Missing WE fields on ordinary rows do not cause a render failure.

This follow-up changes js/api.js, js/pages/chart-detail.js and chart_detail.html. Error logging now works on hosted pages too, recording stage/message/code/details/hint/stack without sessions or headers. A rejected unique-view RPC no longer rejects an otherwise successful getChart; it logs its real error and retains the chart with a view_notice. Counting still uses the unique-view RPC, never the legacy counter. Search preserves original RPC errors and no longer recommends rerunning a deployed migration.

## Search callers

There is one direct supabase.rpc('search_charts',...) call in js/api.js. Callers are js/pages/index.js loadCharts (home/search), js/pages/index.js loadFeatured (latest three charts), and js/pages/chart-detail.js loadRelated (five charts). Favorites use getMyFavorites, not a separate search RPC. Studio uses getChartsByUser/getChart, not search_charts.

Every RPC request supplies exactly:

```text
query, diff, min_r, max_r, sort_by, page_limit, page_offset,
tag_filter, we_star_filter, we_attribute_filter
```

Unfiltered WE values are explicitly null. max_r defaults to null, and empty maximum input is converted to null. For selected WORLDS_END, min_r/max_r are null; for ordinary/all difficulties, WE filters are null. Featured/related requests default to query='', diff=null, min_r=1, max_r=null, sort_by='published_at', offset=0, tag=null, both WE filters=null, with limits 3 and 5 respectively. Ordinary searches preserve keyword/tag/sort/page state. No old eight-input RPC call remains.

## Payload examples

```json
{"difficulty":"WORLDS_END","rating":null,"we_star_level":3,"we_attribute":"自訂特色"}
```

```json
{"difficulty":"MASTER","rating":17,"we_star_level":null,"we_attribute":null}
```

These fields are combined with existing title/composer/charter/BPM/category/description fields. createChart adds current user_id and draft status. Metadata update never writes status; published/draft are preserved. Shared validation requires ordinary finite rating>=1 in 0.1 increments, or WE integer 1–5 and trimmed Attribute of 1–20 Unicode code points. Irrelevant fields are always explicitly cleared.

No frontend max=16, rating>16, slider max160 or default maxRating16 remains. The final remaining cap in the community subjective-rating number input/JS was removed. Its independent live backend vote constraint has not been verified through a write; no change to that backend is claimed.

## Test evidence and limits

All 21 .test.mjs suites pass. Covered MASTER 14.7/16.0/16.1/17.0 and higher; WE 1/3/5; custom Attribute/length/trim; cross-mode cleanup; null max; correct ten parameter names; normal/WE filter isolation; actual detail renderer/current HTML; guest published/owner draft; metadata save status preservation; home/featured/favorites/related UUID links; existing review/tag/autocomplete/unique view/download/private signing/auth mocks. Added production-host Supabase error diagnostics test and rejected-view-request getChart regression test.

Live public-key read-only REST verification succeeds for the ten-input default search and normal/high-rating/tag/WE-star/custom-Attribute searches. Tag 11 yields the current published chart. Current public dataset contains ULTIMA 14.7; MASTER/high-rating/WE cases return empty successfully. Exact getChart embedded profiles/tags query, reviews profile query and chart_tags query each return the published chart's data successfully. No fake charts were created to make live cases appear tested.

Real authenticated WE/high-rating package submission/edit/reload, draft-owner access, favorites mutations, reviews/reactions, view/download writes and high community subjective votes still require live account verification. Visual browser QA has not been performed in this follow-up. No database defect was established and no DB modification is needed for the confirmed chart metadata/search integration.
