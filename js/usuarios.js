(function () {
  // Directorio de las cuentas con acceso al tablero. Ninguna clave pasa por aqui: esta lista solo
  // registra quien tiene acceso (el tablero publicado se abre con la clave unica de TP_PAGE_PASSWORD). Lo publicado sale de
  // data/tp-usuarios-2026.json (incrustado por el build como window.TP_USUARIOS); las ediciones quedan
  // como borrador en este navegador hasta exportarlas, igual que la Bitacora (js/draft-store.js).
  const DATA_URL = 'data/tp-usuarios-2026.json';
  const DRAFT_KEY = 'tp-usuarios-draft';
  const EXPORT_NAME = 'tp-usuarios-2026.json';
  const INLINE_GLOBAL = 'TP_USUARIOS';
  const ROLES = { cliente: 'Cliente', equipo: 'Equipo Lima Retail', admin: 'Administrador' };
  const STATUSES = { activo: 'Activo', suspendido: 'Suspendido' };

  const { today, validDate, newId, options } = window.TPDraft;
  const esc = value => window.TPData.esc(value);
  // Identificador de la persona (usuario o correo), normalizado: sin espacios ni ':'.
  const cleanLogin = value => String(value || '').trim().toLowerCase().replace(/[\s:]+/g, '');

  const state = { ready: false, users: [], draft: false, status: 'all' };

  function clean(user) {
    return {
      id: String(user?.id || newId('u')),
      name: String(user?.name || '').trim(),
      user: cleanLogin(user?.user),
      role: ROLES[user?.role] ? user.role : 'cliente',
      status: STATUSES[user?.status] ? user.status : 'activo',
      since: validDate(user?.since) ? user.since : today(),
    };
  }

  const store = window.TPDraft.create({
    dataUrl: DATA_URL,
    draftKey: DRAFT_KEY,
    inlineGlobal: INLINE_GLOBAL,
    listKey: 'users',
    statusId: 'users-status',
    discardId: 'users-discard',
    clean,
    tag: 'usuarios',
  });
  const renderKeepingFocus = () => window.TPDraft.renderKeepingFocus('users-list', render);

  function saveDraft() {
    state.draft = true;
    store.save(state.users);
    store.renderStatus(true);
  }

  function discardDraft() {
    store.clear();
    state.users = store.publishedList();
    state.draft = false;
    render();
  }

  function exportJson() {
    window.TPDraft.downloadJson(EXPORT_NAME, {
      updatedAt: today(),
      users: state.users.filter(user => user.name || user.user).sort((a, b) => a.name.localeCompare(b.name, 'es')),
    });
  }

  // Cada control lleva el id de su fila: asi TPData.keepFocus encuentra el mismo campo al redibujar.
  function renderUser(user) {
    const id = esc(user.id);
    return `<li class="users-item${user.status === 'suspendido' ? ' done' : ''}">
      <input class="log-text" type="text" data-id="${id}" data-field="name" value="${esc(user.name)}" placeholder="Nombre" aria-label="Nombre">
      <input class="log-text users-login" type="text" data-id="${id}" data-field="user" value="${esc(user.user)}" placeholder="usuario o correo" aria-label="Usuario o correo" autocapitalize="none" spellcheck="false">
      <select class="log-tag users-role ${esc(user.role)}" data-id="${id}" data-field="role" aria-label="Rol">${options(ROLES, user.role)}</select>
      <input class="log-date" type="date" data-id="${id}" data-field="since" value="${esc(user.since)}" aria-label="Fecha de alta" title="Fecha de alta">
      <select class="log-tag users-state ${esc(user.status)}" data-id="${id}" data-field="status" aria-label="Estado">${options(STATUSES, user.status)}</select>
      <button class="log-delete" type="button" data-id="${id}" data-action="delete" aria-label="Eliminar" title="Eliminar">&times;</button>
    </li>`;
  }

  function render() {
    const list = document.getElementById('users-list');
    if (!list) return;
    const visible = state.users
      .filter(user => state.status === 'all' || user.status === state.status)
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    list.innerHTML = visible.length
      ? `<div class="users-head" aria-hidden="true"><span>Nombre</span><span>Usuario o correo</span><span>Rol</span><span>Alta</span><span>Estado</span><span></span></div>
        <ul class="log-items">${visible.map(renderUser).join('')}</ul>`
      : `<div class="log-none">${state.users.length ? 'No hay usuarios con este filtro.' : 'Todavía no hay usuarios registrados.'}</div>`;
    const active = state.users.filter(user => user.status === 'activo').length;
    const count = document.getElementById('users-count');
    if (count) count.textContent = `${state.users.length} usuarios | ${active} activos`;
    store.renderStatus(state.draft);
  }

  function updateUser(target) {
    const user = state.users.find(entry => entry.id === target.dataset.id);
    if (!user) return;
    const field = target.dataset.field;
    const login = field === 'user' ? cleanLogin(target.value) : '';
    // El usuario sigue las mismas reglas que el alta: ni vacio ni repetido.
    if (field === 'user' && (!login || state.users.some(entry => entry !== user && entry.user === login))) {
      window.alert(login ? `"${login}" ya está en la lista.` : 'El usuario o correo no puede quedar vacío.');
      target.value = user.user;
      return;
    }
    if (field === 'name') user.name = target.value.trim();
    else if (field === 'user') user.user = login;
    else if (field === 'since') { if (!validDate(target.value)) return; user.since = target.value; }
    else if (field === 'role' || field === 'status') user[field] = target.value;
    else return;
    saveDraft();
    // Nombre (orden) y estado (filtro, conteo) cambian la lista; el resto solo toca su propio campo, que asi
    // no pierde el foco.
    if (field === 'user') target.value = user.user;
    else if (field === 'role') target.className = `log-tag users-role ${user.role}`;
    else if (field === 'name' || field === 'status') renderKeepingFocus();
  }

  function wireEvents() {
    const form = document.getElementById('users-form');
    // Las opciones del formulario salen de la misma lista que las filas.
    if (form) form.elements.role.innerHTML = options(ROLES, 'cliente');
    form?.addEventListener('submit', event => {
      event.preventDefault();
      const name = form.elements.name.value.trim();
      const login = cleanLogin(form.elements.user.value);
      if (!name) { form.elements.name.focus(); return; }
      if (!login) { form.elements.user.focus(); return; }
      if (state.users.some(user => user.user === login)) {
        window.alert(`"${login}" ya está en la lista.`);
        form.elements.user.focus();
        return;
      }
      state.users.push(clean({ name, user: login, role: form.elements.role.value }));
      form.reset();
      saveDraft();
      render();
      form.elements.name.focus();
    });
    const list = document.getElementById('users-list');
    // Se guarda al terminar de editar (change), asi redibujar no quita el foco mientras se escribe.
    list?.addEventListener('change', event => updateUser(event.target));
    list?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.matches('input.log-text')) { event.preventDefault(); event.target.blur(); }
    });
    list?.addEventListener('click', event => {
      const button = event.target.closest('[data-action="delete"]');
      if (!button) return;
      const id = button.dataset.id;
      const user = state.users.find(entry => entry.id === id);
      if (user && window.confirm(`¿Quitar a "${user.name || user.user}" del directorio?`)) {
        state.users = state.users.filter(entry => entry.id !== id);
        saveDraft();
        render();
      }
    });
    document.getElementById('users-filter')?.addEventListener('change', event => {
      const input = event.target.closest('input[type="radio"]');
      if (!input) return;
      state.status = input.value;
      document.querySelectorAll('#users-filter [data-series]').forEach(pill => pill.classList.toggle('active', pill.dataset.series === state.status));
      render();
    });
    document.getElementById('users-export')?.addEventListener('click', exportJson);
    document.getElementById('users-discard')?.addEventListener('click', () => {
      if (window.confirm('¿Descartar los cambios del borrador y volver a lo publicado?')) discardDraft();
    });
  }

  // Idempotente: la navegacion la llama cada vez que se abre la vista.
  async function init() {
    if (state.ready) return;
    state.ready = true;
    wireEvents();
    await store.load();
    const merged = store.merge(state.users);
    state.users = merged.list;
    state.draft = merged.draft;
    render();
  }

  window.Usuarios = { init, render };
})();
