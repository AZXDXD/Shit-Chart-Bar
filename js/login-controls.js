// Keep button diagnostics available even when an ES module/CDN fails to load.
(() => {
  let pending = false;
  document.querySelectorAll('[data-oauth]').forEach(button => button.removeAttribute('onclick'));
  document.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-oauth]');
    if (!button) return;
    const provider = button.dataset.oauth;
    if (!['google', 'discord'].includes(provider)) return;
    event.preventDefault();
    console.log(provider === 'google' ? 'Google login clicked' : 'Discord login clicked');
    if (pending) return;
    pending = true;
    let timer;
    try {
      const auth = await Promise.race([
        import('./auth.js'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('登入模組載入逾時，請檢查 js/auth.js、js/supabase.js 與 esm.sh 是否成功載入，再重新整理。')), 12000);
        }),
      ]);
      clearTimeout(timer);
      await (provider === 'google' ? auth.loginWithGoogle() : auth.loginWithDiscord());
    } catch (error) {
      console.error('[Auth] module load failed:', error);
      const modal = document.getElementById('loginModal') || document.getElementById('modalOverlay');
      let message = document.getElementById('authError');
      if (!message && modal?.firstElementChild) {
        message = document.createElement('p');
        message.id = 'authError';
        message.setAttribute('role', 'alert');
        message.style.cssText = 'color:#ff9999;font-size:13px;overflow-wrap:anywhere;';
        modal.firstElementChild.appendChild(message);
      }
      if (message) {
        message.textContent = '登入功能載入失敗：' + error.message;
        message.hidden = false;
        message.style.display = 'block';
      }
    } finally {
      clearTimeout(timer);
      pending = false;
    }
  });
  console.log('[Auth] login buttons bound:', document.querySelectorAll('[data-oauth]').length);
})();
