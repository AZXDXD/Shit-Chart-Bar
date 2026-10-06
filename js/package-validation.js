// ZIP entries have no trustworthy MIME type; inspect bytes instead.
export const missingMessages = {
  chart: '缺少譜面檔 (.ugc)',
  audio: '缺少音源檔 (.mp3 / .ogg / .wav)',
  cover: '缺少曲繪封面 (.jpg / .png)',
};
export function validContent(ext, bytes) {
  const text = new TextDecoder().decode(bytes.slice(0, 16));
  if (!bytes.length) return false;
  switch (ext) {
    case 'ugc': return bytes.some(b => b !== 0); // No documented UGC magic: require nonempty content.
    case 'png': return [137,80,78,71,13,10,26,10].every((b,i) => bytes[i] === b);
    case 'jpg': return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    case 'ogg': return text.startsWith('OggS');
    case 'wav': return text.startsWith('RIFF') && text.slice(8,12) === 'WAVE';
    case 'mp3': return text.startsWith('ID3') || (bytes[0] === 255 && (bytes[1] & 224) === 224 && (bytes[1] & 6) !== 0);
    default: return false;
  }
}
export async function inspectEntries(entries) {
  const found = { chart: null, audio: null, cover: null };
  let total = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    const ext = entry.name.split('.').pop().toLowerCase();
    const kind = ext === 'ugc' ? 'chart' : ['mp3','ogg','wav'].includes(ext) ? 'audio' : ['jpg','png'].includes(ext) ? 'cover' : null;
    if (!kind || found[kind]) continue;
    const bytes = await entry.async('uint8array');
    total += bytes.length;
    if (total > 200 * 1024 * 1024) throw new Error('解壓內容超過 200 MB');
    if (validContent(ext, bytes)) found[kind] = { name: entry.name, bytes, ext };
  }
  return { found, missing: Object.keys(found).filter(k => !found[k]).map(k => missingMessages[k]) };
}
export async function inspectPackage(file) {
  if (!/\.zip$/i.test(file.name)) throw new Error('請使用 ZIP 遊玩包；目前無法校驗 RAR，請先轉成 ZIP');
  if (file.size > 100 * 1024 * 1024) throw new Error('檔案大小不可超過 100 MB');
  if (file.type && !['application/zip','application/x-zip-compressed','application/octet-stream'].includes(file.type)) throw new Error('ZIP MIME type 不正確');
  if (!window.JSZip) throw new Error('ZIP 檢查工具未載入，請重新整理後再試');
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files);
  if (entries.length > 2000 || entries.reduce((n,e) => n + (e._data?.uncompressedSize || 0),0) > 200 * 1024 * 1024) throw new Error('遊玩包解壓內容過大');
  return inspectEntries(entries);
}
