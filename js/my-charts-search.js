import { defaultFavoriteFilters, filterFavorites } from './favorites-search.js';

export const defaultMyChartFilters = () => ({ ...defaultFavoriteFilters(), status: '' });

export function filterMyCharts(charts, filters) {
  const query = filters.query.trim().toLocaleLowerCase();
  return filterFavorites(charts, { ...filters, query: '' }).filter(chart => {
    if (filters.status === 'published' && chart.status !== 'published') return false;
    if (filters.status === 'unpublished' && chart.status === 'published') return false;
    const texts = [chart.title, chart.charter_name, ...(chart.chart_tags || []).map(row => row.tags?.name)];
    return !query || texts.some(text => String(text || '').toLocaleLowerCase().includes(query));
  }).sort((a,b) => {
    const tie = String(a.id).localeCompare(String(b.id));
    if (filters.sortBy === 'title_asc') return String(a.title || '').localeCompare(String(b.title || ''), 'zh-Hant', { numeric:true }) || tie;
    const field = filters.sortBy === 'updated' ? 'updated_at' : 'created_at';
    const order = String(a[field] || a.created_at || '').localeCompare(String(b[field] || b.created_at || ''));
    return (filters.sortBy === 'oldest' ? order : -order) || tie;
  });
}

export function createMyChartSearch({ getUser, fetchCharts, renderItem, updateStats }) {
  const el = id => document.getElementById(id);
  const form = el('myChartSearchForm');
  let filters = defaultMyChartFilters(), charts = [], page = 0, owner = null, revision = 0, loading = false;
  const resetButtons = () => form.querySelectorAll('[data-my-chart-difficulty]').forEach(button => { button.classList.remove('active'); button.setAttribute('aria-pressed','false'); });
  function render() {
    if (loading || !getUser() || owner !== getUser().id) return;
    const results = filterMyCharts(charts, filters);
    const pages = Math.max(1, Math.ceil(results.length / 20));
    page = Math.max(0, Math.min(page, pages - 1));
    el('myChartResultCount').textContent = `共 ${results.length} 筆`;
    el('myChartList').innerHTML = results.length ? results.slice(page * 20, (page + 1) * 20).map(renderItem).join('')
      : `<div style="padding:20px;color:var(--dim)">${charts.length ? '沒有符合搜尋條件的譜面，請調整或清除篩選。' : '你目前還沒有投稿任何譜面。'}</div>`;
    el('myChartPagination').hidden = results.length <= 20;
    el('myChartPrev').disabled = page === 0;
    el('myChartNext').disabled = page >= pages - 1;
    el('myChartPageLabel').textContent = `第 ${page + 1} / ${pages} 頁`;
  }
  function reset() {
    ++revision; loading = false; charts = []; owner = null; page = 0;
    filters = defaultMyChartFilters(); form.reset(); resetButtons();
    el('myChartFilterError').hidden = true;
    el('myChartResultCount').textContent = '';
    el('myChartPagination').hidden = true;
    el('myChartList').textContent = '請先登入以管理你的譜面';
  }
  async function load() {
    const id = getUser()?.id;
    if (!id) { reset(); return; }
    if (owner !== id) reset();
    owner = id; page = 0; loading = true;
    const version = ++revision;
    el('myChartList').textContent = '搜尋中…';
    el('myChartResultCount').textContent = '搜尋中…';
    el('myChartPagination').hidden = true;
    try {
      const data = await fetchCharts();
      if (revision !== version || getUser()?.id !== id) return;
      charts = data.filter(chart => chart.user_id === id);
      loading = false; updateStats(charts); render();
    } catch (error) {
      if (revision !== version || getUser()?.id !== id) return;
      loading = false; charts = [];
      el('myChartList').textContent = '載入失敗：' + error.message;
      el('myChartResultCount').textContent = '';
    }
  }
  const value = id => el(id).value;
  function apply() {
    const min = value('myChartMin') === '' ? null : Number(value('myChartMin'));
    const max = value('myChartMax') === '' ? null : Number(value('myChartMax'));
    const invalid = [min,max].some(n => n !== null && (!Number.isFinite(n) || n < 1)) || (min !== null && max !== null && min > max);
    el('myChartFilterError').hidden = !invalid;
    el('myChartFilterError').textContent = invalid ? '請輸入有效的定數範圍，最低定數不可大於最高定數。' : '';
    if (invalid) return;
    filters = { ...filters, query:value('myChartQuery'), minRating:min, maxRating:max, weStarLevel:value('myChartStars') ? Number(value('myChartStars')) : null, status:value('myChartStatus'), strip:value('myChartStrip'), video:value('myChartVideo'), sortBy:value('myChartSort') };
    page = 0; render();
  }
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', event => { if (event.target.id === 'myChartQuery') apply(); });
  form.addEventListener('change', apply);
  form.addEventListener('click', event => {
    const button = event.target.closest('[data-my-chart-difficulty]');
    if (!button) return;
    button.setAttribute('aria-pressed', String(button.classList.toggle('active')));
    filters.difficulties = [...form.querySelectorAll('[data-my-chart-difficulty].active')].map(button => button.dataset.myChartDifficulty);
    apply();
  });
  el('clearMyChartFilters').addEventListener('click', () => { form.reset(); filters = defaultMyChartFilters(); resetButtons(); apply(); });
  el('myChartPrev').addEventListener('click', () => { --page; render(); });
  el('myChartNext').addEventListener('click', () => { ++page; render(); });
  return { load, reset };
}
