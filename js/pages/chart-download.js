// Use the existing detail-page download button and authoritative chart id.
import { initAuth } from '../auth.js';
import { downloadChart } from '../storage.js';

const button = document.getElementById('packageDownloadBtn');
button?.addEventListener('click', async () => {
  button.disabled = true;
  try {
    await initAuth();
    await downloadChart(new URLSearchParams(location.search).get('id'));
  } catch (error) {
    alert('下載失敗：' + error.message);
  } finally {
    button.disabled = false;
  }
});
