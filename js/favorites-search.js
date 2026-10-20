import { hasChartVideo } from './chart-media-status.js';

export const defaultFavoriteFilters = () => ({ query: '', difficulties: [], minRating: null, maxRating: null, weStarLevel: null, strip: '', video: '', sortBy: 'newest' });

export function filterFavorites(charts, filters) {
  const query = filters.query.trim().toLocaleLowerCase();
  const matches = charts.filter(chart => {
    const names = [chart.title, chart.charter_name, chart.profiles?.charter_name, chart.profiles?.username];
    if (query && !names.some(name => String(name || '').toLocaleLowerCase().includes(query))) return false;
    if (filters.difficulties.length && !filters.difficulties.includes(chart.difficulty)) return false;
    if (chart.difficulty === 'WORLDS_END') {
      if (filters.weStarLevel !== null && Number(chart.we_star_level) !== filters.weStarLevel) return false;
    } else {
      if (filters.minRating !== null && (chart.rating == null || Number(chart.rating) < filters.minRating)) return false;
      if (filters.maxRating !== null && (chart.rating == null || Number(chart.rating) > filters.maxRating)) return false;
    }
    const strip = typeof chart.strip_path === 'string' && !!chart.strip_path.trim();
    if (filters.strip && strip !== (filters.strip === 'yes')) return false;
    if (filters.video && hasChartVideo(chart.youtube_url) !== (filters.video === 'yes')) return false;
    return true;
  });
  return matches.sort((a, b) => {
    const tie = String(a.id).localeCompare(String(b.id));
    if (filters.sortBy === 'title_asc' || filters.sortBy === 'title_desc') {
      const order = String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hant', { numeric: true });
      return (filters.sortBy === 'title_desc' ? -order : order) || tie;
    }
    const order = String(a.favorite_created_at || '').localeCompare(String(b.favorite_created_at || ''));
    return (filters.sortBy === 'oldest' ? order : -order) || tie;
  });
}
