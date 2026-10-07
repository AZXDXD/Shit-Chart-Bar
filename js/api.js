// ============================================================
// js/api.js — 所有資料庫操作 API
// ============================================================
import { supabase, getStorageUrl } from './supabase.js';
import { currentUser, setCurrentProfile } from './auth.js';
import { normalizeTags } from './chart-tags.js';

// ╔══════════════════════════════════════════════════════════╗
// ║  CHARTS                                                  ║
// ╚══════════════════════════════════════════════════════════╝

/**
 * 搜尋 / 列表譜面（呼叫 search_charts RPC）
 * @param {Object} opts
 * @param {string}  opts.query      - 關鍵字
 * @param {string}  opts.difficulty - 'EXPERT'|'MASTER'|'ULTIMA'|'WORLDS_END'|null
 * @param {number}  opts.minRating  - 最小定數
 * @param {number}  opts.maxRating  - 最大定數
 * @param {string}  opts.sortBy     - 'published_at'|'avg_rating'|'download_count'|'rating_desc'
 * @param {number}  opts.page       - 頁碼（從 0 開始）
 * @param {number}  opts.limit      - 每頁筆數
 */
export async function searchCharts({
  query = '', difficulty = null, minRating = 1.0, maxRating = 16.0,
  sortBy = 'published_at', page = 0, limit = 20, tagId = null,
} = {}) {
  const { data, error } = await supabase.rpc('search_charts', {
    query,
    tag_filter: tagId,
    diff:        difficulty,
    min_r:       minRating,
    max_r:       maxRating,
    sort_by:     sortBy,
    page_limit:  limit,
    page_offset: page * limit,
  });
  if (error) throw error;
  return data.map(enrichChart);
}

/**
 * 取得單一譜面詳情
 */
export async function getChart(chartId, { countView = true } = {}) {
  const { data, error } = await supabase
    .from('charts')
    .select(`
      *,
      profiles:user_id (id, username, charter_name, avatar_url, bio, is_verified,
                        yt_channel, twitter_handle, discord_invite),
      chart_tags (tag_id, tags (id, name, color))
    `)
    .eq('id', chartId)
    .single();
  if (error) throw error;

  // Use only the new unique-view RPC; never fall back to the legacy counter.
  if (countView && currentUser && data.status === 'published') {
    const { data: count, error: viewError } = await supabase.rpc('record_chart_view', { chart_uuid: chartId });
    if (!viewError) data.view_count = count;
    else data.view_notice = '帳號瀏覽記錄未完成：請確認已執行新的 migration，或稍後重試。';
  }

  return enrichChart(data);
}

/**
 * 取得創作者的所有譜面
 */
export async function getChartsByUser(userId, includesDrafts = false) {
  if (includesDrafts && (!currentUser || userId !== currentUser.id)) throw new Error('請先登入自己的帳號');
  let q = supabase
    .from('charts')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (!includesDrafts) q = q.eq('status', 'published');

  const { data, error } = await q;
  if (error) throw error;
  return data.map(enrichChart);
}

/**
 * 建立新譜面（草稿）
 */
export async function createChart(metadata) {
  if (!currentUser) throw new Error('請先登入');
  const { data, error } = await supabase
    .from('charts')
    .insert({ ...metadata, user_id: currentUser.id, status: 'draft' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * 更新譜面資訊
 */
export async function updateChart(chartId, updates) {
  if ('status' in updates) throw new Error('請使用發布或下架操作變更狀態');
  return writeChart(chartId, updates);
}

async function writeChart(chartId, updates) {
  if (!currentUser) throw new Error('請先登入');
  if ('user_id' in updates || 'id' in updates) throw new Error('不可變更譜面擁有者');
  const { data, error } = await supabase
    .from('charts')
    .update(updates)
    .eq('id', chartId)
    .eq('user_id', currentUser.id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * 發布 / 下架譜面
 */
export async function setChartStatus(chartId, status) {
  if (!currentUser) throw new Error('請先登入');
  if (status === 'published') {
    const { data, error } = await supabase.from('charts').select('package_path, cover_path').eq('id', chartId).eq('user_id', currentUser.id).single();
    if (error) throw error;
    if (!data.package_path || !data.cover_path) throw new Error('請先上傳完整遊玩包與曲繪封面');
  }
  if (!['draft', 'published', 'unpublished'].includes(status)) throw new Error('無效的發布狀態');
  return writeChart(chartId, { status });
}

/**
 * 刪除譜面
 */
export async function deleteChart(chartId) {
  if (!currentUser) throw new Error('請先登入');
  const { error } = await supabase
    .from('charts')
    .delete()
    .eq('id', chartId)
    .eq('user_id', currentUser.id);
  if (error) throw error;
}

/**
 * 設定譜面標籤（全量更新）
 */
export async function setChartTags(chartId, names) {
  if (!currentUser) throw new Error('請先登入');
  const { error } = await supabase.rpc('set_chart_tags', { target_chart: chartId, tag_names: normalizeTags(names) });
  if (error) throw error;
}

// 為每張譜面加上 Storage URL
function enrichChart(chart) {
  return {
    ...chart,
    cover_url:   getStorageUrl('cover-art',      chart.cover_path),
    // Private packages get a short-lived URL only when the user downloads.
    package_url: null,
    strip_url:   getStorageUrl('chart-strips',    chart.strip_path),
  };
}

// ╔══════════════════════════════════════════════════════════╗
// ║  REVIEWS                                                 ║
// ╚══════════════════════════════════════════════════════════╝

/**
 * 取得譜面評論列表
 */
export async function getReviews(chartId, { limit = 20, page = 0 } = {}) {
  const { data, error } = await supabase
    .from('reviews')
    .select(`
      id, chart_id, user_id, rating, body, created_at, updated_at,
      profiles:user_id (id, username, charter_name, avatar_url)
    `)
    .eq('chart_id', chartId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);
  if (error) throw error;
  return data;
}

/**
 * 取得目前用戶對某譜面的評論
 */
export async function getMyReview(chartId) {
  if (!currentUser) return null;
  const { data } = await supabase
    .from('reviews')
    .select('*')
    .eq('chart_id', chartId)
    .eq('user_id', currentUser.id)
    .single();
  return data;
}

/**
 * 新增或更新評論（UPSERT）
 */
export async function upsertReview(chartId, { rating, body }) {
  if (!currentUser) throw new Error('請先登入');
  const { data, error } = await supabase
    .from('reviews')
    .upsert({
      chart_id:       chartId,
      user_id:        currentUser.id,
      rating,
      body,
    }, { onConflict: 'chart_id,user_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * 刪除評論
 */
export async function deleteReview(reviewId) {
  if (!currentUser) throw new Error('請先登入');
  const { error } = await supabase
    .from('reviews')
    .delete()
    .eq('id', reviewId)
    .eq('user_id', currentUser.id);
  if (error) throw error;
}

/**
 * 讚／倒讚切換，由 RPC 取得 auth.uid() 並回傳最新統計。
 */
export async function toggleReviewReaction(reviewId, reaction) {
  if (!currentUser) throw new Error('請先登入');
  if (!['like', 'dislike'].includes(reaction)) throw new Error('無效的評論反應');
  const { data, error } = await supabase.rpc('toggle_review_reaction', {
    review_uuid: reviewId, requested_reaction: reaction,
  });
  if (error) throw error;
  return data[0];
}

export async function getReviewReactions(reviewIds) {
  if (!reviewIds.length) return [];
  const { data, error } = await supabase.rpc('get_review_reactions', { review_ids: reviewIds });
  if (error) throw error;
  return data;
}

// ╔══════════════════════════════════════════════════════════╗
// ║  FAVORITES                                               ║
// ╚══════════════════════════════════════════════════════════╝

export async function isFavorited(chartId) {
  if (!currentUser) return false;
  const { data, error } = await supabase
    .from('favorites')
    .select('chart_id')
    .eq('chart_id', chartId)
    .eq('user_id', currentUser.id)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function toggleFavorite(chartId) {
  if (!currentUser) throw new Error('請先登入');
  const faved = await isFavorited(chartId);
  if (faved) {
    const { error } = await supabase.from('favorites')
      .delete().eq('chart_id', chartId).eq('user_id', currentUser.id);
    if (error) throw error;
    return false;
  } else {
    const { error } = await supabase.from('favorites')
      .insert({ chart_id: chartId, user_id: currentUser.id });
    if (error) throw error;
    return true;
  }
}

export async function getMyFavorites({ limit = 20, page = 0 } = {}) {
  if (!currentUser) return [];
  const { data, error } = await supabase
    .from('favorites')
    .select('chart_id, created_at, charts (*)')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .range(page * limit, (page + 1) * limit - 1);
  if (error) throw error;
  return data.map(f => enrichChart(f.charts));
}

// ╔══════════════════════════════════════════════════════════╗
// ║  TAGS & TAG VOTES                                        ║
// ╚══════════════════════════════════════════════════════════╝

export async function getAllTags() {
  const { data, error } = await supabase.rpc('popular_chart_tags');
  if (error) throw error;
  return data;
}

export async function searchChartTags(query, limit = 10) {
  const { data, error } = await supabase.rpc('search_chart_tags', {
    search_query: query, result_limit: Math.max(1, Math.min(20, limit)),
  });
  if (error) throw error;
  return data || [];
}

// ╔══════════════════════════════════════════════════════════╗
// ║  COMMUNITY RATINGS                                       ║
// ╚══════════════════════════════════════════════════════════╝

export async function submitCommunityRating(chartId, rating) {
  if (!currentUser) throw new Error('請先登入');
  const { data, error } = await supabase
    .from('community_ratings')
    .upsert({
      chart_id: chartId,
      user_id:  currentUser.id,
      rating,
    }, { onConflict: 'chart_id,user_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getMyCommunityRating(chartId) {
  if (!currentUser) return null;
  const { data } = await supabase
    .from('community_ratings')
    .select('rating')
    .eq('chart_id', chartId)
    .eq('user_id', currentUser.id)
    .single();
  return data?.rating ?? null;
}

// ╔══════════════════════════════════════════════════════════╗
// ║  DOWNLOADS                                               ║
// ╚══════════════════════════════════════════════════════════╝

/**
 * 原子化記錄登入帳號的唯一下載，回傳資料庫真實總數。
 */
export async function recordDownload(chartId) {
  const { data, error } = await supabase.rpc('record_chart_download', { target_chart: chartId });
  if (error) throw error;
  return data;
}

// ╔══════════════════════════════════════════════════════════╗
// ║  PROFILES                                                ║
// ╚══════════════════════════════════════════════════════════╝

export async function updateProfile(updates) {
  if (!currentUser) throw new Error('請先登入');
  if ('id' in updates) throw new Error('不可變更使用者');
  const { data, error } = await supabase
    .from('profiles')
    .upsert({ username: currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || currentUser.email || '使用者', ...updates, id: currentUser.id })
    .eq('id', currentUser.id)
    .select()
    .single();
  if (error) throw error;
  setCurrentProfile(data);
  return data;
}

export async function getPublicProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, charter_name, avatar_url, bio, is_verified, yt_channel, twitter_handle')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

// ╔══════════════════════════════════════════════════════════╗
// ║  REALTIME SUBSCRIPTIONS                                  ║
// ╚══════════════════════════════════════════════════════════╝

/**
 * 即時監聽新評論（在詳情頁使用）
 * @returns {Function} unsubscribe 函數
 */
export function subscribeToReviews(chartId, callback) {
  const channel = supabase
    .channel('reviews:' + chartId)
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'reviews',
      filter: `chart_id=eq.${chartId}`,
    }, payload => callback(payload))
    .subscribe();

  return () => supabase.removeChannel(channel);
}
