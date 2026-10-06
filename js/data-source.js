(function () {
  // Web App de scripts/google-sheets-sync.gs (proyecto independiente en script.google.com). Lee la carpeta de
  // Drive con una descarga de Meta Ads por mes y la carpeta de reportes. ?action=data devuelve el ultimo
  // barrido (todos los dias a las 10:00) y ?action=data&fresh=1 barre en el momento (boton Actualizar).
  // El repo es publico: la URL no se guarda aqui. scripts/build.js la toma del secret TP_DATA_ENDPOINT y la
  // incrusta como window.TP_DATA_ENDPOINT en dist/index.html, que solo se sirve con clave. Nunca se lee de la
  // URL ni de localStorage: un enlace manipulado podria desviar el tablero a otro origen.
  const DATA_ENDPOINT = typeof window.TP_DATA_ENDPOINT === 'string' ? window.TP_DATA_ENDPOINT.trim() : '';
  const DATA_ENDPOINT_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
  // Copia del ultimo barrido (gitignored): el build la incrusta como window.TP_META_DATA y en desarrollo se pide
  // por fetch. El tablero la muestra mientras llega (o si falla) la lectura en vivo.
  const LOCAL_URL = 'data/tp-meta-2026.json';
  // Un barrido en el momento relee las cuatro descargas (~10 s); se deja margen para meses con mas filas.
  const FETCH_TIMEOUT_MS = 90 * 1000;
  const POLL_MS = 60 * 60 * 1000;
  const VISIBILITY_REFETCH_MS = 5 * 60 * 1000;
  const TIMEZONE = 'America/Lima';
  // Lima no tiene horario de verano: 10:00 en Lima son las 15:00 UTC.
  const LIMA_OFFSET_HOURS = -5;
  const SWEEP_HOUR = 10;
  const SWEEP_ORIGINS = {
    automatico: 'barrido automatico',
    manual: 'barrido manual',
    instalacion: 'barrido de instalacion',
    prueba: 'barrido de prueba',
    inicial: 'primera lectura',
  };
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const SHORT_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const TEXT_FIELDS = ['day', 'campaign', 'adSet', 'ad', 'objective', 'resultType', 'preview'];
  const SUM_FIELDS = ['spend', 'impressions', 'reach', 'clicks', 'interactions', 'messages', 'results'];
  const REQUIRED_COLUMNS = ['day', 'campaign', 'ad', 'spend', 'impressions', 'reach', 'results'];

  // El objetivo se deduce del nombre de la campana ("Interaccion | Posts | LR - Gasto total"). Es la agrupacion
  // del reporte: cada objetivo mide su propio resultado y los resultados no se suman entre objetivos.
  const OBJECTIVES = [
    { key: 'pedidos-whatsapp', label: 'Pedidos WhatsApp', match: /pedidos.*whatsapp|whatsapp.*pedidos/, color: '#16a34a' },
    { key: 'mensajes-whatsapp', label: 'Mensajes WhatsApp', match: /whatsapp/, color: '#ca8a04' },
    { key: 'interaccion', label: 'Interaccion', match: /^interacc/, color: '#ea580c' },
    { key: 'notoriedad', label: 'Notoriedad', match: /notoriedad|thruplay/, color: '#7c3aed' },
    { key: 'trafico-ig', label: 'Trafico al Perfil (IG)', match: /trafico ig|perfil/, color: '#db2777' },
    { key: 'trafico-web', label: 'Trafico Web', match: /trafico web/, color: '#0d9488' },
  ];
  const FALLBACK_COLORS = ['#0891b2', '#4f46e5', '#b45309', '#be123c'];
  const RESULT_LABELS = [
    { match: /interacciones con la publicacion/, label: 'Interacciones' },
    { match: /thruplay/, label: 'Reproducciones (ThruPlay)' },
    { match: /contactos en el sitio web/, label: 'Clics al boton WhatsApp' },
    { match: /visitas al perfil/, label: 'Visitas al perfil' },
    { match: /visitas a la pagina de destino/, label: 'Visitas a la web' },
    { match: /conversaciones con mensajes/, label: 'Conversaciones' },
  ];

  const state = {
    data: null,
    source: null,
    loading: false,
    // Un Actualizar pulsado mientras corre una lectura silenciosa se ejecuta en cuanto esta termina.
    pendingFresh: false,
    error: '',
    lastFetch: 0,
    readyResolve: null,
  };
  const ready = new Promise(resolve => { state.readyResolve = resolve; });

  const normalize = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  const round2 = value => Math.round(Number(value) * 100) / 100;

  // ── Formatos compartidos ────────────────────────────────────────────────
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const safeUrl = value => (/^https:\/\//i.test(String(value || '').trim()) ? esc(String(value).trim()) : '');
  const finite = value => value != null && Number.isFinite(Number(value));
  const fmt = {
    money: value => (finite(value) ? `S/. ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-'),
    count: value => (finite(value) ? Math.round(Number(value)).toLocaleString('es-PE') : '-'),
    decimal: (value, digits = 2) => (finite(value) ? Number(value).toLocaleString('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '-'),
    pct: (value, digits = 1) => (finite(value) ? `${Number(value).toLocaleString('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%` : '-'),
    // Los costos por resultado de branding son centavos: se muestran con mas decimales para que no queden en 0.01.
    unitCost: value => (finite(value) && Number(value) > 0 && Number(value) < 0.1
      ? `S/. ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 3, maximumFractionDigits: 4 })}`
      : fmt.money(value)),
  };

  // ── Fechas (todas las etiquetas en hora de Lima) ─────────────────────────
  function limaParts(date) {
    const shifted = new Date(date.getTime() + LIMA_OFFSET_HOURS * 3600 * 1000);
    return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate(), weekday: shifted.getUTCDay(), hour: shifted.getUTCHours() };
  }

  function formatStamp(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    try {
      return date.toLocaleString('es-PE', { timeZone: TIMEZONE, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch {
      return date.toLocaleString('es-PE');
    }
  }

  // Proximo barrido programado en Apps Script (installSweepTriggers): todos los dias entre 10:00 y 11:00.
  function nextSweep(now = new Date()) {
    const today = limaParts(now);
    for (let offset = 0; offset <= 1; offset += 1) {
      const slot = new Date(Date.UTC(today.year, today.month, today.day + offset, SWEEP_HOUR - LIMA_OFFSET_HOURS, 0));
      if (slot > now) return slot;
    }
    return null;
  }

  function dayLabel(month, day) {
    return `${day} ${SHORT_MONTHS[month.month - 1]}`;
  }

  function rangeLabel(month, from, to) {
    if (!month) return '-';
    return from === to ? `${from} ${MONTHS[month.month - 1]}` : `${from}-${to} ${MONTHS[month.month - 1]}`;
  }

  // ── Normalizacion del barrido ───────────────────────────────────────────
  function objectiveFor(campaign) {
    const text = normalize(campaign);
    const known = OBJECTIVES.find(item => item.match.test(text));
    if (known) return known;
    const first = String(campaign || '').split('|')[0].trim().replace(/^campa(n|ñ)a\s+/i, '') || 'Sin objetivo';
    return { key: `otro-${normalize(first).replace(/[^a-z0-9]+/g, '-')}`, label: first.charAt(0).toUpperCase() + first.slice(1), color: null };
  }

  function resultLabel(resultType) {
    const text = normalize(resultType);
    if (!text) return 'Resultados';
    const hit = RESULT_LABELS.find(item => item.match.test(text));
    return hit ? hit.label : String(resultType).trim();
  }

  function normalizeMonth(raw, index) {
    const year = Number(raw.year);
    const monthNumber = Number(raw.month) || MONTHS.indexOf(raw.name) + 1;
    if (!Number.isInteger(year) || monthNumber < 1 || monthNumber > 12) return null;
    const key = `${year}-${String(monthNumber).padStart(2, '0')}`;
    const daysInMonth = new Date(year, monthNumber, 0).getDate();
    const columns = Array.isArray(raw.columns) ? raw.columns.map(String) : [];
    const missing = REQUIRED_COLUMNS.filter(name => !columns.includes(name));
    let error = raw.error ? String(raw.error) : '';
    if (!error && missing.length) error = `Faltan columnas en el barrido: ${missing.join(', ')}`;

    const rows = [];
    let outOfRange = 0;
    if (!error && Array.isArray(raw.rows)) {
      const at = Object.fromEntries(columns.map((name, position) => [name, position]));
      raw.rows.forEach(values => {
        if (!Array.isArray(values)) return;
        const row = {};
        TEXT_FIELDS.forEach(field => { row[field] = at[field] == null ? '' : String(values[at[field]] ?? '').trim(); });
        SUM_FIELDS.forEach(field => {
          const number = at[field] == null ? 0 : Number(values[at[field]]);
          row[field] = Number.isFinite(number) ? number : 0;
        });
        // Una descarga con dias de otro mes (rango mal elegido en Meta) no contamina este mes.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day) || row.day.slice(0, 7) !== key) {
          outOfRange += 1;
          return;
        }
        row.d = Number(row.day.slice(8, 10));
        const objective = objectiveFor(row.campaign);
        row.group = objective.key;
        row.groupLabel = objective.label;
        row.groupColor = objective.color;
        rows.push(row);
      });
    }
    const active = rows.filter(row => row.spend > 0 || row.impressions > 0);
    const days = (active.length ? active : rows).map(row => row.d);
    const firstDay = days.length ? Math.min(...days) : null;
    const lastDay = days.length ? Math.max(...days) : null;
    return {
      key,
      index,
      name: MONTHS[monthNumber - 1],
      shortName: SHORT_MONTHS[monthNumber - 1],
      year,
      month: monthNumber,
      daysInMonth,
      fileId: String(raw.fileId || ''),
      fileName: String(raw.fileName || ''),
      modifiedTime: String(raw.modifiedTime || ''),
      duplicates: Array.isArray(raw.duplicates) ? raw.duplicates.map(String) : [],
      error,
      outOfRange,
      rows,
      firstDay,
      lastDay,
      hasData: active.length > 0,
      complete: lastDay === daysInMonth,
    };
  }

  function normalizeReports(raw) {
    const files = Array.isArray(raw?.files) ? raw.files : [];
    return {
      folder: raw?.folder && typeof raw.folder === 'object'
        ? { id: String(raw.folder.id || ''), name: String(raw.folder.name || ''), url: String(raw.folder.url || '') }
        : null,
      files: files
        .filter(file => file && /^[A-Za-z0-9_-]+$/.test(String(file.id || '')))
        .map(file => ({
          id: String(file.id),
          title: String(file.title || ''),
          mimeType: String(file.mimeType || ''),
          sizeBytes: Number(file.sizeBytes) || 0,
          createdTime: String(file.createdTime || ''),
          modifiedTime: String(file.modifiedTime || ''),
        })),
    };
  }

  function normalizePayload(payload, source) {
    if (!payload || payload.ok === false || !Array.isArray(payload.months)) {
      throw new Error(payload?.error || 'Respuesta sin meses.');
    }
    const months = payload.months
      .map((month, index) => normalizeMonth(month, index))
      .filter(Boolean)
      .sort((a, b) => a.key.localeCompare(b.key));
    const withData = months.filter(month => month.hasData);
    const latest = withData[withData.length - 1] || null;
    // Un mes anterior al ultimo con datos ya termino aunque su descarga no llegue al ultimo dia.
    months.forEach(month => { month.past = Boolean(latest && month.key < latest.key); });
    return {
      source,
      sweptAt: String(payload.sweptAt || ''),
      origin: String(payload.origin || ''),
      months,
      year: latest ? latest.year : new Date().getFullYear(),
      latestKey: latest ? latest.key : null,
      dataEnd: latest && latest.lastDay ? `${latest.key}-${String(latest.lastDay).padStart(2, '0')}` : null,
      ignored: Array.isArray(payload.ignored) ? payload.ignored.map(item => ({ fileName: String(item?.fileName || ''), reason: String(item?.reason || '') })) : [],
      reports: normalizeReports(payload.reports),
    };
  }

  // ── Metricas ────────────────────────────────────────────────────────────
  function emptyTotals() {
    return Object.fromEntries(SUM_FIELDS.map(field => [field, 0]));
  }

  function withDerived(totals) {
    const spend = round2(totals.spend);
    return {
      ...totals,
      spend,
      // El alcance es la suma de las filas de la descarga (dia x edad x sexo x anuncio), igual que en los reportes.
      frequency: totals.reach > 0 ? totals.impressions / totals.reach : null,
      cpm: totals.impressions > 0 ? (spend / totals.impressions) * 1000 : null,
      ctr: totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : null,
      costPerResult: totals.results > 0 ? spend / totals.results : null,
    };
  }

  function summarize(rows) {
    const totals = emptyTotals();
    rows.forEach(row => { SUM_FIELDS.forEach(field => { totals[field] += row[field]; }); });
    return withDerived(totals);
  }

  // El tipo de resultado de un grupo es el que mas resultados junta (las filas sin resultado vienen vacias).
  function dominantType(rows) {
    const byType = new Map();
    rows.forEach(row => {
      if (!row.resultType) return;
      byType.set(row.resultType, (byType.get(row.resultType) || 0) + row.results + 1e-9);
    });
    let best = '';
    let bestValue = -1;
    byType.forEach((value, type) => { if (value > bestValue) { best = type; bestValue = value; } });
    return best;
  }

  function groupRows(rows, keyOf) {
    const groups = new Map();
    rows.forEach(row => {
      const key = keyOf(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    return groups;
  }

  function objectiveColor(key, index) {
    return OBJECTIVES.find(item => item.key === key)?.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length];
  }

  function objectives(rows) {
    const totalSpend = rows.reduce((sum, row) => sum + row.spend, 0);
    return [...groupRows(rows, row => row.group).entries()]
      .map(([key, items], index) => {
        const totals = summarize(items);
        const resultType = dominantType(items);
        return {
          key,
          label: items[0].groupLabel,
          color: items[0].groupColor || objectiveColor(key, index),
          resultType,
          resultLabel: resultLabel(resultType),
          campaigns: [...new Set(items.map(row => row.campaign))],
          share: totalSpend > 0 ? (totals.spend / totalSpend) * 100 : 0,
          ...totals,
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }

  function campaigns(rows) {
    const totalSpend = rows.reduce((sum, row) => sum + row.spend, 0);
    return [...groupRows(rows, row => row.campaign).entries()]
      .map(([name, items]) => {
        const totals = summarize(items);
        const resultType = dominantType(items);
        return {
          name,
          group: items[0].group,
          groupLabel: items[0].groupLabel,
          resultType,
          resultLabel: resultLabel(resultType),
          share: totalSpend > 0 ? (totals.spend / totalSpend) * 100 : 0,
          ...totals,
        };
      })
      .sort((a, b) => b.spend - a.spend);
  }

  // Como en el ranking del reporte, un anuncio es su nombre dentro de un objetivo: si la misma pieza corre en
  // varios conjuntos (Remarketing, Nuevo publico) se suma, y asi se puede comparar con el mes anterior.
  function ads(rows) {
    return [...groupRows(rows, row => `${row.group}|${normalize(row.ad)}`).entries()]
      .map(([key, items]) => {
        const totals = summarize(items);
        const resultType = dominantType(items);
        const days = items.filter(row => row.spend > 0 || row.impressions > 0).map(row => row.d);
        return {
          key,
          group: items[0].group,
          groupLabel: items[0].groupLabel,
          groupColor: items[0].groupColor,
          campaigns: [...new Set(items.map(row => row.campaign).filter(Boolean))],
          adSets: [...new Set(items.map(row => row.adSet).filter(Boolean))],
          ad: items[0].ad,
          resultType,
          resultLabel: resultLabel(resultType),
          preview: items.find(row => row.preview)?.preview || '',
          firstDay: days.length ? Math.min(...days) : null,
          lastDay: days.length ? Math.max(...days) : null,
          ...totals,
        };
      });
  }

  function rowsBetween(month, from, to) {
    if (!month) return [];
    return month.rows.filter(row => row.d >= from && row.d <= to);
  }

  // Valores por dia (indice 0 = dia 1). Los dias posteriores al ultimo dato quedan en null.
  function dailyValues(month, field, filter) {
    const values = Array.from({ length: month.daysInMonth }, (_, i) => (month.lastDay && i + 1 <= month.lastDay ? 0 : null));
    month.rows.forEach(row => {
      if (filter && !filter(row)) return;
      if (values[row.d - 1] != null) values[row.d - 1] += row[field];
    });
    return values;
  }

  function cumulative(values) {
    let total = 0;
    return values.map(value => (value == null ? null : (total += value)));
  }

  function monthByKey(key) {
    return state.data?.months.find(month => month.key === key) || null;
  }

  function previousMonth(month) {
    if (!month) return null;
    const date = new Date(month.year, month.month - 2, 1);
    return monthByKey(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
  }

  // Tramo del mes y tramo equivalente del mes anterior, como en el reporte ("1-20 Sep vs 1-20 Ago").
  // Un mes cerrado se compara completo contra el mes anterior completo.
  function period(month) {
    if (!month || !month.hasData) return null;
    const closed = month.complete || month.past;
    const from = closed ? 1 : month.firstDay;
    const to = closed ? month.daysInMonth : month.lastDay;
    const prev = previousMonth(month);
    let compare = null;
    if (prev && prev.hasData) {
      const prevTo = closed ? prev.daysInMonth : Math.min(to, prev.daysInMonth);
      compare = { month: prev, from: 1, to: prevTo, rows: rowsBetween(prev, 1, prevTo), label: rangeLabel(prev, 1, prevTo) };
    }
    return {
      month,
      from,
      to,
      closed,
      rows: rowsBetween(month, from, to),
      label: rangeLabel(month, month.firstDay && month.firstDay > from ? month.firstDay : from, Math.min(to, month.lastDay || to)),
      compare,
    };
  }

  function change(current, previous) {
    if (!finite(current) || !finite(previous) || Number(previous) === 0) return null;
    return ((Number(current) - Number(previous)) / Number(previous)) * 100;
  }

  // ── Carga ───────────────────────────────────────────────────────────────
  function endpoint() {
    return DATA_ENDPOINT_RE.test(DATA_ENDPOINT) ? DATA_ENDPOINT : '';
  }

  async function fetchJson(url) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller?.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Google no respondio a tiempo');
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function publish(data) {
    state.data = data;
    state.source = data.source;
    updateStatusLabel();
    window.dispatchEvent(new CustomEvent('tp:data-updated', { detail: { source: data.source } }));
  }

  async function loadLocal() {
    const payload = window.TP_META_DATA || await fetchJson(LOCAL_URL);
    publish(normalizePayload(payload, 'local'));
  }

  async function loadLive({ fresh = false } = {}) {
    const url = endpoint();
    if (!url) throw new Error('Falta configurar la URL del Web App');
    const payload = await fetchJson(`${url}?action=data${fresh ? '&fresh=1' : ''}`);
    state.lastFetch = Date.now();
    publish(normalizePayload(payload, 'live'));
  }

  function refreshButtons() {
    return [...document.querySelectorAll('[data-tp-refresh]')];
  }

  function setRefreshing(isLoading) {
    refreshButtons().forEach(button => {
      button.disabled = isLoading;
      button.textContent = isLoading ? 'Actualizando...' : 'Actualizar';
    });
  }

  // Boton Actualizar: barrido en el momento de las dos carpetas de Drive (descargas de Meta y reportes).
  async function refresh({ fresh = true, silent = false } = {}) {
    if (state.loading) {
      // Actualizar pulsado durante una lectura silenciosa: se ejecuta en cuanto esta termina.
      if (!silent && fresh) {
        state.pendingFresh = true;
        setRefreshing(true);
      }
      return { ok: false, error: 'Ya hay una actualizacion en curso' };
    }
    state.loading = true;
    state.error = '';
    if (!silent) {
      setRefreshing(true);
      updateStatusLabel('Leyendo la carpeta de Drive...');
    }
    let result;
    try {
      await loadLive({ fresh });
      result = { ok: true };
    } catch (error) {
      state.error = String(error?.message || error);
      console.warn('[tp] No se pudo leer el Web App:', error);
      updateStatusLabel();
      window.dispatchEvent(new CustomEvent('tp:data-error', { detail: { error: state.error } }));
      result = { ok: false, error: state.error };
    } finally {
      state.loading = false;
    }
    if (state.pendingFresh) {
      state.pendingFresh = false;
      return refresh({ fresh: true });
    }
    if (!silent) setRefreshing(false);
    return result;
  }

  function statusLabel() {
    const data = state.data;
    if (!data) return state.error ? 'Sin datos: no se pudo leer Google' : 'Cargando datos...';
    const month = monthByKey(data.latestKey);
    const dataPart = month && month.lastDay ? `Datos al ${month.lastDay} de ${month.name.toLowerCase()}` : 'Sin datos';
    if (state.error) return `${dataPart} | sin conexion con Google`;
    if (data.source === 'local') return `${dataPart} | copia guardada`;
    if (!data.sweptAt) return dataPart;
    // El origen deja ver de un vistazo si el ultimo barrido fue el automatico o el boton Actualizar.
    return `${dataPart} | ${SWEEP_ORIGINS[data.origin] || 'barrido'} ${formatStamp(data.sweptAt)}`;
  }

  function updateStatusLabel(text) {
    const label = document.getElementById('topbar-status');
    if (label) label.textContent = text || statusLabel();
    const pill = label?.closest('.topbar-pill');
    if (pill) pill.classList.toggle('warn', Boolean(state.error) || state.data?.source === 'local');
  }

  async function init() {
    // Todos los botones Actualizar (Gasto publicitario, Proyecciones y Archivo de Reportes) estan en el HTML.
    refreshButtons().forEach(button => button.addEventListener('click', () => refresh({ fresh: true })));
    try {
      await loadLocal();
    } catch (error) {
      console.warn('[tp] Sin copia local de datos:', error);
    }
    if (endpoint()) await refresh({ fresh: false, silent: true });
    if (!state.data) {
      // Sin copia local ni Web App: los modulos dejan de esperar y muestran el motivo.
      if (!state.error) state.error = endpoint() ? 'No llegaron datos de Google' : 'Falta la URL del Web App en este build';
      updateStatusLabel();
      window.dispatchEvent(new CustomEvent('tp:data-error', { detail: { error: state.error } }));
    }
    state.readyResolve();
    setInterval(() => refresh({ fresh: false, silent: true }), POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - state.lastFetch > VISIBILITY_REFETCH_MS) refresh({ fresh: false, silent: true });
    });
  }

  window.TPData = {
    ready,
    refresh,
    snapshot: () => state.data,
    status: () => ({ source: state.source, loading: state.loading, error: state.error, endpoint: Boolean(endpoint()) }),
    statusLabel,
    monthByKey,
    previousMonth,
    latestMonth: () => monthByKey(state.data?.latestKey),
    nextSweep,
    formatStamp,
    limaParts,
    metrics: { summarize, objectives, campaigns, ads, rowsBetween, dailyValues, cumulative, period, change, resultLabel, dayLabel, rangeLabel },
    fmt,
    esc,
    safeUrl,
    MONTHS,
    SHORT_MONTHS,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
