export function normalizeTag(value) {
  if (typeof value !== 'string') throw new Error('標籤必須是文字');
  const name = value.trim().replace(/[A-Z]/g, c => c.toLowerCase());
  if (!name) throw new Error('標籤不能為空白');
  if ([...name].length > 20) throw new Error('每個標籤最多 20 個字元');
  return name;
}

export function normalizeTags(values) {
  if (!Array.isArray(values)) throw new Error('標籤必須是清單');
  const names = [...new Set(values.map(normalizeTag))];
  if (names.length > 10) throw new Error('每張譜面最多 10 個標籤');
  return names;
}

export function createTagEditor(container, input, addButton, hint, options = {}) {
  let names = [];
  const { dropdown, search, popular } = options;
  let timer, revision = 0, active = -1, suggestions = [], open = false;
  function close() {
    ++revision; clearTimeout(timer); open = false; active = -1;
    if (dropdown) dropdown.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute?.('aria-activedescendant');
  }
  function highlight() {
    [...dropdown.children].forEach((row, index) => {
      row.classList.toggle('highlighted', index === active);
      row.setAttribute('aria-selected', String(index === active));
    });
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `${dropdown.id}-${active}`);
      dropdown.children[active].scrollIntoView?.({ block: 'nearest' });
    } else input.removeAttribute?.('aria-activedescendant');
  }
  async function load(token) {
    let query = input.value.trim();
    try {
      if (query) query = normalizeTag(query);
      const rows = query ? await search(query) : await popular();
      if (token !== revision || !open) return;
      const seen = new Set(names.map(normalizeTag));
      suggestions = [];
      for (const row of rows.slice(0, 20)) {
        const name = normalizeTag(row.name);
        if (!seen.has(name)) { suggestions.push({ name, label: name }); seen.add(name); }
        if (suggestions.length === 10) break;
      }
      if (query && !names.includes(query) && !rows.some(row => normalizeTag(row.name) === query)) {
        suggestions.push({ name: query, label: `建立標籤「${query}」` });
      }
      dropdown.replaceChildren(); active = -1;
      dropdown.setAttribute('aria-label', query ? '標籤搜尋建議' : '熱門標籤');
      suggestions.forEach((item, index) => {
        const row = document.createElement('button'); row.type = 'button';
        row.id = `${dropdown.id}-${index}`; row.className = 'tag-suggestion';
        row.setAttribute('role', 'option'); row.setAttribute('aria-selected', 'false');
        row.tabIndex = -1; row.textContent = item.label;
        row.onpointerdown = event => event.preventDefault();
        row.onclick = () => { add(item.name); input.focus(); };
        dropdown.append(row);
      });
      dropdown.hidden = !suggestions.length;
      input.setAttribute('aria-expanded', String(suggestions.length > 0));
    } catch (error) {
      if (token !== revision || !open) return;
      dropdown.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      hint.textContent = `${error.message}；仍可輸入合法自訂標籤後按新增`;
    }
  }
  function schedule() {
    if (!dropdown) return;
    close();
    if (names.length >= 10) return;
    open = true; const token = revision;
    timer = setTimeout(() => load(token), 300);
  }
  if (dropdown) {
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', dropdown.id); input.setAttribute('aria-expanded', 'false');
    dropdown.setAttribute('role', 'listbox');
    input.addEventListener('input', schedule);
    input.addEventListener('focus', schedule);
    input.addEventListener('blur', close);
  }
  function render() {
    container.replaceChildren();
    names.forEach(name => {
      const chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'tag-opt selected';
      chip.textContent = `${name} ×`; chip.setAttribute('aria-label', `移除標籤 ${name}`);
      chip.onclick = () => { names = names.filter(value => value !== name); close(); render(); };
      container.append(chip);
    });
    addButton.disabled = names.length >= 10;
    hint.textContent = `${names.length}/10 個標籤，每個最多 20 個字元${names.length >= 10 ? '；已達上限，請先移除標籤' : ''}`;
  }
  function add(value = input.value) {
    try {
      names = normalizeTags([...names, value]);
      input.value = ''; close(); render();
    } catch (error) { hint.textContent = error.message; }
  }
  addButton.onclick = () => add();
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (dropdown && !dropdown.hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      active = event.key === 'ArrowDown' ? (active + 1) % suggestions.length : (active <= 0 ? suggestions.length - 1 : active - 1);
      highlight();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      add(dropdown && !dropdown.hidden && active >= 0 ? suggestions[active].name : input.value);
    }
  });
  render();
  return { get: () => [...names], set: values => { close(); names = [...values]; input.value = ''; render(); } };
}
