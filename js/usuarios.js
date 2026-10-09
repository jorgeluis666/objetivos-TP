(function () {
  // Directorio de las cuentas con acceso al tablero. Ninguna clave pasa por aqui: esta lista solo
  // registra quien tiene acceso (el tablero publicado se abre con la clave unica de TP_PAGE_PASSWORD). Lo publicado sale de
  // data/tp-usuarios-2026.json (incrustado por el build como window.TP_USUARIOS); las ediciones quedan
  // como borrador en este navegador hasta exportarlas, igual que la Bitacora.
  const DATA_URL = 'data/tp-usuarios-2026.json';
  const DRAFT_KEY = 'tp-usuarios-draft';
  const EXPORT_NAME = 'tp-usuarios-2026.json';
  const INLINE_GLOBAL = 'TP_USUARIOS';
  const ROLES = { cliente: 'Cliente', equipo: 'Equipo Lima Retail', admin: 'Administrador' };
  const STATUSES = { activo: 'Activo', suspendido: 'Suspendido' };

  const state = { ready: false, published: { users: [] }, users: [], draft: false, status: 'all' };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const pad = value => String(value).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const newId = () => `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  // Identificador de la persona (usuario o correo), normalizado: sin espacios ni ':'.
  const cleanLogin = value => String(value || '').trim().toLowerCase().replace(/[\s:]+/g, '');

  function clean(user) {
    return {
      id: String(user?.id || newId()),
      name: String(user?.name || '').trim(),
      user: cleanLogin(user?.user),
      role: ROLES[user?.role] ? user.role : 'cliente',
      status: STATUSES[user?.status] ? user.status : 'activo',
      since: validDate(user?.since) ? user.since : today(),
    };
  }

  const publishedUsers = () => (Array.isArray(state.published.users) ? state.published.users : []).map(clean);

  function readDraft() {
    try {
      const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || 'null');
      // Un borrador hecho sobre una version anterior del archivo ya no aplica: se ignora.
      return draft && draft.base === state.published.updatedAt && Array.isArray(draft.users) ? draft.users.map(clean) : null;
    } catch {
      return null;
    }
  }

  function saveDraft() {
    state.draft = true;
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ base: state.published.updatedAt, users: state.users }));
    } catch {
      // Sin localStorage los cambios duran hasta recargar; Exportar sigue funcionando.
    }
    renderStatus();
  }

  function discardDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* sin localStorage no hay borrador guardado */ }
    state.users = publishedUsers();
    state.draft = false;
    render();
  }

  function exportJson() {
    const payload = {
      updatedAt: today(),
      users: state.users.filter(user => user.name || user.user).sort((a, b) => a.name.localeCompare(b.name, 'es')),
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

  function renderUser(user) {
    return `<li class="users-item${user.status === 'suspendido' ? ' done' : ''}" data-id="${esc(user.id)}">
      <input class="log-text" type="text" data-field="name" value="${esc(user.name)}" placeholder="Nombre" aria-label="Nombre">
      <input class="log-text users-login" type="text" data-field="user" value="${esc(user.user)}" placeholder="usuario o correo" aria-label="Usuario o correo" autocapitalize="none" spellcheck="false">
      <select class="log-tag users-role ${esc(user.role)}" data-field="role" aria-label="Rol">${options(ROLES, user.role)}</select>
      <input class="log-date" type="date" data-field="since" value="${esc(user.since)}" aria-label="Fecha de alta" title="Fecha de alta">
      <select class="log-tag users-state ${esc(user.status)}" data-field="status" aria-label="Estado">${options(STATUSES, user.status)}</select>
      <button class="log-delete" type="button" data-action="delete" aria-label="Eliminar" title="Eliminar">&times;</button>
    </li>`;
  }

  function renderStatus() {
    const status = document.getElementById('users-status');
    const discard = document.getElementById('users-discard');
    if (status) {
      const published = validDate(state.published.updatedAt) ? state.published.updatedAt.split('-').reverse().join('/') : '-';
      status.textContent = state.draft ? 'Borrador en este navegador: exporta el archivo para publicarlo.' : `Publicado al ${published}.`;
      status.classList.toggle('draft', state.draft);
    }
    if (discard) discard.hidden = !state.draft;
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
    renderStatus();
  }

  function updateUser(target) {
    const row = target.closest('.users-item');
    const user = row && state.users.find(entry => entry.id === row.dataset.id);
    if (!user) return;
    const field = target.dataset.field;
    if (field === 'name') user.name = target.value.trim();
    else if (field === 'user') user.user = cleanLogin(target.value);
    else if (field === 'since') { if (!validDate(target.value)) return; user.since = target.value; }
    else if (field === 'role' || field === 'status') user[field] = target.value;
    else return;
    saveDraft();
    render();
  }

  function wireEvents() {
    const form = document.getElementById('users-form');
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
      const id = button.closest('.users-item')?.dataset.id;
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

  async function loadPublished() {
    const inline = window[INLINE_GLOBAL];
    if (inline && typeof inline === 'object') return inline;
    try {
      const response = await fetch(DATA_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data && typeof data === 'object' ? data : { users: [] };
    } catch (error) {
      console.warn('[usuarios] no se pudo leer', DATA_URL, error);
      return { users: [] };
    }
  }

  // Idempotente: la navegacion la llama cada vez que se abre la vista.
  async function init() {
    if (state.ready) return;
    state.ready = true;
    wireEvents();
    state.published = await loadPublished();
    // Lo agregado mientras cargaba el archivo se suma a lo cargado en vez de perderse.
    const early = state.users;
    const draft = readDraft();
    state.draft = Boolean(draft);
    state.users = (draft || publishedUsers()).concat(early);
    if (early.length) saveDraft();
    render();
  }

  window.Usuarios = { init, render };
})();
