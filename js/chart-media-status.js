export function hasChartVideo(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const url = new URL(value.trim());
    return ['https:', 'http:'].includes(url.protocol) && !!url.hostname;
  } catch { return false; }
}

export function renderChartMediaStatus(chart, variant = 'overlay') {
  const strip = typeof chart.strip_path === 'string' && !!chart.strip_path.trim();
  const video = hasChartVideo(chart.youtube_url);
  return `<div class="chart-media-status chart-status-${variant === 'inline' ? 'inline' : 'overlay'}"><span class="media-status ${strip ? 'media-strip' : 'media-missing'}">${strip ? '有展示譜' : '無展示譜'}</span><span class="media-status ${video ? 'media-video' : 'media-missing'}">${video ? '有影片' : '無影片'}</span></div>`;
}
