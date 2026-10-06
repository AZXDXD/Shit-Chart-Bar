// Header links and account tabs must work independently of Auth/network loading.
(() => {
  const tabs = new Set(['profile', 'manage', 'upload']);
  function renderTab(id) {
    document.querySelectorAll('.page-content').forEach(el => el.classList.toggle('active', el.id === 'page-' + id));
    document.querySelectorAll('[data-account-tab]').forEach(el => {
      const active = el.dataset.accountTab === id;
      el.classList.toggle('active', active);
      el.setAttribute('aria-selected', String(active));
    });
    window.dispatchEvent(new CustomEvent('accountTabChanged', { detail: { id } }));
  }
  function readTab() {
    const requested = location.hash.slice(1);
    const id = tabs.has(requested) ? requested : 'profile';
    if (requested !== id) history.replaceState(null, '', location.pathname + location.search + '#' + id);
    renderTab(id);
  }
  window.switchPage = (requested, btn) => {
    const id = tabs.has(requested) ? requested : 'profile';
    if (id === 'upload' && btn) window.dispatchEvent(new CustomEvent('accountNewSubmission'));
    history.pushState(null, '', location.pathname + location.search + '#' + id);
    renderTab(id);
  };
  document.querySelectorAll('[data-account-link]').forEach(el => {
    el.href = new URL('charter_studio.html#profile', location.href).href;
  });
  if (!document.getElementById('page-profile')) return;
  window.addEventListener('hashchange', readTab);
  readTab();
})();
