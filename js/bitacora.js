(function () {
  // Bitacora mensual como checklist: cambios, comentarios y decisiones con fecha. Lo publicado sale de
  // data/tp-bitacora-2026.json (incrustado por el build como window.TP_BITACORA); las ediciones quedan
  // como borrador en este navegador hasta exportarlas (flujo compartido con Usuarios en js/draft-store.js).
  const DATA_URL = 'data/tp-bitacora-2026.json';
  const DRAFT_KEY = 'tp-bitacora-draft';
  const EXPORT_NAME = 'tp-bitacora-2026.json';
  const INLINE_GLOBAL = 'TP_BITACORA';
  const TYPES = { cambio: 'Cambio', comentario: 'Comentario', decision: 'Decisión' };
  const PLATFORMS = { general: 'General', meta: 'Meta Ads', tiktok: 'TikTok Ads' };

  const { today, validDate, newId, options } = window.TPDraft;
  const esc = value => window.TPData.esc(value);

  // typedDate: campo de fecha en el que se esta tecleando; dateMoved: su fecha cambio y falta reordenar;
  // pressing: boton del puntero presionado sobre la lista.
  const state = { ready: false, items: [], draft: false, type: 'all', typedDate: null, dateMoved: false, pressing: false };

  function clean(item) {
    return {
      id: String(item?.id || newId('b')),
      date: validDate(item?.date) ? item.date : today(),
      type: TYPES[item?.type] ? item.type : 'comentario',
      platform: PLATFORMS[item?.platform] ? item.platform : 'general',
      done: Boolean(item?.done),
      text: String(item?.text || '').trim(),
    };
  }

  const store = window.TPDraft.create({
    dataUrl: DATA_URL,
    draftKey: DRAFT_KEY,
    inlineGlobal: INLINE_GLOBAL,
    listKey: 'items',
    statusId: 'log-status',
    discardId: 'log-discard',
    clean,
    tag: 'bitacora',
  });
  const renderKeepingFocus = () => window.TPDraft.renderKeepingFocus('log-list', render);

  function saveDraft() {
    state.draft = true;
    store.save(state.items);
    store.renderStatus(true);
  }

  function discardDraft() {
    store.clear();
    state.items = store.publishedList();
    state.draft = false;
    render();
  }

  function exportJson() {
    window.TPDraft.downloadJson(EXPORT_NAME, {
      year: store.published().year || new Date().getFullYear(),
      updatedAt: today(),
      items: state.items.filter(item => item.text).sort((a, b) => a.date.localeCompare(b.date)),
    });
  }

  // Cada control lleva el id de su fila: asi TPData.keepFocus encuentra el mismo campo al redibujar.
  function renderItem(item) {
    const id = esc(item.id);
    return `<li class="log-item${item.done ? ' done' : ''}">
      <input class="log-check" type="checkbox" data-id="${id}" data-field="done"${item.done ? ' checked' : ''} aria-label="Marcar como hecho">
      <input class="log-date" type="date" data-id="${id}" data-field="date" value="${esc(item.date)}" aria-label="Fecha">
      <textarea class="log-text" rows="1" data-id="${id}" data-field="text" placeholder="Describe el cambio, comentario o decisión" aria-label="Detalle">${esc(item.text)}</textarea>
      <select class="log-tag ${esc(item.type)}" data-id="${id}" data-field="type" aria-label="Tipo">${options(TYPES, item.type)}</select>
      <select class="log-tag platform ${esc(item.platform)}" data-id="${id}" data-field="platform" aria-label="Plataforma">${options(PLATFORMS, item.platform)}</select>
      <button class="log-delete" type="button" data-id="${id}" data-action="delete" aria-label="Eliminar" title="Eliminar">&times;</button>
    </li>`;
  }

  // Los textos largos se ven completos: cada campo crece con su contenido.
  function fitText(field) {
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + 2}px`;
  }

  // Con la vista oculta scrollHeight es 0: solo se mide cuando se ve (al abrirla o al cambiar el ancho).
  // Se mide por fases (todos a auto, leer, escribir) para forzar un solo layout en vez de uno por campo.
  function fitAll(list = document.getElementById('log-list')) {
    if (!list?.offsetParent) return;
    const fields = [...list.querySelectorAll('textarea.log-text')];
    fields.forEach(field => { field.style.height = 'auto'; });
    const heights = fields.map(field => field.scrollHeight + 2);
    fields.forEach((field, i) => { field.style.height = `${heights[i]}px`; });
    // Si al crecer aparecio la barra de scroll, la lista se angosto: los que quedaron cortos crecen lo que falta.
    const needed = fields.map(field => field.scrollHeight + 2);
    fields.forEach((field, i) => { if (needed[i] > heights[i]) field.style.height = `${needed[i]}px`; });
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
          <div class="log-group-head"><span>${window.TPData.MONTHS[month - 1] || '-'} ${year}</span><span class="log-progress">${done}/${items.length}</span></div>
          <ul class="log-items">${items.map(renderItem).join('')}</ul>
        </section>`;
      }).join('')
      : '<div class="log-none">No hay ítems con este filtro.</div>';
    fitAll(list);
    const pending = state.items.filter(item => !item.done).length;
    const count = document.getElementById('log-count');
    if (count) count.textContent = `${state.items.length} ítems | ${pending} pendientes`;
    store.renderStatus(state.draft);
  }

  function updateItem(target) {
    const item = state.items.find(entry => entry.id === target.dataset.id);
    if (!item) return;
    const field = target.dataset.field;
    if (field === 'done') item.done = target.checked;
    else if (field === 'date') { if (!validDate(target.value)) return; item.date = target.value; }
    else if (field === 'text') item.text = target.value.trim();
    else if (field === 'type' || field === 'platform') item[field] = target.value;
    else return;
    saveDraft();
    // Solo se redibuja si cambia la lista (filtro, grupos, progreso), para no perder el foco del campo: el
    // texto se guarda mientras se escribe; plataforma, y tipo si el filtro no es por tipo, solo cambian el
    // color de su select. Tecleando la fecha cada segmento dispara change y redibujar cortaria el tecleo del
    // anio: se reordena al salir del campo (elegida en el calendario, al momento).
    if (field === 'platform') target.className = `log-tag platform ${item.platform}`;
    else if (field === 'type' && (state.type === 'all' || state.type === 'pending')) target.className = `log-tag ${item.type}`;
    else if (field === 'date' && target === state.typedDate) state.dateMoved = true;
    else if (field !== 'text') renderKeepingFocus();
  }

  // Reordena tras teclear una fecha sin cortar lo que se hace en la lista: con el boton presionado espera a
  // soltarlo (redibujar antes quitaria el control del clic y el clic se perderia) y con un select enfocado,
  // a que se elija una opcion o se salga de el (redibujar cerraria su desplegable).
  function reorderDate(checkSelect = true) {
    const select = document.activeElement;
    if (state.pressing) {
      const later = () => {
        window.removeEventListener('pointerup', later);
        window.removeEventListener('pointercancel', later);
        // Un turno despues, cuando ya paso el click de esta pulsacion.
        window.setTimeout(() => reorderDate());
      };
      window.addEventListener('pointerup', later);
      window.addEventListener('pointercancel', later);
    } else if (checkSelect && select?.tagName === 'SELECT' && select.closest('#log-list')) {
      const later = () => {
        select.removeEventListener('change', later);
        select.removeEventListener('blur', later);
        reorderDate(false);
      };
      select.addEventListener('change', later);
      select.addEventListener('blur', later);
    } else renderKeepingFocus();
  }

  function wireEvents() {
    const form = document.getElementById('log-form');
    if (form) {
      // Las opciones del formulario salen de las mismas listas que las filas.
      form.elements.type.innerHTML = options(TYPES, 'cambio');
      form.elements.platform.innerHTML = options(PLATFORMS, 'general');
    }
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
      if (event.target.dataset.field === 'date' && event.key !== 'Tab') state.typedDate = event.target;
    });
    list?.addEventListener('focusout', event => {
      if (event.target !== state.typedDate) return;
      state.typedDate = null;
      // Un turno despues el foco ya esta en el control nuevo, que reorderDate revisa.
      if (state.dateMoved) { state.dateMoved = false; window.setTimeout(() => reorderDate()); }
    });
    // El boton se puede soltar en cualquier parte de la ventana, no solo sobre la lista.
    list?.addEventListener('pointerdown', () => { state.pressing = true; });
    window.addEventListener('pointerup', () => { state.pressing = false; }, true);
    window.addEventListener('pointercancel', () => { state.pressing = false; }, true);
    list?.addEventListener('click', event => {
      const button = event.target.closest('[data-action="delete"]');
      if (!button) return;
      const id = button.dataset.id;
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
    // Envuelto: fitAll recibiria el Event como lista.
    window.addEventListener('resize', () => fitAll());
    document.getElementById('log-export')?.addEventListener('click', exportJson);
    document.getElementById('log-discard')?.addEventListener('click', () => {
      if (window.confirm('¿Descartar los cambios del borrador y volver a lo publicado?')) discardDraft();
    });
  }

  // Idempotente: la navegacion la llama cada vez que se abre la vista.
  async function init() {
    if (state.ready) { fitAll(); return; }
    state.ready = true;
    const dateInput = document.querySelector('#log-form [name="date"]');
    if (dateInput) dateInput.value = today();
    wireEvents();
    await store.load();
    const merged = store.merge(state.items);
    state.items = merged.list;
    state.draft = merged.draft;
    render();
  }

  window.Bitacora = { init, render };
})();
