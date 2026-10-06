export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

// Covers are extracted from the submitted ZIP and served by the public cover-art bucket.
export function renderChartCover(chart) {
  let url;
  try {
    const parsed = new URL(chart.cover_url);
    if (['https:', 'http:'].includes(parsed.protocol)) url = parsed.href;
  } catch { /* Older drafts may have no cover yet. */ }
  const fallback = `<span${url ? ' hidden' : ''} aria-label="尚無曲繪">🎵</span>`;
  if (!url) return fallback;
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(chart.title)} 曲繪" loading="lazy" style="display:block;width:100%;height:100%;object-fit:cover;" onerror="this.hidden=true;this.style.display='none';this.nextElementSibling.hidden=false;">${fallback}`;
}
