export const isWorldsEnd = chart => chart.difficulty === 'WORLDS_END';
export function renderWeAttribute(chart) {
  const text = String(chart.we_attribute ?? '').trim();
  if (!isWorldsEnd(chart) || !text) return '';
  const escaped = text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const size = [...text].length === 1 ? '' : [...text].length <= 4 ? ' we-attribute-short' : ' we-attribute-long';
  return `<span class="we-attribute-badge${size}" title="${escaped}" aria-label="WE Attribute：${escaped}">${escaped}</span>`;
}
export function chartLevel(chart) {
  if (!isWorldsEnd(chart)) return String(chart.rating ?? '');
  const stars = Number(chart.we_star_level);
  return Number.isInteger(stars) && stars >= 1 && stars <= 5 ? '★'.repeat(stars) : '星數待補';
}
export function difficultyMetadata(difficulty, rating, stars, attribute) {
  if (difficulty === 'WORLDS_END') {
    const level = Number(stars), text = String(attribute ?? '').trim();
    if (!Number.isInteger(level) || level < 1 || level > 5) throw new Error('請選擇 1～5 星');
    if (!text || [...text].length > 20) throw new Error('WE Attribute 請填入 1～20 字元');
    return { difficulty, rating: null, we_star_level: level, we_attribute: text };
  }
  const value = Number(rating);
  if (!String(rating).trim() || !Number.isFinite(value) || value < 1 || Math.abs(value * 10 - Math.round(value * 10)) > 1e-8) throw new Error('定數須為至少 1.0 的數字，以 0.1 為單位');
  return { difficulty, rating: value, we_star_level: null, we_attribute: null };
}
