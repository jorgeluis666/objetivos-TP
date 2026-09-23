(function () {
  const DATA_URL = 'data/tp-drive-reports.json';
  // Los nombres de archivo vienen de Drive: se escapan antes de ir a innerHTML.
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const MONTHS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  const MONTH_PATTERNS = [
    { index: 0, re: /\bene(?:ro)?\b/ },
    { index: 1, re: /\bfeb(?:rero)?\b/ },
    { index: 2, re: /\bmar(?:zo)?\b/ },
    { index: 3, re: /\babr(?:il)?\b/ },
    { index: 4, re: /\bmay(?:o)?\b/ },
    { index: 5, re: /\bjun(?:io)?\b/ },
    { index: 6, re: /\bjul(?:io)?\b/ },
    { index: 7, re: /\bago(?:sto)?\b/ },
    { index: 8, re: /\bsep(?:t(?:iembre)?)?\b/ },
    { index: 9, re: /\boct(?:ubre)?\b/ },
    { index: 10, re: /\bnov(?:iembre)?\b/ },
    { index: 11, re: /\bdic(?:iembre)?\b/ },
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

  const state = {
    ready: false,
    loading: false,
    folder: null,
    syncedAt: '',
    reports: [],
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

  function detectPeriod(title) {
    // "TerminalPesquero_Julio2026" o "1-13Sep2026": se separan letras y numeros para reconocer mes y ano.
    const text = normalize(stripExtension(title))
      .replace(/[_.]+/g, ' ')
      .replace(/(\d)([a-z])/g, '$1 $2')
      .replace(/([a-z])(\d)/g, '$1 $2');
    const yearMatch = text.match(/\b(20\d{2})\b/);
    const year = yearMatch ? Number(yearMatch[1]) : null;
    const monthHit = MONTH_PATTERNS.find(pattern => pattern.re.test(text));
    if (!monthHit || !year) return null;

    const label = `${MONTHS[monthHit.index].charAt(0).toUpperCase()}${MONTHS[monthHit.index].slice(1)} ${year}`;
    return { key: `${year}-${String(monthHit.index + 1).padStart(2, '0')}`, label, year, month: monthHit.index + 1 };
  }

  function detectRange(title) {
    const text = normalize(stripExtension(title))
      .replace(/[_.]+/g, ' ')
      .replace(/(\d)([a-z])/g, '$1 $2')
      .replace(/([a-z])(\d)/g, '$1 $2');
    const match = text.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\b/);
    if (!match) return null;
    return `Del ${Number(match[1])} al ${Number(match[2])}`;
  }

  function detectType(title, mimeType, range) {
    const text = normalize(title);
    if (String(mimeType).startsWith('video/')) return TYPES.audiovisual;
    if (text.includes('propuesta')) return TYPES.proposal;
    if (text.includes('recomendacion')) return TYPES.recommendations;
    if (text.includes('dashboard')) return TYPES.dashboard;
    if (range) return TYPES.partial;
    if (text.includes('reporte') || detectPeriod(title)) return TYPES.monthly;
    return TYPES.other;
  }

  function formatSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '--';
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function toDate(iso) {
    const value = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? `${iso}T00:00:00` : iso;
    return new Date(value);
  }

  function formatDate(iso) {
    const date = toDate(iso);
    if (Number.isNaN(date.getTime())) return '--';
    return `${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)} ${date.getFullYear()}`;
  }

  function formatLongDate(iso) {
    const date = toDate(iso);
    if (Number.isNaN(date.getTime())) return '--';
    return `${date.getDate()} de ${MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
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
        createdTime: file.createdTime,
        viewUrl: `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`,
        previewUrl: `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/preview`,
        downloadUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(file.id)}`,
        latest: true,
      };
    });

    // Varias subidas comparten nombre en Drive: solo la mas reciente queda marcada como vigente.
    const groups = new Map();
    reports.forEach(report => {
      const key = `${report.type.id}|${report.period ? report.period.key : 'sin-periodo'}|${normalize(report.name)}|${report.range || ''}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(report);
    });
    groups.forEach(group => {
      group.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
      group.forEach((report, index) => {
        report.latest = index === 0;
        report.versions = group.length;
      });
    });

    return reports.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
  }

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
    const weight = state.reports.reduce((sum, report) => sum + report.sizeBytes, 0);

    const cards = [
      { label: 'Archivos en la carpeta', value: String(total), hint: `${latest} vigentes + ${total - latest} versiones anteriores` },
      { label: 'Reportes de campana', value: String(monthly), hint: 'Mensuales y parciales' },
      { label: 'Ultimo documento', value: newest ? formatDate(newest.modifiedTime) : '--', hint: newest ? newest.name : 'Sin registros' },
      { label: 'Peso del archivo', value: formatSize(weight), hint: 'Total almacenado en Drive' },
    ];

    els.kpis.innerHTML = cards.map(card => `
      <div class="kpi-pill">
        <span>${card.label}</span>
        <strong>${card.value}</strong>
        <small>${esc(card.hint)}</small>
      </div>
    `).join('');
  }

  function renderFilterOptions() {
    if (els.typeFilter && !els.typeFilter.dataset.ready) {
      const used = [];
      state.reports.forEach(report => {
        if (!used.some(type => type.id === report.type.id)) used.push(report.type);
      });
      els.typeFilter.innerHTML = ['<option value="all">Todos los tipos</option>']
        .concat(used.map(type => `<option value="${type.id}">${type.label}</option>`))
        .join('');
      els.typeFilter.dataset.ready = 'true';
    }

    if (els.periodFilter && !els.periodFilter.dataset.ready) {
      const periods = [];
      state.reports.forEach(report => {
        const key = report.period ? report.period.key : 'sin-periodo';
        const label = report.period ? report.period.label : 'Sin periodo';
        if (!periods.some(period => period.key === key)) periods.push({ key, label });
      });
      periods.sort((a, b) => (a.key === 'sin-periodo' ? 1 : b.key === 'sin-periodo' ? -1 : b.key.localeCompare(a.key)));
      els.periodFilter.innerHTML = ['<option value="all">Todos los periodos</option>']
        .concat(periods.map(period => `<option value="${period.key}">${period.label}</option>`))
        .join('');
      els.periodFilter.dataset.ready = 'true';
    }
  }

  function renderTable() {
    if (!els.body) return;
    const rows = visibleReports();

    els.count.textContent = rows.length === state.reports.length
      ? `${state.reports.length} documentos sincronizados el ${formatLongDate(state.syncedAt)}`
      : `${rows.length} de ${state.reports.length} documentos`;

    if (!rows.length) {
      els.body.innerHTML = '<tr><td class="table-empty" colspan="7">No hay documentos que coincidan con el filtro.</td></tr>';
      return;
    }

    els.body.innerHTML = rows.map(report => `
      <tr>
        <td class="report-name-col">
          <span class="report-name">${esc(report.name)}</span>
          <span class="report-file">${esc(report.title)}</span>
        </td>
        <td><span class="type-pill ${report.type.tone}">${report.type.label}</span></td>
        <td class="date-col">${report.period ? report.period.label : '<span class="no-data">Sin periodo</span>'}${report.range ? `<span class="report-range">${esc(report.range)}</span>` : ''}</td>
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
  }

  function closePreview() {
    if (!els.modal) return;
    els.modal.classList.remove('visible');
    els.modalFrame.src = '';
    document.body.classList.remove('modal-open');
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
    els.body?.addEventListener('click', event => {
      const button = event.target.closest('[data-preview]');
      if (button) openPreview(button.dataset.preview);
    });
    els.modal?.addEventListener('click', event => {
      if (event.target === els.modal || event.target.closest('[data-close-preview]')) closePreview();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') closePreview();
    });
  }

  async function loadData() {
    if (window.TP_DRIVE_REPORTS) return window.TP_DRIVE_REPORTS;
    const response = await fetch(DATA_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function init() {
    if (state.ready || state.loading) return;
    state.loading = true;

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

    try {
      const data = await loadData();
      state.folder = data.folder || null;
      state.syncedAt = data.syncedAt || '';
      state.reports = buildReports(data.files);
      if (els.folderLink && /^https:\/\//i.test(String(state.folder?.url || ''))) els.folderLink.href = state.folder.url;
      bindEvents();
      render();
      state.ready = true;
    } catch (error) {
      if (els.body) {
        els.body.innerHTML = `<tr><td class="table-empty" colspan="7">No se pudo cargar el archivo de reportes (${esc(error.message)}).</td></tr>`;
      }
    } finally {
      state.loading = false;
    }
  }

  window.ReportsArchive = { init };
})();
