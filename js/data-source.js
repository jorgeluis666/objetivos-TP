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
  // Columnas del barrido que usa el tablero; las demas se ignoran (un Web App sin reimplementar puede mandar de mas).
  const TEXT_FIELDS = ['day', 'campaign', 'adSet', 'ad', 'resultType', 'preview'];
  const SUM_FIELDS = ['spend', 'impressions', 'reach', 'clicks', 'results'];
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
  // Un objetivo fuera de OBJECTIVES toma el siguiente color la primera vez que aparece y lo conserva: no cambia
  // entre meses, la vista anual ni los modulos.
  const otherColors = new Map();
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
    loading: false,
    // Un Actualizar pulsado mientras corre una lectura silenciosa se ejecuta en cuanto esta termina.
    pendingFresh: false,
    error: '',
    lastFetch: 0,
  };

  const normalize = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  const round2 = value => Math.round(Number(value) * 100) / 100;
  // El tablero solo muestra lo que tuvo gasto o impresiones en las filas dadas: objetivos, campanas, conjuntos y
  // anuncios sin ninguno de los dos quedan fuera. Sirve para filas y para agregados.
  const hasActivity = item => item.spend > 0 || item.impressions > 0;

  // ── Formatos compartidos ────────────────────────────────────────────────
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const safeUrl = value => (/^https:\/\//i.test(String(value || '').trim()) ? esc(String(value).trim()) : '');
  const finite = value => value != null && Number.isFinite(Number(value));
  // toLocaleString con opciones arma un Intl.NumberFormat en cada llamada: se guarda uno por cantidad de decimales.
  const numberFormats = new Map();
  function formatNumber(value, min, max) {
    const key = `${min}|${max}`;
    if (!numberFormats.has(key)) numberFormats.set(key, new Intl.NumberFormat('es-PE', { minimumFractionDigits: min, maximumFractionDigits: max }));
    return numberFormats.get(key).format(Number(value));
  }
  const fmt = {
    money: value => (finite(value) ? `S/. ${formatNumber(value, 2, 2)}` : '-'),
    count: value => (finite(value) ? Math.round(Number(value)).toLocaleString('es-PE') : '-'),
    decimal: (value, digits = 2) => (finite(value) ? formatNumber(value, digits, digits) : '-'),
    pct: (value, digits = 1) => (finite(value) ? `${formatNumber(value, digits, digits)}%` : '-'),
    // Los costos por resultado de branding son centavos: se muestran con mas decimales para que no queden en 0.01.
    unitCost: value => (finite(value) && Number(value) > 0 && Number(value) < 0.1
      ? `S/. ${formatNumber(value, 3, 4)}`
      : fmt.money(value)),
  };

  // ── Utilidades de los modulos ───────────────────────────────────────────
  // Descarga un archivo armado en el navegador (exportar de Bitacora, Usuarios y la Calculadora).
  function download(fileName, content, mimeType) {
    const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Lo que identifica a un control entre dos render: el id o, sin id, tag, name, value (radio/checkbox) y data-*.
  function focusTarget(node) {
    const type = node.tagName === 'INPUT' ? node.type : '';
    return {
      id: node.id,
      tagName: node.tagName,
      name: node.getAttribute('name'),
      value: type === 'radio' || type === 'checkbox' ? node.value : null,
      data: [...node.attributes].filter(attr => attr.name.startsWith('data-')).map(attr => `${attr.name}=${attr.value}`).sort().join('\n'),
    };
  }

  function textSelection(node) {
    if (node.tagName !== 'INPUT' && node.tagName !== 'TEXTAREA') return null;
    try {
      // Los tipos sin seleccion (number, email, checkbox...) devuelven null o lanzan.
      return typeof node.selectionStart === 'number'
        ? { start: node.selectionStart, end: node.selectionEnd, direction: node.selectionDirection || 'none' }
        : null;
    } catch {
      return null;
    }
  }

  // Un render que reemplaza el HTML de root no debe sacar al usuario del campo en el que estaba: se enfoca el
  // control equivalente del HTML nuevo y se le devuelve la seleccion de texto.
  function keepFocus(root, render) {
    const active = document.activeElement;
    if (!root || !active || active === root || !root.contains(active)) return render();
    const target = focusTarget(active);
    const selection = textSelection(active);
    const result = render();
    if (document.activeElement === active) return result;
    const match = target.id
      ? [...root.querySelectorAll('[id]')].find(node => node.id === target.id)
      : [...root.querySelectorAll(target.tagName)].find(node => {
        const candidate = focusTarget(node);
        return candidate.name === target.name && candidate.value === target.value && candidate.data === target.data;
      });
    if (!match) return result;
    match.focus({ preventScroll: true });
    if (selection && textSelection(match)) {
      try {
        match.setSelectionRange(selection.start, selection.end, selection.direction);
      } catch {
        // El campo nuevo no admite seleccion: queda enfocado con el cursor donde lo deje el navegador.
      }
    }
    return result;
  }

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
    const key = `otro-${normalize(first).replace(/[^a-z0-9]+/g, '-')}`;
    if (!otherColors.has(key)) otherColors.set(key, FALLBACK_COLORS[otherColors.size % FALLBACK_COLORS.length]);
    return { key, label: first.charAt(0).toUpperCase() + first.slice(1), color: otherColors.get(key) };
  }

  function resultLabel(resultType) {
    const text = normalize(resultType);
    if (!text) return 'Resultados';
    const hit = RESULT_LABELS.find(item => item.match.test(text));
    return hit ? hit.label : String(resultType).trim();
  }

  function normalizeMonth(raw) {
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
    const active = rows.filter(hasActivity);
    const days = (active.length ? active : rows).map(row => row.d);
    const firstDay = days.length ? Math.min(...days) : null;
    const lastDay = days.length ? Math.max(...days) : null;
    return {
      key,
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
          modifiedTime: String(file.modifiedTime || ''),
        })),
      // El Web App conserva la lista del barrido anterior si no pudo releer la carpeta y lo avisa aqui.
      error: raw?.error ? String(raw.error) : '',
    };
  }

  function normalizePayload(payload, source) {
    if (!payload || payload.ok === false || !Array.isArray(payload.months)) {
      throw new Error(payload?.error || 'Respuesta sin meses.');
    }
    const months = payload.months
      .map(month => normalizeMonth(month))
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

  // Objetivos, campanas y conjuntos se arman igual: totales, resultado dominante y % del gasto de las filas dadas,
  // solo los que tuvieron actividad y de mayor a menor gasto. describe aporta los campos propios de cada uno.
  function rank(rows, keyOf, describe) {
    const totalSpend = rows.reduce((sum, row) => sum + row.spend, 0);
    return [...groupRows(rows, keyOf).entries()]
      .map(([key, items]) => {
        const totals = summarize(items);
        const resultType = dominantType(items);
        return {
          ...describe(key, items),
          resultType,
          resultLabel: resultLabel(resultType),
          share: totalSpend > 0 ? (totals.spend / totalSpend) * 100 : 0,
          ...totals,
        };
      })
      .filter(hasActivity)
      .sort((a, b) => b.spend - a.spend);
  }

  // Las listas de nombres salen de las filas activas: una campana en cero no se nombra aunque traiga resultados
  // atribuidos tarde.
  function objectives(rows) {
    return rank(rows, row => row.group, (key, items) => ({
      key,
      label: items[0].groupLabel,
      color: items[0].groupColor,
      campaigns: [...new Set(items.filter(hasActivity).map(row => row.campaign))],
    }));
  }

  function campaigns(rows) {
    return rank(rows, row => row.campaign, (name, items) => ({
      name,
      group: items[0].group,
      groupLabel: items[0].groupLabel,
    }));
  }

  // Conjuntos de anuncios. Como los anuncios, un conjunto es su nombre dentro de un objetivo: asi se compara con
  // el mes anterior aunque la campana cambie de nombre ("LR" -> "LR - Gasto total"). share es sobre las filas dadas.
  function adSets(rows) {
    return rank(rows, row => `${row.group}|${normalize(row.adSet)}`, (key, items) => {
      const activeRows = items.filter(hasActivity);
      return {
        key,
        group: items[0].group,
        name: items[0].adSet,
        campaigns: [...new Set(activeRows.map(row => row.campaign).filter(Boolean))],
        adCount: new Set(activeRows.map(row => normalize(row.ad))).size,
      };
    });
  }

  // Como en el ranking del reporte, un anuncio es su nombre dentro de un objetivo: si la misma pieza corre en
  // varios conjuntos (Remarketing, Nuevo publico) se suma, y asi se puede comparar con el mes anterior.
  function ads(rows) {
    return [...groupRows(rows, row => `${row.group}|${normalize(row.ad)}`).entries()]
      .map(([key, items]) => {
        const totals = summarize(items);
        const resultType = dominantType(items);
        const activeRows = items.filter(hasActivity);
        const days = activeRows.map(row => row.d);
        // En la vista anual el dia del mes no basta: las fechas completas dan el rango entre meses.
        const dates = activeRows.map(row => row.day).sort();
        return {
          key,
          group: items[0].group,
          groupLabel: items[0].groupLabel,
          campaigns: [...new Set(activeRows.map(row => row.campaign).filter(Boolean))],
          adSets: [...new Set(activeRows.map(row => row.adSet).filter(Boolean))],
          ad: items[0].ad,
          resultType,
          resultLabel: resultLabel(resultType),
          preview: items.find(row => row.preview)?.preview || '',
          firstDay: days.length ? Math.min(...days) : null,
          lastDay: days.length ? Math.max(...days) : null,
          firstDate: dates[0] || null,
          lastDate: dates[dates.length - 1] || null,
          ...totals,
        };
      })
      .filter(hasActivity);
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
      year: month.year,
      from,
      to,
      closed,
      rows: rowsBetween(month, from, to),
      label: rangeLabel(month, month.firstDay && month.firstDay > from ? month.firstDay : from, Math.min(to, month.lastDay || to)),
      compare,
    };
  }

  // Vista anual: todos los meses del año con descarga ("1 Junio - 30 Septiembre"). No hay descargas del año
  // anterior, asi que no lleva comparacion. Sin año, el del ultimo mes con datos.
  function yearPeriod(year) {
    const target = year == null ? state.data?.year : Number(year);
    const months = (state.data?.months || []).filter(month => month.hasData && month.year === target);
    if (!months.length) return null;
    const first = months[0];
    const last = months[months.length - 1];
    return {
      annual: true,
      month: null,
      months,
      year: target,
      closed: last.month === 12 && last.complete,
      rows: months.flatMap(month => month.rows),
      label: `${first.firstDay} ${first.name} - ${last.lastDay} ${last.name}`,
      compare: null,
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Google no respondio a tiempo');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function publish(data) {
    state.data = data;
    updateStatusLabel();
    window.dispatchEvent(new CustomEvent('tp:data-updated'));
  }

  async function loadLocal() {
    const payload = window.TP_META_DATA || await fetchJson(LOCAL_URL);
    publish(normalizePayload(payload, 'local'));
  }

  // El sondeo trae casi siempre el barrido diario que ya se ve (mismo sweptAt y origen): publicarlo de nuevo solo
  // volveria a pintar todos los modulos.
  function sameSweep(payload) {
    const data = state.data;
    return Boolean(data && data.source === 'live' && data.sweptAt && payload?.ok !== false && Array.isArray(payload?.months)
      && String(payload.sweptAt || '') === data.sweptAt && String(payload.origin || '') === data.origin);
  }

  async function loadLive({ fresh = false, skipSame = false } = {}) {
    const url = endpoint();
    if (!url) throw new Error('Falta configurar la URL del Web App');
    const payload = await fetchJson(`${url}?action=data${fresh ? '&fresh=1' : ''}`);
    state.lastFetch = Date.now();
    if (skipSame && sameSweep(payload)) {
      updateStatusLabel();
      return;
    }
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
    // Una lectura silenciosa sin error previo puede saltarse el barrido que ya se ve; Actualizar siempre publica.
    const skipSame = silent && !fresh && !state.error;
    state.error = '';
    if (!silent) {
      setRefreshing(true);
      updateStatusLabel('Leyendo la carpeta de Drive...');
    }
    let result;
    try {
      await loadLive({ fresh, skipSame });
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
    renderStatusCard();
  }

  // Detalle de la actualizacion: todo lo que antes estaba repartido entre la franja de barrido del
  // modulo de Reportes y la barra de periodo vive aqui, junto al unico boton Actualizar.
  function renderStatusCard() {
    const card = document.getElementById('data-status-card');
    if (!card) return;
    const data = state.data;
    const month = data ? monthByKey(data.latestKey) : null;
    const set = (id, value) => {
      const node = document.getElementById(id);
      if (node) node.textContent = value || '-';
    };
    set('status-data', month && month.lastDay
      ? `${month.firstDay || 1}-${month.lastDay} ${month.name} ${month.year}`
      : (data ? 'Sin descargas con gasto' : (state.error ? 'Sin datos' : 'Cargando...')));
    set('status-last', data?.sweptAt ? `${SWEEP_ORIGINS[data.origin] || 'barrido'} · ${formatStamp(data.sweptAt)}` : 'sin registro');
    renderNextSweep();
    set('status-file', month?.fileName || '-');
    set('status-source', data ? (data.source === 'live' ? 'Google Drive en vivo' : 'copia guardada en el tablero') : '-');
    const note = document.getElementById('status-note');
    if (!note) return;
    // Un solo aviso, por orden de gravedad: sin conexion, copia guardada o descarga del mes en curso.
    let message = '';
    let isError = false;
    if (state.error) {
      message = `Sin conexion con Google: ${state.error}.${data ? ' Se muestran los ultimos datos leidos.' : ''}`;
      isError = true;
    } else if (data?.source === 'local') {
      message = 'Copia guardada en el tablero: todavia no llego la lectura en vivo.';
    } else if (month && month.lastDay && !month.complete) {
      message = `El dia ${month.lastDay} es el de la descarga y puede estar incompleto.`;
    }
    note.textContent = message;
    note.classList.toggle('error', isError);
    note.hidden = !message;
  }

  function renderNextSweep() {
    const node = document.getElementById('status-next');
    if (!node) return;
    const next = nextSweep();
    node.textContent = next ? `${formatStamp(next)} · cada dia a las ${SWEEP_HOUR}:00` : '-';
  }

  function wireStatusCard() {
    const button = document.getElementById('data-status-btn');
    const card = document.getElementById('data-status-card');
    if (!button || !card) return;
    const close = () => {
      card.hidden = true;
      button.setAttribute('aria-expanded', 'false');
    };
    button.addEventListener('click', event => {
      event.stopPropagation();
      const open = card.hidden;
      // El proximo barrido depende de la hora: se recalcula al abrir el detalle.
      if (open) renderNextSweep();
      card.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', event => {
      if (!card.hidden && !card.contains(event.target) && event.target !== button) close();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
  }

  async function init() {
    // El unico boton Actualizar vive en la barra superior, junto al estado de los datos.
    refreshButtons().forEach(button => button.addEventListener('click', () => refresh({ fresh: true })));
    wireStatusCard();
    try {
      await loadLocal();
    } catch (error) {
      console.warn('[tp] Sin copia local de datos:', error);
    }
    const live = endpoint();
    if (live) await refresh({ fresh: false, silent: true });
    if (!state.data) {
      // Sin copia local ni Web App: los modulos dejan de esperar y muestran el motivo.
      if (!state.error) state.error = live ? 'No llegaron datos de Google' : 'Falta la URL del Web App en este build';
      updateStatusLabel();
      window.dispatchEvent(new CustomEvent('tp:data-error', { detail: { error: state.error } }));
    }
    // Sin Web App (desarrollo) no hay lectura en vivo que repetir: solo el boton Actualizar la intenta.
    if (!live) return;
    setInterval(() => refresh({ fresh: false, silent: true }), POLL_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - state.lastFetch > VISIBILITY_REFETCH_MS) refresh({ fresh: false, silent: true });
    });
  }

  window.TPData = {
    snapshot: () => state.data,
    status: () => ({ error: state.error }),
    statusLabel,
    monthByKey,
    previousMonth,
    latestMonth: () => monthByKey(state.data?.latestKey),
    formatStamp,
    limaParts,
    metrics: { hasActivity, summarize, objectives, campaigns, adSets, ads, dailyValues, cumulative, period, yearPeriod, change },
    fmt,
    esc,
    safeUrl,
    download,
    keepFocus,
    MONTHS,
    SHORT_MONTHS,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
