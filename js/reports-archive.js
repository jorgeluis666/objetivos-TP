(function () {
  // La lista de reportes llega en el mismo barrido que las descargas de Meta (window.TPData, js/data-source.js):
  // el boton Actualizar relee ambas carpetas de Drive y este modulo valida que cada mes con gasto tenga su reporte.
  // Los nombres de archivo vienen de Drive: se escapan antes de ir a innerHTML.
  const esc = value => window.TPData.esc(value);
  // Un patron por mes, en orden de calendario (la posicion es el mes 0-11).
  const MONTH_PATTERNS = [
    /\bene(?:ro)?\b/,
    /\bfeb(?:rero)?\b/,
    /\bmar(?:zo)?\b/,
    /\babr(?:il)?\b/,
    /\bmay(?:o)?\b/,
    /\bjun(?:io)?\b/,
    /\bjul(?:io)?\b/,
    /\bago(?:sto)?\b/,
    /\bse(?:pt?|t)(?:iembre)?\b/,
    /\boct(?:ubre)?\b/,
    /\bnov(?:iembre)?\b/,
    /\bdic(?:iembre)?\b/,
  ];
  const TYPES = {
    monthly: { id: 'monthly', label: 'Reporte mensual', tone: 'blue' },
    partial: { id: 'partial', label: 'Reporte parcial', tone: 'amber' },
    proposal: { id: 'proposal', label: 'Propuesta', tone: 'violet' },
    audiovisual: { id: 'audiovisual', label: 'Material audiovisual', tone: 'green' },
    recommendations: { id: 'recommendations', label: 'Recomendaciones', tone: 'rose' },
    dashboard: { id: 'dashboard', label: 'Dashboard', tone: 'slate' },
    other: { id: 'other', label: 'Otros documentos', tone: 'slate' },
  };
  // Estados de la validacion, del mas grave al mas leve.
  const STATUS = {
    error: { label: 'Archivo con error', tone: 'rose', rank: 0 },
    missing: { label: 'Falta reporte', tone: 'rose', rank: 1 },
    stale: { label: 'Reporte desactualizado', tone: 'amber', rank: 2 },
    incomplete: { label: 'Descarga incompleta', tone: 'amber', rank: 3 },
    orphan: { label: 'Sin descarga de Meta', tone: 'slate', rank: 4 },
    synced: { label: 'Sincronizado', tone: 'green', rank: 5 },
  };
  const state = {
    wired: false,
    syncedAt: '',
    reportsError: '',
    lastFocus: null,
    reports: [],
    validation: [],
    filters: { search: '', type: 'all', period: 'all', latestOnly: false },
    sort: 'recent',
  };

  const els = {};

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }

  const EXTENSION_RE = /\.(pdf|mp4|mov|avi|png|jpe?g|gif|xlsx?|csv|docx?|pptx?|zip)$/i;

  function stripExtension(title) {
    let value = String(title || '');
    while (EXTENSION_RE.test(value)) value = value.replace(EXTENSION_RE, '');
    return value;
  }

  function prettyName(title) {
    return stripExtension(title)
      .replace(/[_]+/g, ' ')
      .replace(/(\d)(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/gi, '$1 $2')
      .replace(/([a-z])(20\d{2})\b/gi, '$1 $2')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // "TerminalPesquero_Julio2026" o "1-13Sep2026": se separan letras y numeros para reconocer mes, ano y tramo.
  function titleText(title) {
    return normalize(stripExtension(title))
      .replace(/[_.]+/g, ' ')
      .replace(/(\d)([a-z])/g, '$1 $2')
      .replace(/([a-z])(\d)/g, '$1 $2');
  }

  // Mes (0-11) de la palabra de mes que aparece primero en el texto, o -1.
  function firstMonth(text) {
    let month = -1;
    let at = Infinity;
    MONTH_PATTERNS.forEach((re, index) => {
      const found = text.search(re);
      if (found >= 0 && found < at) {
        month = index;
        at = found;
      }
    });
    return month;
  }

  function detectPeriod(title) {
    const text = titleText(title);
    const yearMatch = text.match(/\b(20\d{2})\b/);
    if (!yearMatch) return null;
    const year = Number(yearMatch[1]);
    // Gana la palabra de mes que aparece primero; "mar", "may" y "set" tambien son palabras comunes
    // ("Frutos_del_Mar", "Set_de_anuncios") y solo cuentan pegadas al ano ("Mar2026", "1-13Mar2026").
    const loose = text.replace(new RegExp(`\\b(?:mar|may|set)\\b(?!\\s*${year}\\b)`, 'g'), ' ');
    let month = firstMonth(loose);
    if (month < 0) month = firstMonth(text);
    if (month < 0) return null;

    return { key: `${year}-${String(month + 1).padStart(2, '0')}`, label: `${window.TPData.MONTHS[month]} ${year}`, year, month: month + 1 };
  }

  function detectRange(title) {
    const match = titleText(title).match(/\b(\d{1,2})\s*-\s*(\d{1,2})\b/);
    if (!match) return null;
    const from = Number(match[1]);
    const to = Number(match[2]);
    return { from, to, label: `Del ${from} al ${to}` };
  }

  const MATERIAL_MIME_RE = /^image\/|spreadsheet|ms-excel|csv|zip|compressed/;
  const MATERIAL_EXTENSION_RE = /\.(png|jpe?g|gif|xlsx?|csv|zip)$/i;

  function detectType(title, mimeType, range) {
    const text = normalize(title);
    const mime = String(mimeType);
    if (mime.startsWith('video/')) return TYPES.audiovisual;
    if (text.includes('propuesta')) return TYPES.proposal;
    if (text.includes('recomendacion')) return TYPES.recommendations;
    if (text.includes('dashboard')) return TYPES.dashboard;
    const named = text.includes('reporte');
    // Imagenes, hojas de calculo y comprimidos son materiales: el mes o el tramo del nombre no los vuelve reporte.
    if (!named && (MATERIAL_MIME_RE.test(mime) || MATERIAL_EXTENSION_RE.test(String(title)))) return TYPES.other;
    if (range) return TYPES.partial;
    if (named || detectPeriod(title)) return TYPES.monthly;
    return TYPES.other;
  }

  function formatSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '--';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  // Fecha corta en hora de Lima ("7 sep 2026"), la misma que usa la cobertura (limaDay).
  function formatDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '--';
    const { year, month, day } = window.TPData.limaParts(date);
    return `${day} ${window.TPData.SHORT_MONTHS[month].toLowerCase()} ${year}`;
  }

  // Fecha calendario en Lima de un instante ISO (Drive guarda las fechas en UTC).
  function limaDay(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    const { year, month, day } = window.TPData.limaParts(date);
    return { key: `${year}-${String(month + 1).padStart(2, '0')}`, day };
  }

  function buildReports(files) {
    const reports = (files || []).map(file => {
      const range = detectRange(file.title);
      const period = detectPeriod(file.title);
      const type = detectType(file.title, file.mimeType, range);
      const isVideo = String(file.mimeType).startsWith('video/');
      const extension = (stripExtension(file.title) === file.title ? '' : file.title.split('.').pop() || '').toUpperCase();

      return {
        id: file.id,
        title: file.title,
        name: prettyName(file.title).replace(/\s*\(\d+\)\s*$/, '').trim(),
        type,
        period,
        range,
        format: extension || (isVideo ? 'MP4' : 'PDF'),
        isVideo,
        sizeBytes: Number(file.sizeBytes) || 0,
        modifiedTime: file.modifiedTime,
        viewUrl: `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
        previewUrl: `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/preview`,
        downloadUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(file.id)}`,
        latest: true,
      };
    });

    // Varias subidas comparten nombre en Drive: solo la mas reciente queda marcada como vigente.
    const groups = new Map();
    reports.forEach(report => {
      const key = `${report.type.id}|${report.period ? report.period.key : 'sin-periodo'}|${normalize(report.name)}|${report.range ? report.range.label : ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(report);
    });
    groups.forEach(group => {
      group.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
      group.forEach((report, index) => { report.latest = index === 0; });
    });

    return reports.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  }

  // ── Validacion contra Gasto publicitario ────────────────────────────────
  // Hasta que dia del mes llega un reporte: el tramo del nombre ("1-27Sep") o, si es mensual, el dia anterior a
  // su ultima edicion (un reporte editado el 7 cubre hasta el 6). Si se edito despues del mes, lo cubre completo.
  function reportCoverage(report, month) {
    if (report.range) return Math.min(report.range.to, month.daysInMonth);
    const edited = limaDay(report.modifiedTime);
    if (!edited) return 0;
    if (edited.key > month.key) return month.daysInMonth;
    if (edited.key === month.key) return Math.max(0, edited.day - 1);
    return 0;
  }

  function coverageLabel(report, coverage, month) {
    if (coverage >= month.daysInMonth) return 'Mes completo';
    if (report.range) return report.range.label;
    return coverage > 0 ? `Hasta el ${coverage}` : 'Sin cobertura';
  }

  function validate(snapshot) {
    const tp = window.TPData;
    const campaignReports = state.reports.filter(report => report.period && (report.type.id === TYPES.monthly.id || report.type.id === TYPES.partial.id));
    const keys = new Set(snapshot.months.filter(month => month.hasData || month.error).map(month => month.key));
    campaignReports.forEach(report => { if (report.period.year === snapshot.year) keys.add(report.period.key); });

    return [...keys].sort().reverse().map(key => {
      const month = tp.monthByKey(key);
      const reports = campaignReports.filter(report => report.period.key === key);
      const label = month ? `${month.name} ${month.year}` : reports[0].period.label;
      const issues = [];
      let best = null;
      let coverage = 0;

      if (!month) {
        // reports viene ordenado del mas reciente al mas antiguo.
        best = reports[0];
        issues.push({ status: 'orphan', detail: 'Hay reportes de este mes, pero su descarga de Meta no esta en la carpeta de datos.' });
      } else if (month.error) {
        issues.push({ status: 'error', detail: month.error });
      } else {
        reports.forEach(report => {
          const value = reportCoverage(report, month);
          if (!best || value > coverage || (value === coverage && new Date(report.modifiedTime) > new Date(best.modifiedTime))) {
            best = report;
            coverage = value;
          }
        });
        if (!month.hasData) {
          // El Sheet del mes existe pero no tiene gasto ni impresiones: no hay dias contra los cuales validar el reporte.
          issues.push({ status: 'orphan', detail: 'Hay reportes de este mes, pero su descarga de Meta no tiene gasto ni impresiones.' });
        } else {
          // En el mes en curso el ultimo dia de la descarga es el dia en que se bajo: aun no esta completo, asi
          // que un reporte que llega al dia anterior ya esta al dia.
          const closed = month.complete || month.past;
          const required = closed ? month.daysInMonth : Math.max(month.firstDay || 1, (month.lastDay || 1) - 1);
          if (month.past && !month.complete) {
            issues.push({ status: 'incomplete', detail: `La descarga llega al ${month.lastDay} de ${month.daysInMonth} dias: vuelve a bajarla de Meta con el mes completo.` });
          }
          if (!best) issues.push({ status: 'missing', detail: `Hay gasto del ${month.firstDay} al ${month.lastDay}, pero ningun reporte de ${month.name.toLowerCase()} en la carpeta de reportes.` });
          else if (coverage < required) issues.push({ status: 'stale', detail: `El reporte llega al ${coverage}; los datos de Meta, al ${month.lastDay}.` });
        }
      }
      if (!issues.length) issues.push({ status: 'synced', detail: month && !(month.complete || month.past) ? `Datos al ${month.lastDay}; reporte al ${coverage}.` : 'Datos y reporte con el mes completo.' });
      issues.sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank);

      return {
        label,
        month,
        spend: month ? tp.metrics.summarize(month.rows).spend : null,
        best,
        coverage,
        reports: reports.length,
        status: issues[0].status,
        issues,
      };
    });
  }

  function renderValidation() {
    const snapshot = window.TPData?.snapshot();
    if (!els.syncBody || !snapshot) return;
    state.validation = validate(snapshot);
    const rows = state.validation;
    const synced = rows.filter(row => row.status === 'synced').length;
    if (els.syncSub) {
      els.syncSub.textContent = rows.length
        ? `${synced} de ${rows.length} ${rows.length === 1 ? 'mes sincronizado' : 'meses sincronizados'} entre las descargas de Meta y los reportes de Drive.`
        : 'No hay descargas de Meta ni reportes mensuales para validar.';
    }
    if (!rows.length) {
      els.syncBody.innerHTML = '<tr><td class="table-empty" colspan="6">No hay meses para validar.</td></tr>';
    } else {
      els.syncBody.innerHTML = rows.map(row => {
        const month = row.month;
        const status = STATUS[row.status];
        const download = month
          ? `<span class="report-name">${esc(month.fileName || 'Descarga sin nombre')}</span><span class="report-file">${month.hasData ? `Datos del ${month.firstDay} al ${month.lastDay}` : 'Sin gasto'}${month.modifiedTime ? ` | editado ${esc(window.TPData.formatStamp(month.modifiedTime))}` : ''}</span>`
          : '<span class="no-data">No esta en la carpeta de datos</span>';
        const report = row.best
          ? `<div class="sync-report"><span><span class="report-name">${esc(row.best.name)}</span><span class="report-file">${esc(row.best.title)}${row.reports > 1 ? ` | ${row.reports} reportes del mes` : ''}</span></span><button type="button" class="report-btn primary" data-preview="${esc(row.best.id)}">Ver</button></div>`
          : '<span class="no-data">Sin reporte</span>';
        return `
          <tr>
            <td class="campaign-name">${esc(row.label)}</td>
            <td class="report-name-col">${download}</td>
            <td class="num">${row.spend != null ? window.TPData.fmt.money(row.spend) : '-'}</td>
            <td class="report-name-col">${report}</td>
            <td class="date-col">${row.best && month ? esc(coverageLabel(row.best, row.coverage, month)) : '-'}</td>
            <td><span class="type-pill ${status.tone}">${status.label}</span>${row.issues.map(issue => `<span class="sync-detail">${esc(issue.detail)}</span>`).join('')}</td>
          </tr>`;
      }).join('');
    }

    // Avisos de las carpetas: la de reportes no se pudo releer, o archivos de datos que el barrido no pudo usar.
    if (els.syncNotes) {
      const notes = [];
      if (state.reportsError) notes.push(`<b>Carpeta de reportes</b>: ${esc(state.reportsError)}${state.reports.length ? ' Se muestra la lista del barrido anterior.' : ''}`);
      snapshot.ignored.forEach(item => notes.push(`<b>${esc(item.fileName)}</b>: ${esc(item.reason)}`));
      snapshot.months.forEach(month => {
        if (month.duplicates.length) notes.push(`<b>${esc(month.name)} ${month.year}</b>: hay otro archivo del mismo mes (${esc(month.duplicates.join(', '))}); se usa "${esc(month.fileName)}", el editado mas reciente.`);
        if (month.outOfRange) notes.push(`<b>${esc(month.fileName)}</b>: ${month.outOfRange} filas con dias de otro mes se dejaron fuera.`);
      });
      els.syncNotes.hidden = !notes.length;
      els.syncNotes.innerHTML = notes.map(note => `<li>${note}</li>`).join('');
    }
  }

  // ── Catalogo de documentos ──────────────────────────────────────────────
  function visibleReports() {
    const search = normalize(state.filters.search).trim();
    const list = state.reports.filter(report => {
      if (state.filters.type !== 'all' && report.type.id !== state.filters.type) return false;
      if (state.filters.period !== 'all') {
        const key = report.period ? report.period.key : 'sin-periodo';
        if (key !== state.filters.period) return false;
      }
      if (state.filters.latestOnly && !report.latest) return false;
      if (!search) return true;
      return normalize(`${report.title} ${report.name} ${report.type.label} ${report.period ? report.period.label : ''}`).includes(search);
    });

    const sorters = {
      recent: (a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime),
      oldest: (a, b) => new Date(a.modifiedTime) - new Date(b.modifiedTime),
      name: (a, b) => a.name.localeCompare(b.name, 'es'),
      size: (a, b) => b.sizeBytes - a.sizeBytes,
    };
    return list.sort(sorters[state.sort] || sorters.recent);
  }

  function renderKpis() {
    if (!els.kpis) return;
    const total = state.reports.length;
    const monthly = state.reports.filter(report => report.type.id === TYPES.monthly.id || report.type.id === TYPES.partial.id).length;
    const latest = state.reports.filter(report => report.latest).length;
    const newest = state.reports[0];
    const synced = state.validation.filter(row => row.status === 'synced').length;

    const cards = [
      { label: 'Archivos en la carpeta', value: String(total), hint: `${latest} vigentes + ${total - latest} versiones anteriores` },
      { label: 'Reportes de campana', value: String(monthly), hint: 'Mensuales y parciales' },
      { label: 'Ultimo documento', value: newest ? formatDate(newest.modifiedTime) : '--', hint: newest ? newest.name : 'Sin registros' },
      { label: 'Meses sincronizados', value: `${synced}/${state.validation.length}`, hint: 'Descargas de Meta con su reporte al dia' },
    ];

    els.kpis.innerHTML = cards.map(card => `
      <div class="kpi-pill">
        <span>${card.label}</span>
        <strong>${card.value}</strong>
        <small>${esc(card.hint)}</small>
      </div>
    `).join('');
  }

  // Las opciones se rearman en cada barrido (pueden aparecer tipos o periodos nuevos) sin perder la eleccion.
  function renderFilterOptions() {
    if (els.typeFilter) {
      const used = [];
      state.reports.forEach(report => {
        if (!used.some(type => type.id === report.type.id)) used.push(report.type);
      });
      if (state.filters.type !== 'all' && !used.some(type => type.id === state.filters.type)) state.filters.type = 'all';
      els.typeFilter.innerHTML = ['<option value="all">Todos los tipos</option>']
        .concat(used.map(type => `<option value="${type.id}"${type.id === state.filters.type ? ' selected' : ''}>${type.label}</option>`))
        .join('');
    }

    if (els.periodFilter) {
      const periods = [];
      state.reports.forEach(report => {
        const key = report.period ? report.period.key : 'sin-periodo';
        const label = report.period ? report.period.label : 'Sin periodo';
        if (!periods.some(period => period.key === key)) periods.push({ key, label });
      });
      periods.sort((a, b) => (a.key === 'sin-periodo' ? 1 : b.key === 'sin-periodo' ? -1 : b.key.localeCompare(a.key)));
      if (state.filters.period !== 'all' && !periods.some(period => period.key === state.filters.period)) state.filters.period = 'all';
      els.periodFilter.innerHTML = ['<option value="all">Todos los periodos</option>']
        .concat(periods.map(period => `<option value="${period.key}"${period.key === state.filters.period ? ' selected' : ''}>${period.label}</option>`))
        .join('');
    }
  }

  function renderTable() {
    if (!els.body) return;
    const rows = visibleReports();

    const stamp = state.reportsError
      ? ' | no se pudo releer la carpeta'
      : state.syncedAt ? ` | lista leida ${window.TPData.formatStamp(state.syncedAt)}` : '';
    els.count.textContent = rows.length === state.reports.length
      ? `${state.reports.length} documentos${stamp}`
      : `${rows.length} de ${state.reports.length} documentos`;

    if (!rows.length) {
      const empty = state.reportsError ? esc(state.reportsError) : 'La carpeta de reportes esta vacia.';
      els.body.innerHTML = `<tr><td class="table-empty" colspan="7">${state.reports.length ? 'No hay documentos que coincidan con el filtro.' : empty}</td></tr>`;
      return;
    }

    els.body.innerHTML = rows.map(report => `
      <tr>
        <td class="report-name-col">
          <span class="report-name">${esc(report.name)}</span>
          <span class="report-file">${esc(report.title)}</span>
        </td>
        <td><span class="type-pill ${report.type.tone}">${report.type.label}</span></td>
        <td class="date-col">${report.period ? report.period.label : '<span class="no-data">Sin periodo</span>'}${report.range ? `<span class="report-range">${esc(report.range.label)}</span>` : ''}</td>
        <td><span class="format-tag ${report.isVideo ? 'video' : 'pdf'}">${esc(report.format)}</span></td>
        <td class="num">${formatSize(report.sizeBytes)}</td>
        <td class="date-col">${formatDate(report.modifiedTime)}${report.latest ? '<span class="version-flag current">Version vigente</span>' : '<span class="version-flag old">Version anterior</span>'}</td>
        <td>
          <div class="report-actions">
            <button type="button" class="report-btn primary" data-preview="${esc(report.id)}">Ver</button>
            <a class="report-btn" href="${esc(report.viewUrl)}" target="_blank" rel="noopener">Drive</a>
            <a class="report-btn" href="${esc(report.downloadUrl)}" target="_blank" rel="noopener">Descargar</a>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function render() {
    renderValidation();
    renderKpis();
    renderFilterOptions();
    renderTable();
  }

  function openPreview(reportId) {
    const report = state.reports.find(item => item.id === reportId);
    if (!report || !els.modal) return;
    els.modalTitle.textContent = report.name;
    els.modalSub.textContent = `${report.type.label}${report.period ? ` | ${report.period.label}` : ''} | ${report.format} | ${formatSize(report.sizeBytes)}`;
    els.modalLink.href = report.viewUrl;
    els.modalDownload.href = report.downloadUrl;
    els.modalFrame.src = report.previewUrl;
    els.modal.classList.add('visible');
    document.body.classList.add('modal-open');
    // El foco entra al dialogo y el fondo sale del orden de tab y del arbol accesible (sin cambio visual).
    state.lastFocus = document.activeElement;
    if (els.shell) els.shell.inert = true;
    els.modal.querySelector('[data-close-preview]')?.focus({ preventScroll: true });
  }

  function closePreview() {
    if (!els.modal) return;
    els.modal.classList.remove('visible');
    els.modalFrame.src = '';
    document.body.classList.remove('modal-open');
    if (els.shell) els.shell.inert = false;
    // El foco vuelve al boton que abrio el modal, si la tabla no se rearmo mientras estaba abierto.
    const back = state.lastFocus;
    state.lastFocus = null;
    if (back?.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
  }

  // Tab y Shift+Tab dan la vuelta dentro del modal en lugar de salir a la pagina de fondo.
  function trapFocus(event) {
    const focusable = [...els.modal.querySelectorAll('a[href], button, iframe')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const edge = event.shiftKey ? first : last;
    if (!els.modal.contains(document.activeElement) || document.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  function bindEvents() {
    els.search?.addEventListener('input', event => {
      state.filters.search = event.target.value;
      renderTable();
    });
    els.typeFilter?.addEventListener('change', event => {
      state.filters.type = event.target.value;
      renderTable();
    });
    els.periodFilter?.addEventListener('change', event => {
      state.filters.period = event.target.value;
      renderTable();
    });
    els.sortFilter?.addEventListener('change', event => {
      state.sort = event.target.value;
      renderTable();
    });
    els.latestOnly?.addEventListener('change', event => {
      state.filters.latestOnly = event.target.checked;
      renderTable();
    });
    [els.body, els.syncBody].forEach(host => host?.addEventListener('click', event => {
      const button = event.target.closest('[data-preview]');
      if (button) openPreview(button.dataset.preview);
    }));
    els.modal?.addEventListener('click', event => {
      if (event.target === els.modal || event.target.closest('[data-close-preview]')) closePreview();
    });
    document.addEventListener('keydown', event => {
      if (!els.modal?.classList.contains('visible')) return;
      if (event.key === 'Escape') closePreview();
      else if (event.key === 'Tab') trapFocus(event);
    });
    window.addEventListener('tp:data-updated', load);
    // Con datos ya pintados un error de lectura no cambia nada; sin datos, load() muestra el motivo.
    window.addEventListener('tp:data-error', () => { if (!window.TPData?.snapshot()) load(); });
  }

  function load() {
    const snapshot = window.TPData?.snapshot();
    if (!snapshot) {
      const error = window.TPData?.status().error;
      if (!error) {
        if (els.body) els.body.innerHTML = '<tr><td class="table-empty" colspan="7">Esperando la lista de la carpeta de Drive...</td></tr>';
        return;
      }
      // Sin datos de ningun origen: se reemplazan los "Cargando..." por el motivo, igual que en Gasto publicitario.
      const message = `No se pudieron cargar los datos (${error}). Pulsa Actualizar para reintentar.`;
      if (els.body) els.body.innerHTML = `<tr><td class="table-empty" colspan="7">${esc(message)}</td></tr>`;
      if (els.syncBody) els.syncBody.innerHTML = `<tr><td class="table-empty" colspan="6">${esc(message)}</td></tr>`;
      if (els.count) els.count.textContent = 'Sin datos';
      if (els.syncSub) els.syncSub.textContent = 'Sin datos para validar.';
      return;
    }
    const folder = snapshot.reports.folder;
    state.syncedAt = snapshot.sweptAt;
    state.reportsError = snapshot.reports.error || '';
    state.reports = buildReports(snapshot.reports.files);
    if (els.folderLink && /^https:\/\/drive\.google\.com\//i.test(String(folder?.url || ''))) els.folderLink.href = folder.url;
    render();
  }

  function init() {
    if (!state.wired) {
      els.kpis = document.getElementById('reports-kpis');
      els.body = document.getElementById('reports-body');
      els.count = document.getElementById('reports-count');
      els.search = document.getElementById('reports-search');
      els.typeFilter = document.getElementById('reports-type');
      els.periodFilter = document.getElementById('reports-period');
      els.sortFilter = document.getElementById('reports-sort');
      els.latestOnly = document.getElementById('reports-latest-only');
      els.folderLink = document.getElementById('reports-folder-link');
      els.modal = document.getElementById('reports-modal');
      els.modalTitle = document.getElementById('reports-modal-title');
      els.modalSub = document.getElementById('reports-modal-sub');
      els.modalFrame = document.getElementById('reports-modal-frame');
      els.modalLink = document.getElementById('reports-modal-link');
      els.modalDownload = document.getElementById('reports-modal-download');
      els.syncBody = document.getElementById('sync-body');
      els.syncSub = document.getElementById('sync-sub');
      els.syncNotes = document.getElementById('sync-notes');
      els.shell = document.querySelector('.shell');
      bindEvents();
      state.wired = true;
    }
    load();
  }

  window.ReportsArchive = { init };
})();
