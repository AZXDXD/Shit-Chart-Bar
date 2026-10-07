// One menu for every page. Visibility is owned by auth.js via data-auth.
(() => {
  const header = document.querySelector('header');
  if (!header) return;
  const menu = document.createElement('details');
  menu.className = 'site-menu';
  menu.innerHTML = `<summary aria-label="開啟導覽選單">☰</summary><nav class="site-menu-panel" aria-label="主要導覽">
    <a href="index.html">探索譜面</a>
    <button type="button" data-auth="guest" data-menu-action="login">登入帳號</button>
    <a data-auth="user" style="display:none" href="index.html#favorites">已收藏譜面</a>
    <a data-auth="user" style="display:none" href="charter_studio.html#manage">我的譜面</a>
    <a data-auth="user" style="display:none" href="charter_studio.html#profile">帳號資料</a>
    <button type="button" data-auth="user" style="display:none" data-menu-action="logout">登出</button>
  </nav>`;
  header.append(menu);
  menu.addEventListener('click', event => {
    const item = event.target.closest('a,button');
    if (!item) return;
    menu.open = false;
    if (item.dataset.menuAction === 'login') window.openLoginModal();
    if (item.dataset.menuAction === 'logout') window.logout();
  });
  document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
  });
})();
