# WORLD'S END metadata — database confirmed deployed by user

Latest authoritative state: the user confirmed the new columns, validated constraints and ten-input RPC exist in the real Supabase database. Do not execute, redeploy or modify `20261007_worlds_end_chart_metadata.sql`. Earlier migration review/rollback notes below are historical, not current deployment instructions. Frontend search now propagates original RPC errors without telling the user to rerun SQL. See `FRONTEND_VERIFICATION.md` for current verification.

## Confirmed existing deployment

User's SQL inspection confirms `difficulty public.difficulty_type NOT NULL`, `rating numeric(4,1) NOT NULL`, and `charts_rating_check` enforcing 1.0–16.0. There were no play_level/chart_constant/we_attribute columns and no WORLD'S END rows. Six difficulty enum values already exist. RLS is enabled.

The old eight-argument signature is:

```sql
public.search_charts(
  query text DEFAULT '', diff public.difficulty_type DEFAULT NULL,
  min_r numeric DEFAULT 1.0, max_r numeric DEFAULT 16.0,
  sort_by text DEFAULT 'published_at', page_limit integer DEFAULT 20,
  page_offset integer DEFAULT 0, tag_filter integer DEFAULT NULL
)
```

The new signature is:

```sql
public.search_charts(
  query text DEFAULT '', diff public.difficulty_type DEFAULT NULL,
  min_r numeric DEFAULT 1.0, max_r numeric DEFAULT NULL,
  sort_by text DEFAULT 'published_at', page_limit integer DEFAULT 20,
  page_offset integer DEFAULT 0, tag_filter integer DEFAULT NULL,
  we_star_filter integer DEFAULT NULL, we_attribute_filter text DEFAULT NULL
)
```

## Schema and preservation

`rating` remains the ordinary chart constant. It becomes nullable unconstrained numeric: this removes both the explicit 16.0 check and numeric(4,1)'s implicit 999.9 limit. Ordinary writes require finite rating >=1 in increments of 0.1. No ordinary rating is rewritten.

`we_star_level smallint NULL` holds numeric 1–5 exclusively for WORLD'S END. A dedicated field avoids overloading the ordinary rating or inventing a generic play_level meaning for existing charts. `we_attribute text NULL` accepts trimmed custom text of 1–20 Unicode characters, without an enum. WE writes set rating=NULL; ordinary writes clear both WE fields. New frontend WE submissions require stars and attribute. SQL requires non-null WE stars and attribute. The migration locks charts, verifies there are still no WORLD'S END rows, and checks existing ordinary ratings before DDL. Both CHECK constraints validate all existing rows at creation; convalidated=true. Any incompatible row aborts the transaction without repair. Frontend missing stars displays “星數待補”, missing attribute “待補”; it never displays an old WE rating as stars or constant.

Migration uses a single transaction, never updates/deletes rows, never disables RLS, and changes no tags/favorites/reviews/reactions/counters/storage/OAuth. It reads the deployed search body and makes guarded replacements, preserving keyword/tag/sort/pagination logic, owner, function security/search_path, and EXECUTE grants including grant options. Only the exact old overload is dropped, without CASCADE. Unexpected function shape or dependencies abort the transaction. No further routine inspection is required; if a guard fails, return the full pg_get_functiondef result instead of bypassing the guard.

After the reported `we_search_grants` relation failure, this same unsuccessful migration was revised: all schema changes, function transformation and ACL restoration now run in one DO statement. Original owner and effective ACL are saved in local PL/pgSQL variables (`old_owner`, `old_acl aclitem[]`); no temporary relation exists. NULL proacl is expanded with acldefault. Grants on the new function are cleared (including creation default privileges) and only the saved EXECUTE recipients/options are restored. PUBLIC maps from grantee OID 0. Grouping by recipient preserves effective grant option via bool_or. No extra rights are deliberately introduced.

`supabase/inspect-worlds-end-rollback.sql` contains SELECT statements only. It reports WE column absence, original rating precision/scale/NOT NULL, CHECK definitions/validation, all search overloads/owners/ACLs and RLS. The live rollback state is not confirmed until its results are returned. Temporary tables normally survive separate statements/DO blocks in the same session and transaction; ON COMMIT DROP removes them at commit. The reported error establishes that the later query could not see the temporary relation, but does not establish whether partial execution, transaction/session boundaries or another execution detail caused that absence. The revision removes that dependency completely.

WE rows bypass ordinary rating ranges, including in all-difficulty searches. WE star and case-insensitive literal substring attribute filters apply only when selecting WORLDS_END. Ordinary searches ignore WE filters. max_r=NULL means no upper bound. RPC results add we_star_level/we_attribute.

## Frontend

Changed `index.html`, `charter_studio.html`, `chart_detail.html`, `js/api.js`, `js/pages/index.js`, `js/pages/charter_studio.js`, `js/pages/chart-detail.js`; added `js/chart-metadata.js`. All RPC callers use the centralized API. Number inputs replace the capped sliders. Mode switching hides/disables irrelevant fields; payload construction always clears irrelevant database fields. Editing preloads both field sets. Metadata save never writes status, preserving published/draft.

Shared rendering converts 1–5 into repeated ★ in search/favorites/featured/my charts/related/detail. Difficulty order and rainbow styles remain. WE detail hides the creator constant and ordinary community constant card; five-star reviews/reactions remain available. The remaining ordinary community subjective-rating input/JS 16 cap was removed in the frontend follow-up. Existing community-rating backend rules were not changed or inspected by SQL; live high community-vote writes were not performed.

## Detail regression

Prior header cleanup removed breadcrumb HTML while renderChart still assigned textContent to its missing node, causing a TypeError after a successful database query. Existing code already removed that assignment before this work. UUID handling and real profiles/tags embedded REST query were verified previously; this change does not use SQL to mask the render bug. Existing localhost diagnostics record stage/message/code/details/hint/stack. Current render tests cover all six difficulties, published guest and draft/unpublished owner views; no new intermittent live failure was reproduced.

## Verification

All `.test.mjs` regression tests pass, including new metadata/RPC/studio tests and expanded actual detail rendering. Covered constants 14.7/16.0/16.1/17.0 and 1234.5; WE 1/3/5 stars; 狂/招/custom text; validation; mode changes; null max; tag/keyword/sort/page parameters; published/draft status; favorites/tags/autocomplete/reviews/reactions/views/downloads/private signing/OAuth/navigation mocks.

`node tests/worlds-end-postgres.cjs` passes using an isolated PostgreSQL WASM fixture with PGlite installed under ignored test-results/we-postgres. It executes the new migration against a fixture matching the inspected baseline, checks existing row preservation, RLS and anon EXECUTE, numeric/search rules and custom tags. This is **not** a Supabase deployment. Old SQL is used only as an isolated fixture definition, never rerun on the real database.

The revised migration test verifies both convalidated flags are true, compares all ten database input names with the actual frontend RPC object, and confirms omission of WE filter arguments works. Sixteen invalid metadata cases are rejected with CHECK violation 23514, including NULL stars/attribute, WE rating, ordinary WE fields, nonfinite/subminimum/multiple-decimal ratings, out-of-range stars and invalid attribute text. Ten fixtures exercise zero/duplicate regexp matches; two exercise preflight failure for unexpected WE rows and invalid ordinary ratings. All fail with transaction rollback, preserving the original function and data and removing uncommitted new columns.

Additional ACL tests cover custom owner, PUBLIC access, grant option, NULL/default ACL and unwanted creation default privileges. A failure injected after CREATE of the new RPC confirms rollback restores the original rating numeric(4,1) NOT NULL/check and eight-argument RPC/ACL, with no WE columns or ten-argument RPC. Read-only rollback inspection runs successfully against that rolled-back fixture.

The supplied inspection text confirms the signature and functionality but does not contain the complete pg_get_functiondef output. Therefore regexp matching is verified against PostgreSQL's normalized fixture definition, not claimed as an offline byte-for-byte verification of the unavailable live definition. The migration reads that actual live definition itself and requires exactly one match at every step before dropping the old RPC; unexpected formatting/body changes raise an exception and roll back. No Supabase migration or writes were performed.

After manual SQL deployment, manually verify real authenticated submission/editing with a chart package and cover, published/draft status, reload, high-constant and WE searches combined with tags/keyword/sort/pagination, favorites, autocomplete, reviews/reactions, unique view/download counts, signed downloads, and Google/Discord login on desktop/mobile. These live actions and visual browser QA have not been performed in this turn.
