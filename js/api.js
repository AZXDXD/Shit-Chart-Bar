// ============================================================
// js/api.js — 所有資料庫操作 API
// ============================================================
import { supabase, getStorageUrl } from './supabase.js';
import { currentUser } from './auth.js';

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
  sortBy = 'published_at', page = 0, limit = 20,
} = {}) {
  const { data, error } = await supabase.rpc('search_charts', {
    query,
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
export async function getChart(chartId) {
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

  // 增加瀏覽數（fire and forget）
  supabase.rpc('increment_view', { chart_uuid: chartId }).then(() => {});

  return enrichChart(data);
}

/**
 * 取得創作者的所有譜面
 */
export async function getChartsByUser(userId, includesDrafts = false) {
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
  return updateChart(chartId, { status });
}

/**
 * 刪除譜面
 */
export async function deleteChart(chartId) {
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
export async function setChartTags(chartId, tagIds) {
  // 先刪除舊的
  await supabase.from('chart_tags').delete().eq('chart_id', chartId);
  if (!tagIds.length) return;
  const { error } = await supabase.from('chart_tags').insert(
    tagIds.map(tag_id => ({ chart_id: chartId, tag_id }))
  );
  if (error) throw error;
}

// 為每張譜面加上 Storage URL
function enrichChart(chart) {
  return {
    ...chart,
    cover_url:   getStorageUrl('cover-art',      chart.cover_path),
    package_url: getStorageUrl('chart-packages',  chart.package_path),
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
      *,
      profiles:user_id (id, username, charter_name, avatar_url)
    `)
    .eq('chart_id', chartId)
    .order('helpful_count', { ascending: false })
    .order('created_at', { ascending: false })
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
export async function upsertReview(chartId, { rating, body, measureNumber }) {
  if (!currentUser) throw new Error('請先登入');
  const { data, error } = await supabase
    .from('reviews')
    .upsert({
      chart_id:       chartId,
      user_id:        currentUser.id,
      rating,
      body,
      measure_number: measureNumber || null,
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
  const { error } = await supabase
    .from('reviews')
    .delete()
    .eq('id', reviewId)
    .eq('user_id', currentUser.id);
  if (error) throw error;
}

/**
 * 評論有幫助 +1 / 取消
 */
export async function toggleReviewHelpful(reviewId) {
  if (!currentUser) throw new Error('請先登入');

  const { data: existing } = await supabase
    .from('review_helpful')
    .select('review_id')
    .eq('review_id', reviewId)
    .eq('user_id', currentUser.id)
    .single();

  if (existing) {
    // 取消
    await supabase.from('review_helpful')
      .delete().eq('review_id', reviewId).eq('user_id', currentUser.id);
    await supabase.from('reviews')
      .update({ helpful_count: supabase.sql`helpful_count - 1` }).eq('id', reviewId);
    return false;
  } else {
    // +1
    await supabase.from('review_helpful')
      .insert({ review_id: reviewId, user_id: currentUser.id });
    await supabase.from('reviews')
      .update({ helpful_count: supabase.sql`helpful_count + 1` }).eq('id', reviewId);
    return true;
  }
}

// ╔══════════════════════════════════════════════════════════╗
// ║  FAVORITES                                               ║
// ╚══════════════════════════════════════════════════════════╝

export async function isFavorited(chartId) {
  if (!currentUser) return false;
  const { data } = await supabase
    .from('favorites')
    .select('chart_id')
    .eq('chart_id', chartId)
    .eq('user_id', currentUser.id)
    .single();
  return !!data;
}

export async function toggleFavorite(chartId) {
  if (!currentUser) throw new Error('請先登入');
  const faved = await isFavorited(chartId);
  if (faved) {
    await supabase.from('favorites')
      .delete().eq('chart_id', chartId).eq('user_id', currentUser.id);
    return false;
  } else {
    await supabase.from('favorites')
      .insert({ chart_id: chartId, user_id: currentUser.id });
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
  const { data, error } = await supabase.from('tags').select('*').order('id');
  if (error) throw error;
  return data;
}

/**
 * 取得譜面的標籤 + 各標籤投票數
 */
export async function getChartTagsWithVotes(chartId) {
  const { data, error } = await supabase
    .from('chart_tags')
    .select(`
      tag_id,
      tags (id, name, color),
      vote_count:chart_tag_votes(count)
    `)
    .eq('chart_id', chartId);
  if (error) throw error;
  return data;
}

/**
 * 對某標籤 +1 投票 / 取消
 */
export async function toggleTagVote(chartId, tagId) {
  if (!currentUser) throw new Error('請先登入');

  const { data: existing } = await supabase
    .from('chart_tag_votes')
    .select('tag_id')
    .eq('chart_id', chartId)
    .eq('tag_id', tagId)
    .eq('user_id', currentUser.id)
    .single();

  if (existing) {
    await supabase.from('chart_tag_votes')
      .delete()
      .eq('chart_id', chartId).eq('tag_id', tagId).eq('user_id', currentUser.id);
    return false;
  } else {
    await supabase.from('chart_tag_votes')
      .insert({ chart_id: chartId, tag_id: tagId, user_id: currentUser.id });
    return true;
  }
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
 * 記錄下載（呼叫後再提供下載 URL）
 */
export async function recordDownload(chartId) {
  await supabase.from('downloads').insert({
    chart_id: chartId,
    user_id:  currentUser?.id ?? null,
  });
}

// ╔══════════════════════════════════════════════════════════╗
// ║  PROFILES                                                ║
// ╚══════════════════════════════════════════════════════════╝

export async function updateProfile(updates) {
  if (!currentUser) throw new Error('請先登入');
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', currentUser.id)
    .select()
    .single();
  if (error) throw error;
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
