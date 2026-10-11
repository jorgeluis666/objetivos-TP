(function () {
  // Flujo compartido de Bitacora y Usuarios: lo publicado sale de un JSON del repo (incrustado por el build
  // como window.TP_*), las ediciones quedan como borrador en localStorage de este navegador y Exportar
  // descarga el archivo para reemplazarlo en data/. Cada modulo conserva su lista, sus filas y su payload.
  const esc = value => window.TPData.esc(value);
  const pad = value => String(value).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const newId = prefix => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

  function options(map, selected) {
    return Object.entries(map).map(([value, text]) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(text)}</option>`).join('');
  }

  function downloadJson(fileName, payload) {
    window.TPData.download(fileName, `${JSON.stringify(payload, null, 2)}\n`, 'application/json');
  }

  // Redibuja la lista sin perder el foco del teclado. Con Tab el change llega antes de que el foco pase al
  // campo siguiente: se espera un turno y el foco vuelve a ese campo, ya en el HTML nuevo.
  function renderKeepingFocus(listId, render) {
    window.setTimeout(() => {
      const list = document.getElementById(listId);
      if (list) window.TPData.keepFocus(list, render);
    });
  }

  // listKey es el nombre de la lista en el JSON y en el borrador ('items' o 'users').
  function create({ dataUrl, draftKey, inlineGlobal, listKey, statusId, discardId, clean, tag }) {
    let published = { [listKey]: [] };
    // Huella del contenido publicado: dos versiones del mismo dia (mismo updatedAt) no comparten borrador.
    let baseHash = '[]';

    const publishedList = () => (Array.isArray(published[listKey]) ? published[listKey] : []).map(clean);

    async function fetchPublished() {
      const inline = window[inlineGlobal];
      if (inline && typeof inline === 'object') return inline;
      try {
        const response = await fetch(dataUrl, { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return data && typeof data === 'object' ? data : { [listKey]: [] };
      } catch (error) {
        console.warn(`[${tag}] no se pudo leer`, dataUrl, error);
        return { [listKey]: [] };
      }
    }

    async function load() {
      published = await fetchPublished();
      baseHash = JSON.stringify(published[listKey] || []);
      return published;
    }

    function read() {
      try {
        const draft = JSON.parse(window.localStorage.getItem(draftKey) || 'null');
        // Un borrador hecho sobre una version anterior del archivo ya no aplica: se ignora. Los borradores
        // guardados sin huella solo se comparan por fecha.
        const sameBase = draft && draft.base === published.updatedAt && (draft.baseHash === undefined || draft.baseHash === baseHash);
        return sameBase && Array.isArray(draft[listKey]) ? draft[listKey].map(clean) : null;
      } catch {
        return null;
      }
    }

    function save(list) {
      try {
        window.localStorage.setItem(draftKey, JSON.stringify({ base: published.updatedAt, baseHash, [listKey]: list }));
      } catch {
        // Sin localStorage los cambios duran hasta recargar; Exportar sigue funcionando.
      }
    }

    function clear() {
      try { window.localStorage.removeItem(draftKey); } catch { /* sin localStorage no hay borrador guardado */ }
    }

    // Lo agregado mientras cargaba el archivo se suma a lo cargado en vez de perderse.
    function merge(early) {
      const draft = read();
      const list = (draft || publishedList()).concat(early);
      if (early.length) save(list);
      return { list, draft: Boolean(draft) || early.length > 0 };
    }

    function renderStatus(isDraft) {
      const status = document.getElementById(statusId);
      const discard = document.getElementById(discardId);
      if (status) {
        const date = validDate(published.updatedAt) ? published.updatedAt.split('-').reverse().join('/') : '-';
        status.textContent = isDraft ? 'Borrador en este navegador: exporta el archivo para publicarlo.' : `Publicado al ${date}.`;
        status.classList.toggle('draft', isDraft);
      }
      if (discard) discard.hidden = !isDraft;
    }

    return { published: () => published, publishedList, load, read, save, clear, merge, renderStatus };
  }

  window.TPDraft = { today, validDate, newId, options, downloadJson, renderKeepingFocus, create };
})();
