(function () {
  // Bitacora mensual como checklist: cambios, comentarios y decisiones con fecha. Lo publicado sale de
  // data/tp-bitacora-2026.json (incrustado por el build como window.TP_BITACORA); las ediciones quedan
  // como borrador en este navegador hasta exportarlas.
  const DATA_URL = 'data/tp-bitacora-2026.json';
  const DRAFT_KEY = 'tp-bitacora-draft';
  const EXPORT_NAME = 'tp-bitacora-2026.json';
  const INLINE_GLOBAL = 'TP_BITACORA';
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const TYPES = { cambio: 'Cambio', comentario: 'Comentario', decision: 'Decisión' };
  const PLATFORMS = { general: 'General', meta: 'Meta Ads', tiktok: 'TikTok Ads' };

  const state = { ready: false, published: { items: [] }, items: [], draft: false, type: 'all' };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const pad = value => String(value).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const newId = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

  function clean(item) {
    return {
      id: String(item?.id || newId()),
      date: validDate(item?.date) ? item.date : today(),
      type: TYPES[item?.type] ? item.type : 'comentario',
      platform: PLATFORMS[item?.platform] ? item.platform : 'general',
      done: Boolean(item?.done),
      text: String(item?.text || '').trim(),
    };
  }

  const publishedItems = () => (Array.isArray(state.published.items) ? state.published.items : []).map(clean);

  function readDraft() {
    try {
      const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null');
      // Un borrador hecho sobre una version anterior del archivo ya no aplica: se ignora.
      return draft && draft.base === state.published.updatedAt && Array.isArray(draft.items) ? draft.items.map(clean) : null;
    } catch {
      return null;
    }
  }

  function saveDraft() {
    state.draft = true;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ base: state.published.updatedAt, items: state.items }));
    } catch {
      // Sin localStorage los cambios duran hasta recargar; Exportar sigue funcionando.
    }
    renderStatus();
  }

  function discardDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* sin localStorage no hay borrador guardado */ }
    state.items = publishedItems();
    state.draft = false;
    render();
  }

  function exportJson() {
    const payload = {
      year: state.published.year || new Date().getFullYear(),
      updatedAt: today(),
      items: state.items.filter(item => item.text).sort((a, b) => a.date.localeCompare(b.date)),
    };
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = EXPORT_NAME;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function options(map, selected) {
    return Object.entries(map).map(([value, text]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${text}</option>`).join('');
  }

  function renderItem(item) {
    return `<li class="log-item${item.done ? ' done' : ''}" data-id="${esc(item.id)}">
      <input class="log-check" type="checkbox" data-field="done"${item.done ? ' checked' : ''} aria-label="Marcar como hecho">
      <input class="log-date" type="date" data-field="date" value="${esc(item.date)}" aria-label="Fecha">
      <textarea class="log-text" rows="1" data-field="text" placeholder="Describe el cambio, comentario o decisión" aria-label="Detalle">${esc(item.text)}</textarea>
      <select class="log-tag ${esc(item.type)}" data-field="type" aria-label="Tipo">${options(TYPES, item.type)}</select>
      <select class="log-tag platform ${esc(item.platform)}" data-field="platform" aria-label="Plataforma">${options(PLATFORMS, item.platform)}</select>
      <button class="log-delete" type="button" data-action="delete" aria-label="Eliminar" title="Eliminar">&times;</button>
    </li>`;
  }

  // Los textos largos se ven completos: cada campo crece con su contenido.
  function fitText(field) {
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + 2}px`;
  }

  // Con la vista oculta scrollHeight es 0: solo se mide cuando se ve (al abrirla o al cambiar el ancho).
  function fitAll() {
    const list = document.getElementById('log-list');
    if (list?.offsetParent) list.querySelectorAll('textarea.log-text').forEach(fitText);
  }

  function renderStatus() {
    const status = document.getElementById('log-status');
    const discard = document.getElementById('log-discard');
    if (status) {
      const published = validDate(state.published.updatedAt) ? state.published.updatedAt.split('-').reverse().join('/') : '-';
      status.textContent = state.draft ? 'Borrador en este navegador: exporta el archivo para publicarlo.' : `Publicado al ${published}.`;
      status.classList.toggle('draft', state.draft);
    }
    if (discard) discard.hidden = !state.draft;
  }

  function render() {
    const list = document.getElementById('log-list');
    if (!list) return;
    const visible = state.items
      .filter(item => state.type === 'all' || (state.type === 'pending' ? !item.done : item.type === state.type))
      .sort((a, b) => b.date.localeCompare(a.date));
    const groups = new Map();
    visible.forEach(item => {
      const key = item.date.slice(0, 7);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    list.innerHTML = groups.size
      ? [...groups].map(([key, items]) => {
        const [year, month] = key.split('-').map(Number);
        const done = items.filter(item => item.done).length;
        return `<section class="log-group">
          <div class="log-group-head"><span>${MONTHS[month - 1] || '-'} ${year}</span><span class="log-progress">${done}/${items.length}</span></div>
          <ul class="log-items">${items.map(renderItem).join('')}</ul>
        </section>`;
      }).join('')
      : '<div class="log-none">No hay ítems con este filtro.</div>';
    fitAll();
    const pending = state.items.filter(item => !item.done).length;
    const count = document.getElementById('log-count');
    if (count) count.textContent = `${state.items.length} ítems | ${pending} pendientes`;
    renderStatus();
  }

  function updateItem(target) {
    const row = target.closest('.log-item');
    const item = row && state.items.find(entry => entry.id === row.dataset.id);
    if (!item) return;
    const field = target.dataset.field;
    if (field === 'done') item.done = target.checked;
    else if (field === 'date') { if (!validDate(target.value)) return; item.date = target.value; }
    else if (field === 'text') item.text = target.value.trim();
    else if (field === 'type' || field === 'platform') item[field] = target.value;
    else return;
    saveDraft();
    // El texto se guarda mientras se escribe sin redibujar, para no perder el foco del campo.
    if (field !== 'text') render();
  }

  function wireEvents() {
    const form = document.getElementById('log-form');
    form?.addEventListener('submit', event => {
      event.preventDefault();
      const text = form.elements.text.value.trim();
      if (!text) { form.elements.text.focus(); return; }
      state.items.push(clean({ date: form.elements.date.value, type: form.elements.type.value, platform: form.elements.platform.value, text, done: false }));
      form.elements.text.value = '';
      saveDraft();
      render();
      form.elements.text.focus();
    });
    const list = document.getElementById('log-list');
    list?.addEventListener('change', event => {
      // El texto ya se guardo en cada input; el change al perder el foco no debe redibujar otra vez.
      if (event.target.dataset.field !== 'text') updateItem(event.target);
    });
    list?.addEventListener('input', event => {
      if (event.target.dataset.field !== 'text') return;
      fitText(event.target);
      updateItem(event.target);
    });
    list?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.dataset.field === 'text') { event.preventDefault(); event.target.blur(); }
    });
    list?.addEventListener('click', event => {
      const button = event.target.closest('[data-action="delete"]');
      if (!button) return;
      const id = button.closest('.log-item')?.dataset.id;
      const item = state.items.find(entry => entry.id === id);
      if (item && (!item.text || window.confirm(`¿Eliminar "${item.text}"?`))) {
        state.items = state.items.filter(entry => entry.id !== id);
        saveDraft();
        render();
      }
    });
    document.getElementById('log-type-filter')?.addEventListener('change', event => {
      const input = event.target.closest('input[type="radio"]');
      if (!input) return;
      state.type = input.value;
      document.querySelectorAll('#log-type-filter [data-series]').forEach(pill => pill.classList.toggle('active', pill.dataset.series === state.type));
      render();
    });
    window.addEventListener('resize', fitAll);
    document.getElementById('log-export')?.addEventListener('click', exportJson);
    document.getElementById('log-discard')?.addEventListener('click', () => {
      if (window.confirm('¿Descartar los cambios del borrador y volver a lo publicado?')) discardDraft();
    });
  }

  async function loadPublished() {
    const inline = window[INLINE_GLOBAL];
    if (inline && typeof inline === 'object') return inline;
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data && typeof data === 'object' ? data : { items: [] };
    } catch (error) {
      console.warn('[bitacora] no se pudo leer', DATA_URL, error);
      return { items: [] };
    }
  }

  // Idempotente: la navegacion la llama cada vez que se abre la vista.
  async function init() {
    if (state.ready) { fitAll(); return; }
    state.ready = true;
    const dateInput = document.querySelector('#log-form [name="date"]');
    if (dateInput) dateInput.value = today();
    wireEvents();
    state.published = await loadPublished();
    // Lo agregado mientras cargaba el archivo se suma a lo cargado en vez de perderse.
    const early = state.items;
    const draft = readDraft();
    state.draft = Boolean(draft);
    state.items = (draft || publishedItems()).concat(early);
    if (early.length) saveDraft();
    render();
  }

  window.Bitacora = { init, render };
})();
