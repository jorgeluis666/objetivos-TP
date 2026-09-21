(function () {
  const DATA_URL = 'data/tp-ads-2026.json';
  // Los meses cerrados se archivan uno a uno en data/ y se enganchan aqui, igual que en el
  // proyecto de origen. Terminal Pesquero arranca sin historico.
  const CLOSED_MONTH_URLS = [
    'data/tp-junio-sheet-2026.json',
    'data/tp-julio-sheet-2026.json',
    'data/tp-agosto-sheet-2026.json',
  ];
  // PENDIENTE: ID del Google Sheet de Terminal Pesquero. Vacio = sin sincronizacion en vivo.
  const SHEET_ID = '';
  const SHEET_MONTH = 'Septiembre';
  const REFRESH_BUTTON_IDS = ['campaigns-refresh-btn', 'projection-refresh-btn'];
  const LIVE_CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_MONTH)}`;
  const SYNC_INTERVAL_MS = 60 * 60 * 1000;
  const GOALS_KEY = 'tp-reservation-goals-v1';
  const SHEET_SYNC_ENDPOINT_KEY = 'tp-sheet-sync-endpoint-v1';
  const CHART_COLLAPSED_KEY = 'tp-chart-collapsed-v1';
  const TABLE_COMPACT_KEY = 'tp-campaigns-compact-v1';
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const SHORT_MONTHS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const REQUIRED_HEADERS = ['Tipo','Campaña','Anuncio','Objetivo','Reservas','Objetivo Reservas','Mensajes','Costo por mensaje','Costo por reserva','Ratio de reservas','Estado','Fecha de inicio','Fecha de fin','Duración (días)','Días restantes','Importe diario','Presupuesto total x campaña','Gasto x Campaña','Saldo por campaña','Proyección real de gasto mesual'];
  const OPTIONAL_HEADERS = ['Nuevo ppto diario','Observaciones','Vista previa','Conjunto de anuncios'];
  const AD_BUDGET_HEADERS = ['Presupuesto total x anuncio','Presupuesto total x conjunto'];
  const AD_SPENT_HEADERS = ['Gasto x Anuncio','Gasto x conjunto'];
  const AD_BALANCE_HEADERS = ['Saldo x anuncio','Saldo x conjunto'];
  const SERIES = {
    investment: { label: 'Inversion', unit: 'money', color: '#2563eb', fill: 'rgba(37,99,235,.11)' },
    messages: { label: 'Mensajes', unit: 'count', color: '#16a34a', fill: 'rgba(22,163,74,.10)' },
    reservations: { label: 'Resultados', unit: 'count', color: '#ea580c', fill: 'rgba(234,88,12,.10)' },
  };
  const CHART_SERIES_KEY = 'tp-chart-series-v1';
  const state = { data: null, types: readChartSeries(), month: 'Septiembre', chart: null, syncTimer: null, goals: readGoals(), chartCollapsed: readChartCollapsed(), tableCompact: readTableCompact(), tableFullscreen: false, lastSync: null };

  const escapeAttr = value => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const fmtMoney = value => Number.isFinite(Number(value)) ? `S/. ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '-';
  const fmtCount = value => Number(value || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 });
  const fmtRatio = value => Number.isFinite(Number(value)) ? `${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%` : '-';
  const fmtShort = value => {
    if (value == null) return '';
    if (value >= 1000) return `S/. ${(value / 1000).toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}k`;
    return `S/. ${Math.round(value)}`;
  };

  function readGoals() {
    try { return JSON.parse(localStorage.getItem(GOALS_KEY) || '{}'); } catch { return {}; }
  }
  function readChartCollapsed() {
    try {
      const saved = localStorage.getItem(CHART_COLLAPSED_KEY);
      return saved == null ? true : saved === 'true';
    } catch { return true; }
  }
  function readTableCompact() {
    try { return localStorage.getItem(TABLE_COMPACT_KEY) === 'true'; } catch { return false; }
  }
  function saveTableCompact() {
    try { localStorage.setItem(TABLE_COMPACT_KEY, String(state.tableCompact)); } catch {}
  }
  function saveChartCollapsed() {
    try { localStorage.setItem(CHART_COLLAPSED_KEY, String(state.chartCollapsed)); } catch {}
  }
  function saveGoals() {
    try { localStorage.setItem(GOALS_KEY, JSON.stringify(state.goals)); } catch {}
  }
  function readChartSeries() {
    try {
      const saved = JSON.parse(localStorage.getItem(CHART_SERIES_KEY) || '[]');
      const valid = Array.isArray(saved) ? saved.filter(key => SERIES[key]) : [];
      return valid.length ? valid : ['investment'];
    } catch { return ['investment']; }
  }
  function saveChartSeries() {
    try { localStorage.setItem(CHART_SERIES_KEY, JSON.stringify(state.types)); } catch {}
  }
  function syncEndpoint() {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('sheetSyncEndpoint');
    if (fromUrl) {
      try { localStorage.setItem(SHEET_SYNC_ENDPOINT_KEY, fromUrl); } catch {}
      window.history.replaceState({}, document.title, window.location.pathname);
      return fromUrl.trim();
    }
    return (window.TP_SHEET_SYNC_ENDPOINT || localStorage.getItem(SHEET_SYNC_ENDPOINT_KEY) || '').trim();
  }

  // ── Custom campaigns / ads (stored in localStorage) ──────────────────────
  const CUSTOM_KEY = 'tp-custom-rows-v1';
  function readCustom() { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '{}'); } catch { return {}; } }
  function saveCustom(data) { try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(data)); } catch {} }
  function getMonthCustom() { return readCustom()[state.month] || { campaigns: [], extraAds: {} }; }
  function setMonthCustom(fn) {
    const all = readCustom();
    all[state.month] = fn(all[state.month] || { campaigns: [], extraAds: {} });
    saveCustom(all);
  }
  function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function normalizeHeader(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
  }
  function parseNumber(value) {
    const text = String(value ?? '').trim();
    if (!text || text === '-' || text === '\u2013') return null;
    let normalized = text.replace(/S\/?\.?/gi, '').replace(/%/g, '').trim();
    if (/^-?\d+,\d{1,2}$/.test(normalized)) normalized = normalized.replace(',', '.');
    else normalized = normalized.replace(/,/g, '');
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }
  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (quoted && char === '"' && next === '"') { cell += '"'; i += 1; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (!quoted && char === ',') { row.push(cell); cell = ''; continue; }
      if (!quoted && (char === '\n' || char === '\r')) {
        if (char === '\r' && next === '\n') i += 1;
        row.push(cell); rows.push(row); row = []; cell = ''; continue;
      }
      cell += char;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(items => items.some(item => String(item).trim() !== ''));
  }
  function headerMap(headers) {
    const map = {};
    headers.forEach((header, index) => { map[normalizeHeader(header)] = index; });
    return map;
  }
  function get(row, map, name) { return row[map[normalizeHeader(name)]] ?? ''; }
  function getAny(row, map, names) {
    const name = names.find(item => map[normalizeHeader(item)] != null);
    return name ? get(row, map, name) : '';
  }
  function validateHeaders(headers) {
    const map = headerMap(headers);
    const missing = REQUIRED_HEADERS.filter(name => map[normalizeHeader(name)] == null);
    [AD_BUDGET_HEADERS, AD_SPENT_HEADERS, AD_BALANCE_HEADERS].forEach(group => { if (!group.some(name => map[normalizeHeader(name)] != null)) missing.push(group.join(' / ')); });
    if (missing.length) throw new Error(`Cabeceras faltantes: ${missing.join(', ')}`);
    return map;
  }
  function dateLabel(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) return text || null;
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${match[1].padStart(2, '0')}-${months[Number(match[2]) - 1] || 'Mes'}`;
  }
  function goalKey(campaign, ad) { return `${campaign}::${ad}`; }
  function effectiveGoal(campaign, ad) {
    const saved = state.goals[goalKey(campaign.name, ad.name)];
    return saved === '' || saved == null ? ad.reservationGoal : Number(saved);
  }
  function sourceMonth(name) { return state.data.months.find(month => month.name === name); }
  function cloneData(data) { return JSON.parse(JSON.stringify(data)); }
  function valueFor(name, type) {
    const month = sourceMonth(name);
    if (!month) return null;
    if (type === 'investment') return month.spend;
    if (Number.isFinite(Number(month[type]))) return Number(month[type]);
    const field = type === 'reservations' ? 'reservas' : 'messages';
    const ads = (month.campaigns || []).flatMap(campaign => campaign.ads || []);
    if (!ads.some(ad => ad[field] != null)) return null;
    return ads.reduce((total, ad) => total + Number(ad[field] || 0), 0);
  }
  function formatSeriesValue(value, series, short = false) {
    if (value == null) return '';
    if (series.unit === 'money') return short ? fmtShort(value) : fmtMoney(value);
    return fmtCount(value);
  }
  function isTypeHeader(cell) {
    // Al exportar, el titulo del mes queda fusionado con la cabecera "Tipo".
    return /(^|\s)tipo$/.test(normalizeHeader(cell));
  }
  function sheetToMonthData(rows) {
    const headerIndex = rows.findIndex(row => row.some(isTypeHeader) && row.some(cell => normalizeHeader(cell) === 'estado'));
    if (headerIndex < 0) throw new Error('No se encontro la fila de cabeceras del sheet.' );
    const headers = rows[headerIndex].map(cell => (isTypeHeader(cell) ? 'Tipo' : cell));
    const map = validateHeaders(headers);
    const campaigns = [];
    let current = null;
    let currentAdSet = null;
    let totals = null;
    rows.slice(headerIndex + 1).forEach(row => {
      const first = String(get(row, map, 'Tipo')).trim();
      const campaignName = String(get(row, map, 'Campaña')).trim();
      const adSetName = String(get(row, map, 'Conjunto de anuncios')).trim();
      const adName = String(get(row, map, 'Anuncio')).trim();
      if (!first && !campaignName && !adSetName && !adName) return;
      if (first.toLowerCase().startsWith('total')) {
        totals = row;
        return;
      }
      if (campaignName) {
        current = {
          name: campaignName,
          type: first,
          status: String(get(row, map, 'Estado')).trim(),
          objective: String(get(row, map, 'Objetivo')).trim() || null,
          budget: parseNumber(get(row, map, 'Presupuesto total x campaña')),
          spent: parseNumber(get(row, map, 'Gasto x Campaña')),
          balance: parseNumber(get(row, map, 'Saldo por campaña')),
          realBalance: null,
          reservationGoal: parseNumber(get(row, map, 'Objetivo Reservas')),
          reservas: 0,
          messages: 0,
          ads: []
        };
        campaigns.push(current);
        currentAdSet = null;
      }
      if (adSetName) currentAdSet = adSetName;
      if (!current || !adName) return;
      const ad = {
        name: currentAdSet ? `${currentAdSet} · ${adName}` : adName,
        adSet: currentAdSet,
        objective: String(get(row, map, 'Objetivo')).trim() || null,
        status: String(get(row, map, 'Estado')).trim(),
        reservas: parseNumber(get(row, map, 'Reservas')) || 0,
        reservationGoal: parseNumber(get(row, map, 'Objetivo Reservas')),
        messages: parseNumber(get(row, map, 'Mensajes')) || 0,
        costPerMessage: parseNumber(get(row, map, 'Costo por mensaje')),
        costPerReservation: parseNumber(get(row, map, 'Costo por reserva')),
        reservationRatio: parseNumber(get(row, map, 'Ratio de reservas')),
        startDate: dateLabel(get(row, map, 'Fecha de inicio')),
        endDate: dateLabel(get(row, map, 'Fecha de fin')),
        duration: parseNumber(get(row, map, 'Duración (días)')),
        daysRemaining: parseNumber(get(row, map, 'Días restantes')),
        dailyAmount: parseNumber(get(row, map, 'Importe diario')),
        budget: parseNumber(getAny(row, map, AD_BUDGET_HEADERS)),
        spent: parseNumber(getAny(row, map, AD_SPENT_HEADERS)),
        balance: parseNumber(getAny(row, map, AD_BALANCE_HEADERS)),
        newDailyAmount: parseNumber(get(row, map, 'Nuevo ppto diario')),
        observation: String(get(row, map, 'Observaciones')).trim() || null,
        adUrl: String(get(row, map, 'Vista previa')).trim() || null
      };
      if (ad.costPerMessage == null && ad.messages > 0 && ad.spent != null) ad.costPerMessage = ad.spent / ad.messages;
      if (ad.costPerReservation == null && ad.reservas > 0 && ad.spent != null) ad.costPerReservation = ad.spent / ad.reservas;
      if (ad.reservationRatio == null && ad.messages > 0) ad.reservationRatio = ad.reservas / ad.messages * 100;
      current.ads.push(ad);
      current.reservas += ad.reservas;
      current.messages += ad.messages;
      if (ad.observation && !current.observation) current.observation = ad.observation;
    });
    const allAds = campaigns.flatMap(campaign => campaign.ads);
    const round2 = value => Math.round(Number(value) * 100) / 100;
    const adSpendTotal = parseNumber(totals && getAny(totals, map, AD_SPENT_HEADERS)) ?? round2(allAds.reduce((sum, ad) => sum + Number(ad.spent || 0), 0));
    const spend = parseNumber(totals && get(totals, map, 'Gasto x Campaña')) ?? round2(campaigns.reduce((sum, campaign) => sum + Number(campaign.spent || 0), 0));
    const budgetTotal = parseNumber(totals && get(totals, map, 'Presupuesto total x campaña')) ?? round2(campaigns.reduce((sum, campaign) => sum + Number(campaign.budget || 0), 0));
    const balanceTotal = parseNumber(totals && get(totals, map, 'Saldo por campaña')) ?? round2(campaigns.reduce((sum, campaign) => sum + Number(campaign.balance || 0), 0));
    const brandingSpend = round2(campaigns.filter(campaign => campaign.ads.some(ad => normalizeHeader(ad.objective).includes('reconocimiento'))).reduce((sum, campaign) => sum + Number(campaign.spent || 0), 0));
    return {
      name: SHEET_MONTH,
      spend,
      messages: allAds.reduce((sum, ad) => sum + Number(ad.messages || 0), 0),
      reservations: allAds.reduce((sum, ad) => sum + Number(ad.reservas || 0), 0),
      adSpendTotal,
      budgetTotal,
      balanceTotal,
      reservationGoalTotal: parseNumber(totals && get(totals, map, 'Objetivo Reservas')),
      newDailyTotal: parseNumber(totals && get(totals, map, 'Nuevo ppto diario')) ?? round2(allAds.reduce((sum, ad) => sum + Number(ad.newDailyAmount || 0), 0)),
      totalObservation: String((totals && get(totals, map, 'Observaciones')) || '').trim(),
      spendBreakdown: { sales: round2(spend - brandingSpend), branding: brandingSpend },
      campaigns,
      headers: headers.map(header => String(header || '').trim()).filter(Boolean),
      source: `Google Sheets / Terminal Pesquero / ${SHEET_MONTH}`
    };
  }
  function mergeSheetMonth(monthData, source = 'Google Sheets') {
    const data = cloneData(state.data);
    const index = data.months.findIndex(month => month.name === monthData.name);
    if (index >= 0) data.months[index] = monthData;
    else data.months.push(monthData);
    data.cutoff = new Date().toISOString().slice(0, 10);
    data.source = source;
    state.data = data;
  }
  async function fetchLiveSheet() {
    const response = await fetch(`${LIVE_CSV_URL}&cacheBust=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return sheetToMonthData(parseCsv(await response.text()));
  }
  function setRefreshButtonState(isLoading) {
    REFRESH_BUTTON_IDS.forEach(id => {
      const button = document.getElementById(id);
      if (!button) return;
      button.disabled = Boolean(isLoading);
      button.textContent = isLoading ? 'Actualizando...' : 'Actualizar';
    });
  }
  async function syncLiveSheet({ silent = false, manual = false } = {}) {
    if (!SHEET_ID) {
      updateSyncLabel('Falta configurar el Google Sheet de Terminal Pesquero');
      return false;
    }
    if (manual) {
      setRefreshButtonState(true);
      updateSyncLabel('Actualizando datos desde Google Sheets...');
    }
    try {
      const monthData = await fetchLiveSheet();
      mergeSheetMonth(monthData);
      state.lastSync = new Date();
      renderAll();
      updateSyncLabel('Datos sincronizados desde Google Sheets');
      return true;
    } catch (error) {
      if (!silent) console.warn('[tp] No se pudo sincronizar Google Sheets:', error);
      updateSyncLabel(manual ? 'No se pudo actualizar desde Google Sheets' : 'Datos locales, esperando sincronizacion');
      return false;
    } finally {
      if (manual) setRefreshButtonState(false);
    }
  }
  function updateSyncLabel(text) {
    const label = document.getElementById('topbar-status');
    if (label && state.month === SHEET_MONTH) label.textContent = text;
  }
  function renderKpis() {
    const month = sourceMonth(state.month);
    const host = document.getElementById('kpi-strip');
    if (!host || !month) return;
    const investment = Number(month.spend || 0);
    const messages = Number(month.messages ?? valueFor(state.month, 'messages') ?? 0);
    const reservations = Number(month.reservations ?? valueFor(state.month, 'reservations') ?? 0);
    const costMessage = messages > 0 ? investment / messages : null;
    const costReservation = reservations > 0 ? investment / reservations : null;
    const cards = [
      ['Inversión', fmtMoney(investment), 'Gasto total'],
      ['Mensajes', fmtCount(messages), 'Conversaciones iniciadas'],
      ['Costo por mensaje', fmtMoney(costMessage), 'Inversión / mensajes'],
      ['Resultados', fmtCount(reservations), 'Resultado de cada campana'],
      ['Costo por resultado', fmtMoney(costReservation), 'Inversión / resultados']
    ];
    host.innerHTML = cards.map(([label, value, meta]) => `<div class="kpi-pill"><span>${label}</span><strong>${value}</strong><small>${meta}</small></div>`).join('');
  }
  // Un mes se habilita en cuanto tiene gasto, mensajes, resultados o campanas cargadas.
  function hasMonthData(name) {
    const month = sourceMonth(name);
    if (!month) return false;
    return Number(month.spend) > 0 || Number(month.messages) > 0 || Number(month.reservations) > 0 || (month.campaigns || []).length > 0;
  }
  function renderTabs() {
    const host = document.getElementById('month-tabs');
    host.innerHTML = MONTHS.map(name => {
      const available = hasMonthData(name);
      const selected = name === state.month;
      return `<button type="button" class="month-tab ${selected ? 'active' : ''}" data-month="${name}" aria-pressed="${selected}" ${available ? '' : 'disabled title="Sin datos registrados"'}>${name}${name === SHEET_MONTH ? '<span class="current-dot"></span>' : ''}</button>`;
    }).join('');
    host.querySelectorAll('.month-tab:not(:disabled)').forEach(button => {
      button.addEventListener('click', () => {
        state.month = button.dataset.month;
        host.querySelectorAll('.month-tab').forEach(tab => {
          tab.classList.toggle('active', tab.dataset.month === state.month);
          tab.setAttribute('aria-pressed', String(tab.dataset.month === state.month));
        });
        renderAll(false);
      });
    });
  }
  function statusClass(status) {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'activa' || normalized === 'activo') return 'green';
    if (normalized === 'finalizada' || normalized === 'finalizado' || normalized === 'off') return 'red';
    return 'muted';
  }
  function isFinishedStatus(status) {
    const normalized = String(status || '').toLowerCase();
    return normalized === 'off' || normalized.includes('finaliz') || normalized.includes('desactiva');
  }
  function renderReservationProgress(value, goal) {
    if (goal == null || Number(goal) <= 0) return `${value}`;
    const reached = Number(value) >= Number(goal);
    const label = reached ? 'Sobre el objetivo' : 'Debajo del objetivo';
    return `<span class="reservation-value">${value}</span><span class="reservation-trend ${reached ? 'up' : 'down'}" title="${label}: ${value}/${goal}" aria-label="${label}: ${value} de ${goal}">${reached ? '▲' : '▼'} Objetivo: ${goal}</span>`;
  }
  function renderTrend(reservas, goal) {
    if (goal == null || Number(goal) <= 0) return '';
    const diff = Number(reservas) - Number(goal);
    const reached = diff >= 0;
    const label = reached ? 'Sobre el objetivo' : 'Debajo del objetivo';
    const detail = reached ? `Sobre: ${diff}` : `Faltan: ${Math.abs(diff)}`;
    return `<span class="reservation-trend ${reached ? 'up' : 'down'}" title="${label}: ${reservas}/${goal}" aria-label="${label}: ${reservas} de ${goal}">${reached ? '&#9650;' : '&#9660;'} ${detail} | Objetivo: ${goal}</span>`;
  }
  function renderDeadline(endDate, days) {
    if (!endDate) return '-';
    if (days == null) return endDate;
    const counterClass = days === 0 ? 'closed' : days <= 3 ? 'urgent' : '';
    const label = days === 0 ? 'Plazo finalizado' : `${days} ${days === 1 ? 'día restante' : 'días restantes'}`;
    return `${endDate}<span class="days-counter ${counterClass}">${label}</span>`;
  }
  function renderGoalInput(campaign, ad) {
    const value = effectiveGoal(campaign, ad);
    return `<input class="reservation-goal-input" type="number" min="0" step="1" value="${value ?? ''}" data-campaign="${campaign.name}" data-ad="${ad.name}" aria-label="Objetivo Reservas ${campaign.name} ${ad.name}">`;
  }
  function goalValue(campaign, ad) {
    return Number(effectiveGoal(campaign, ad || {}) || 0);
  }
  function campaignGoal(campaign, ads) {
    const saved = state.goals[goalKey(campaign.name, '__campaign__')];
    if (saved !== '' && saved != null) return Number(saved);
    const rows = ads && ads.length ? ads : (campaign.ads || []);
    return rows.reduce((sum, ad) => sum + goalValue(campaign, ad), 0);
  }
  function renderCampaignGoalInput(campaign, ads) {
    const value = campaignGoal(campaign, ads);
    return `<input class="reservation-goal-input" type="number" min="0" step="1" value="${value || ''}" data-campaign="${campaign.name}" data-ad="__campaign__" aria-label="Objetivo Reservas ${campaign.name}">`;
  }
  function updateAdGoal(campaignName, adName, value) {
    const month = sourceMonth(state.month);
    const campaign = month?.campaigns?.find(item => item.name === campaignName);
    if (!campaign) return;
    const numberValue = value === '' ? null : Number(value);
    if (adName === '__campaign__') {
      const firstAd = campaign.ads?.[0];
      if (firstAd) firstAd.reservationGoal = Number.isFinite(numberValue) ? numberValue : null;
      (campaign.ads || []).slice(1).forEach(item => { item.reservationGoal = null; });
      campaign.reservationGoal = firstAd?.reservationGoal ?? null;
      Object.keys(state.goals).forEach(key => { if (key.startsWith(`${campaignName}::`) && key !== goalKey(campaignName, '__campaign__')) delete state.goals[key]; });
    } else {
      const ad = campaign.ads?.find(item => item.name === adName);
      if (!ad) return;
      ad.reservationGoal = Number.isFinite(numberValue) ? numberValue : null;
      campaign.reservationGoal = campaign.ads?.find(item => item?.reservationGoal != null)?.reservationGoal ?? null;
    }
    month.reservationGoalTotal = (month.campaigns || []).reduce((sum, item) => sum + campaignGoal(item, item.ads || []), 0);
  }
  async function pushGoalToSheet(input) {
    const endpoint = syncEndpoint();
    if (!endpoint) {
      updateSyncLabel('Objetivo actualizado localmente; falta endpoint de escritura a Sheets');
      return;
    }
    const payload = {
      action: 'updateReservationGoal',
      spreadsheetId: SHEET_ID,
      sheetName: SHEET_MONTH,
      campaign: input.dataset.campaign,
      ad: input.dataset.ad,
      campaignLevel: input.dataset.ad === '__campaign__',
      value: input.value === '' ? '' : Number(input.value)
    };
    updateSyncLabel('Enviando objetivo a Google Sheets...');
    try {
      await fetch(endpoint, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      updateSyncLabel('Objetivo enviado a Google Sheets');
      setTimeout(() => syncLiveSheet({ silent: true }), 1800);
    } catch (error) {
      console.warn('[tp] No se pudo enviar el objetivo a Google Sheets:', error);
      updateSyncLabel('Cambio local; error al enviar a Google Sheets');
    }
  }
  function renderCampaigns() {
    const month = sourceMonth(state.month);
    const baseCampaigns = month.campaigns || [];
    const monthCustom = getMonthCustom();
    const campaigns = [...baseCampaigns, ...monthCustom.campaigns];
    const active = baseCampaigns.filter(c => ['activa', 'activo'].includes(String(c.status || '').toLowerCase())).length;
    document.getElementById('campaigns-title').textContent = `Campanas de ${month.name} 2026`;
    document.getElementById('campaigns-sub').textContent = baseCampaigns.length ? `${active} activas de ${baseCampaigns.length} campanas registradas.` : 'Sin detalle de campanas en el archivo fuente.';
    const note = document.getElementById('campaigns-note');
    if (note) {
      const observation = String(month.totalObservation || '').trim();
      note.textContent = observation ? `* ${observation}` : '';
      note.classList.toggle('visible', Boolean(observation));
    }
    const body = document.getElementById('campaigns-body');
    if (!campaigns.length) { body.innerHTML = '<tr><td colspan="23" class="table-empty">Sin campanas registradas para este mes.</td></tr>'; return; }
    const rows = [];
    let totalReservas = 0;
    let totalGoals = 0;
    let totalMessages = 0;
    for (const c of campaigns) {
      const isCustomC = !!(c._id);
      const baseAds = c.ads?.length ? c.ads : [null];
      const extraAds = (monthCustom.extraAds || {})[c.name] || [];
      const ads = [...baseAds, ...extraAds];
      const span = ads.length;
      const campaignTotalReservas = ads.reduce((s, ad) => s + Number((ad || {}).reservas ?? (ads.length === 1 ? c.reservas : 0) ?? 0), 0);
      const campaignTotalGoal = campaignGoal(c, ads);
      totalGoals += campaignTotalGoal;
      ads.forEach((ad, i) => {
        const currentAd = ad || {};
        const isExtraAd = extraAds.includes(ad);
        const budget = currentAd.budget ?? c.budget;
        const spent = currentAd.spent ?? (span === 1 ? c.spent : null);
        const daily = currentAd.dailyAmount ?? c.dailyAmount;
        const obj = currentAd.objective ?? c.objective;
        const st = currentAd.status ?? c.status;
        const adName = currentAd.name ?? '—';
        const reservas = Number(currentAd.reservas ?? (span === 1 ? c.reservas : 0) ?? 0);
        const messages = Number(currentAd.messages ?? (span === 1 ? c.messages : 0) ?? 0);
        const costPerMessage = currentAd.costPerMessage ?? (messages > 0 && spent != null ? spent / messages : null);
        const costPerReservation = currentAd.costPerReservation ?? (reservas > 0 && spent != null ? spent / reservas : null);
        const ratio = currentAd.reservationRatio ?? (messages > 0 ? reservas / messages * 100 : null);
        const adBalance = currentAd.balance ?? (budget != null && spent != null ? budget - spent : null);
        const observation = currentAd.observation ?? (i === 0 ? c.observation : null);
        totalReservas += reservas;
        totalMessages += messages;
        const rs = span > 1 ? ` rowspan="${span}"` : '';
        let tr = '<tr>';
        if (i === 0) {
          if (isCustomC) {
            tr += `<td class="type-col"${rs}><input class="inline-edit" type="text" placeholder="Tipo" value="${c.type || ''}" data-field="type" data-cid="${c._id}"></td>`;
            tr += `<td class="campaign-name"${rs}><input class="inline-edit wide" type="text" placeholder="Nombre campaña" value="${c.name || ''}" data-field="cname" data-cid="${c._id}"></td>`;
          } else {
            tr += `<td class="type-col"${rs}>${c.type || '—'}</td>`;
            tr += `<td class="campaign-name"${rs}>${c.name}</td>`;
          }
        }
        if (isExtraAd || isCustomC) {
          tr += `<td class="ad-name-col"><input class="inline-edit" type="text" placeholder="Nombre anuncio" value="${currentAd.name || ''}" data-field="adname" data-cname="${c.name || ''}" data-cid="${c._id || ''}" data-aid="${currentAd._id || ''}"></td>`;
          tr += `<td><input class="inline-edit" type="text" placeholder="Objetivo" value="${obj || ''}" data-field="adobj" data-cname="${c.name || ''}" data-cid="${c._id || ''}" data-aid="${currentAd._id || ''}"></td>`;
        } else {
          tr += `<td class="ad-name-col" title="${escapeAttr(adName)}"><span class="ad-name-text">${currentAd.adUrl ? `<a href="${currentAd.adUrl}" target="_blank" rel="noopener">${adName}</a>` : adName}</span></td>`;
          tr += `<td><span class="objective-pill">${obj || '—'}</span></td>`;
        }
        tr += `<td class="resultados-col">${reservas}</td>`;
        if (i === 0) {
          tr += `<td class="goal-col"${rs}>${renderCampaignGoalInput(c, ads)}${renderTrend(campaignTotalReservas, campaignTotalGoal)}</td>`;
        }
        tr += `<td class="num">${fmtCount(messages)}</td>`;
        tr += `<td class="num">${fmtMoney(costPerMessage)}</td>`;
        tr += `<td class="num">${fmtMoney(costPerReservation)}</td>`;
        tr += `<td class="num">${fmtRatio(ratio)}</td>`;
        tr += `<td><span class="status-pill ${statusClass(st)}">${st || '—'}</span></td>`;
        tr += `<td class="date-col">${currentAd.startDate || '—'}</td>`;
        tr += `<td class="date-col deadline-cell">${renderDeadline(currentAd.endDate, currentAd.daysRemaining)}</td>`;
        tr += `<td class="num">${currentAd.duration != null ? currentAd.duration + ' d' : '—'}</td>`;
        tr += `<td class="num">${fmtMoney(daily)}</td>`;
        tr += `<td class="num">${fmtMoney(budget)}</td>`;
        tr += `<td class="num">${fmtMoney(spent)}</td>`;
        if (i === 0) tr += `<td class="num campaign-total"${rs}>${fmtMoney(c.budget)}</td>`;
        if (i === 0) tr += `<td class="num campaign-total"${rs}>${fmtMoney(c.spent)}</td>`;
        tr += `<td class="num">${fmtMoney(adBalance)}</td>`;
        if (i === 0) tr += `<td class="num campaign-total"${rs}>${fmtMoney(c.balance)}</td>`;
        tr += `<td class="num">${fmtMoney(currentAd.newDailyAmount)}</td>`;
        tr += `<td class="observation-col">${observation || '—'}</td>`;
        tr += '</tr>';
        rows.push(tr);
      });
      // Separator row with "add ad" button on the dividing line
      rows.push(`<tr class="campaign-sep"><td colspan="23"><button class="add-ad-btn add-ad-line-btn" data-cname="${c.name}">＋ Agregar anuncio</button></td></tr>`);
    }
    rows.push(`<tr class="add-campaign-row"><td colspan="23"><button class="add-campaign-btn">＋ Agregar campaña</button></td></tr>`);
    rows.push(`<tr class="reservations-total-row"><td class="type-col"></td><td class="campaign-name"></td><td class="ad-name-col total-label">Total actualizado ${month.name.toLowerCase()}</td><td></td><td class="resultados-col">${totalReservas}</td><td class="goal-col">${totalGoals || ''}</td><td class="num">${totalMessages}</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td class="num">${fmtMoney(month.adSpendTotal)}</td><td class="num">${fmtMoney(month.budgetTotal)}</td><td class="num">${fmtMoney(month.spend)}</td><td class="num">${fmtMoney(month.balanceTotal)}</td><td></td><td></td><td></td></tr>`);
    body.innerHTML = rows.join('');
  }
  function dateOrderValue(label) {
    const match = String(label || '').match(/^(\d{1,2})-([A-Za-zÁ-ú]{3})/);
    if (!match) return null;
    const index = SHORT_MONTHS.findIndex(name => name.toLowerCase() === match[2].toLowerCase());
    if (index < 0) return null;
    return index * 100 + Number(match[1]);
  }
  function finishedCampaigns() {
    return (state.data?.months || []).flatMap(month => (month.campaigns || [])
      .filter(campaign => isFinishedStatus(campaign.status))
      .map(campaign => {
        const ads = campaign.ads || [];
        const reservas = Number(campaign.reservas ?? ads.reduce((sum, ad) => sum + Number(ad.reservas || 0), 0));
        const messages = Number(campaign.messages ?? ads.reduce((sum, ad) => sum + Number(ad.messages || 0), 0));
        const spent = Number(campaign.spent ?? ads.reduce((sum, ad) => sum + Number(ad.spent || 0), 0));
        const budget = Number(campaign.budget ?? ads.reduce((sum, ad) => sum + Number(ad.budget || 0), 0));
        const balance = Number(campaign.balance ?? (Number.isFinite(budget) && Number.isFinite(spent) ? budget - spent : 0));
        const startDates = ads.map(ad => ad.startDate).filter(date => dateOrderValue(date) != null);
        const endDates = ads.map(ad => ad.endDate).filter(date => dateOrderValue(date) != null);
        const startDate = startDates.sort((a, b) => dateOrderValue(a) - dateOrderValue(b))[0] || null;
        const endDate = endDates.sort((a, b) => dateOrderValue(b) - dateOrderValue(a))[0] || null;
        return { month: month.name, campaign, ads, reservas, messages, spent, budget, balance, startDate, endDate };
      }));
  }
  function renderHistory() {
    const body = document.getElementById('history-body');
    if (!body || !state.data) return;
    const rows = finishedCampaigns();
    const kpis = document.getElementById('history-kpis');
    const sub = document.getElementById('history-sub');
    const totals = rows.reduce((acc, row) => {
      acc.spend += Number(row.spent || 0);
      acc.budget += Number(row.budget || 0);
      acc.reservas += Number(row.reservas || 0);
      acc.messages += Number(row.messages || 0);
      return acc;
    }, { spend: 0, budget: 0, reservas: 0, messages: 0 });
    if (kpis) {
      kpis.innerHTML = [
        ['Campañas', fmtCount(rows.length), 'Finalizadas'],
        ['Inversión', fmtMoney(totals.spend), 'Gasto acumulado'],
        ['Resultados', fmtCount(totals.reservas), 'Total historico'],
        ['Mensajes', fmtCount(totals.messages), 'Conversaciones'],
        ['Saldo', fmtMoney(totals.budget - totals.spend), 'Presupuesto no usado']
      ].map(([label, value, meta]) => `<div class="kpi-pill"><span>${label}</span><strong>${value}</strong><small>${meta}</small></div>`).join('');
    }
    if (sub) sub.textContent = rows.length ? `${rows.length} campanas finalizadas encontradas en los meses disponibles.` : 'Sin campanas finalizadas registradas.';
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="10" class="table-empty">Sin campanas finalizadas en los meses cargados.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(({ month, campaign, ads, reservas, messages, spent, budget, balance, startDate, endDate }) => `
      <tr>
        <td class="date-col">${month}</td>
        <td class="campaign-name">${campaign.name}</td>
        <td class="num">${fmtCount(reservas)}</td>
        <td class="num">${fmtCount(messages)}</td>
        <td class="num">${fmtMoney(budget)}</td>
        <td class="num">${fmtMoney(spent)}</td>
        <td class="num">${fmtMoney(balance)}</td>
        <td>${ads.length ? ads.map(ad => ad.adUrl ? `<a class="history-ad-link" href="${ad.adUrl}" target="_blank" rel="noopener">${ad.name}</a>` : `<span class="history-ad-muted">${ad.name}</span>`).join('') : '-'}</td>
        <td class="date-col">${startDate || '-'}</td>
        <td class="date-col">${endDate || '-'}</td>
      </tr>
    `).join('');
  }
  function chartOptions(selectedKeys) {
    const hasMoney = selectedKeys.includes('investment');
    const hasCount = selectedKeys.some(key => key !== 'investment');
    const mixed = hasMoney && hasCount;
    const moneyTicks = value => value === 0 ? 'S/. 0' : `S/. ${(value / 1000).toFixed(1)}k`;
    const countTicks = value => Number(value).toLocaleString('es-PE');
    const scales = {
      x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#7890b5', font: { size: 10 } } },
      y: { beginAtZero: true, suggestedMax: hasMoney ? 3500 : undefined, border: { display: false }, grid: { color: 'rgba(148,163,184,.20)' }, ticks: { precision: 0, color: '#7890b5', font: { size: 10 }, callback: value => hasMoney ? moneyTicks(value) : countTicks(value) } }
    };
    if (mixed) scales.y1 = { beginAtZero: true, position: 'right', border: { display: false }, grid: { drawOnChartArea: false }, ticks: { precision: 0, color: '#7890b5', font: { size: 10 }, callback: countTicks } };
    return { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, layout: { padding: { top: 24, right: 12, left: 4 } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => ` ${context.dataset.label}: ${formatSeriesValue(context.raw, SERIES[context.dataset.seriesKey] || SERIES.investment)}` } } }, scales };
  }
  // ── Barra de herramientas de la tabla de campanas ────────────────────────
  function campaignsPanel() { return document.querySelector('.campaigns-panel'); }
  function applyTableCompact() {
    const panel = campaignsPanel();
    const button = document.getElementById('campaigns-density-btn');
    if (!panel || !button) return;
    panel.classList.toggle('is-compact', state.tableCompact);
    button.setAttribute('aria-pressed', String(state.tableCompact));
    button.textContent = state.tableCompact ? 'Comodo' : 'Compacto';
    button.setAttribute('title', state.tableCompact ? 'Volver a filas amplias' : 'Reducir el alto de las filas');
  }
  function applyTableFullscreen() {
    const panel = campaignsPanel();
    const button = document.getElementById('campaigns-expand-btn');
    const tabs = document.getElementById('month-tabs');
    const scroll = panel?.querySelector('.table-scroll');
    if (!panel || !button) return;
    panel.classList.toggle('is-fullscreen', state.tableFullscreen);
    document.body.classList.toggle('tp-table-fullscreen', state.tableFullscreen);
    // Las pestanas de mes viajan al panel para poder cambiar de mes sin salir.
    if (tabs && scroll) {
      if (state.tableFullscreen) panel.insertBefore(tabs, scroll);
      else { const chartPanel = document.getElementById('chart-panel'); chartPanel.parentNode.insertBefore(tabs, chartPanel); }
    }
    button.setAttribute('aria-pressed', String(state.tableFullscreen));
    button.innerHTML = state.tableFullscreen ? '&#10005; Salir' : '&#10530; Pantalla completa';
    button.setAttribute('title', state.tableFullscreen ? 'Salir de pantalla completa (Esc)' : 'Ver la tabla en pantalla completa (Esc para salir)');
    if (state.tableFullscreen) scroll?.focus?.();
  }
  function toggleTableFullscreen(force) {
    state.tableFullscreen = force == null ? !state.tableFullscreen : Boolean(force);
    applyTableFullscreen();
  }
  function applyChartCollapsed() {
    const panel = document.getElementById('chart-panel');
    const button = document.getElementById('chart-toggle-btn');
    if (!panel || !button) return;
    panel.classList.toggle('is-collapsed', state.chartCollapsed);
    button.textContent = state.chartCollapsed ? '+' : '-';
    button.setAttribute('aria-expanded', String(!state.chartCollapsed));
    button.setAttribute('title', state.chartCollapsed ? 'Expandir grafico' : 'Minimizar grafico');
  }
  function renderChart() {
    const selectedKeys = Object.keys(SERIES).filter(key => state.types.includes(key));
    document.getElementById('chart-title').textContent = `Evolucion mensual | ${selectedKeys.map(key => SERIES[key].label).join(' + ')} | 2026`;
    const legend = document.getElementById('chart-legend');
    if (legend) legend.innerHTML = selectedKeys.map(key => `<span><i class="legend-line ${key}"></i><b>${SERIES[key].label}</b></span>`).join('');
    document.querySelectorAll('#chart-series-toggles input').forEach(input => {
      input.checked = selectedKeys.includes(input.value);
      input.closest('.series-toggle')?.classList.toggle('active', input.checked);
    });
    if (state.chartCollapsed) return;
    const canvas = document.getElementById('chart-monthly');
    if (!canvas) return;
    if (typeof Chart === 'undefined') { canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Grafico no disponible sin conexion.</strong><span>Los totales mensuales siguen visibles debajo.</span></div>'; return; }
    const mixed = selectedKeys.includes('investment') && selectedKeys.some(key => key !== 'investment');
    const datasets = selectedKeys.map(key => {
      const series = SERIES[key];
      return { label: series.label, seriesKey: key, data: MONTHS.map(name => valueFor(name, key)), borderColor: series.color, backgroundColor: series.fill, borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: series.color, pointBorderColor: series.color, tension: .25, fill: selectedKeys.length === 1, spanGaps: false, yAxisID: mixed && key !== 'investment' ? 'y1' : 'y' };
    });
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(canvas, { type: 'line', data: { labels: SHORT_MONTHS, datasets }, options: chartOptions(selectedKeys), plugins: [{ id: 'valueLabels', afterDatasetsDraw(chart) { const ctx = chart.ctx; ctx.save(); ctx.font = '600 10px Inter, sans-serif'; ctx.textAlign = 'center'; chart.data.datasets.forEach((dataset, datasetIndex) => { const meta = chart.getDatasetMeta(datasetIndex); ctx.fillStyle = dataset.borderColor; meta.data.forEach((point, index) => { const value = dataset.data[index]; if (value == null) return; ctx.fillText(formatSeriesValue(value, SERIES[dataset.seriesKey], true), point.x, point.y - 13); }); }); ctx.restore(); } }] });
  }
  function renderAll(withTabs = true) {
    renderKpis();
    applyChartCollapsed();
    renderChart();
    if (withTabs) renderTabs();
    renderCampaigns();
    renderHistory();
    window.dispatchEvent(new CustomEvent('tp:data-updated'));
  }
  function wireEvents() {
    document.getElementById('chart-series-toggles').addEventListener('change', event => {
      const input = event.target.closest('input[type="checkbox"]');
      if (!input) return;
      const selected = [...document.querySelectorAll('#chart-series-toggles input:checked')].map(item => item.value);
      if (!selected.length) { input.checked = true; return; }
      state.types = Object.keys(SERIES).filter(key => selected.includes(key));
      saveChartSeries();
      renderChart();
    });
    REFRESH_BUTTON_IDS.forEach(id => {
      document.getElementById(id)?.addEventListener('click', () => syncLiveSheet({ manual: true }));
    });
    document.getElementById('campaigns-density-btn')?.addEventListener('click', () => {
      state.tableCompact = !state.tableCompact;
      saveTableCompact();
      applyTableCompact();
    });
    document.getElementById('campaigns-expand-btn')?.addEventListener('click', () => toggleTableFullscreen());
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.tableFullscreen) toggleTableFullscreen(false);
    });
    // Cambiar de modulo con el panel fijo dejaria el body bloqueado.
    document.querySelectorAll('[data-view-target]').forEach(button => {
      button.addEventListener('click', () => toggleTableFullscreen(false));
    });
    applyTableCompact();
    document.getElementById('chart-toggle-btn').addEventListener('click', () => {
      state.chartCollapsed = !state.chartCollapsed;
      saveChartCollapsed();
      applyChartCollapsed();
      if (!state.chartCollapsed) renderChart();
    });
    document.getElementById('campaigns-body').addEventListener('change', event => {
      const input = event.target.closest('.reservation-goal-input');
      if (input) {
        if (input.dataset.ad === '__campaign__') {
          Object.keys(state.goals).forEach(key => { if (key.startsWith(`${input.dataset.campaign}::`)) delete state.goals[key]; });
        }
        state.goals[goalKey(input.dataset.campaign, input.dataset.ad)] = input.value;
        updateAdGoal(input.dataset.campaign, input.dataset.ad, input.value);
        saveGoals();
        renderCampaigns();
        pushGoalToSheet(input);
        return;
      }
      const edit = event.target.closest('.inline-edit');
      if (edit) {
        const { field, cid, cname, aid } = edit.dataset;
        setMonthCustom(mc => {
          if (field === 'type' || field === 'cname') {
            const camp = mc.campaigns.find(x => x._id === cid);
            if (camp) {
              if (field === 'type') camp.type = edit.value;
              if (field === 'cname') {
                // also rename extraAds key
                if (mc.extraAds[camp.name]) { mc.extraAds[edit.value] = mc.extraAds[camp.name]; delete mc.extraAds[camp.name]; }
                camp.name = edit.value;
              }
            }
          } else if (field === 'adname' || field === 'adobj') {
            const key = cname || cid;
            const ads = mc.extraAds[key] || [];
            const adItem = ads.find(a => a._id === aid);
            if (adItem) {
              if (field === 'adname') adItem.name = edit.value;
              if (field === 'adobj') adItem.objective = edit.value;
            }
          }
          return mc;
        });
        renderCampaigns();
      }
    });
    document.getElementById('campaigns-body').addEventListener('click', event => {
      const addAdBtn = event.target.closest('.add-ad-btn');
      if (addAdBtn) {
        const cname = addAdBtn.dataset.cname || '';
        setMonthCustom(mc => {
          if (!mc.extraAds[cname]) mc.extraAds[cname] = [];
          mc.extraAds[cname].push({ _id: genId(), name: '', objective: '' });
          return mc;
        });
        renderCampaigns();
        return;
      }
      const addCampBtn = event.target.closest('.add-campaign-btn');
      if (addCampBtn) {
        setMonthCustom(mc => {
          mc.campaigns.push({ _id: genId(), name: '', type: '', status: 'Activo', ads: [] });
          return mc;
        });
        renderCampaigns();
      }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncLiveSheet({ silent: true }); });
  }
  async function init() {
    try {
      if (window.TP_ADS_DATA) state.data = window.TP_ADS_DATA;
      else { const response = await fetch(DATA_URL, { cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`); state.data = await response.json(); }
      for (const url of CLOSED_MONTH_URLS) {
        const monthData = await fetch(url, { cache: 'no-store' }).then(response => response.json());
        mergeSheetMonth(monthData, state.data.source || 'Datos locales');
      }
      wireEvents();
      renderAll();
      syncLiveSheet({ silent: true });
      state.syncTimer = setInterval(() => syncLiveSheet({ silent: true }), SYNC_INTERVAL_MS);
    } catch (error) { document.getElementById('view-obj').innerHTML = '<div class="data-notice error"><strong>No se pudo cargar la informacion de Terminal Pesquero.</strong></div>'; console.error(error); }
  }
  // Snapshot de solo lectura para los modulos que dependen de estos datos (Proyecciones).
  function snapshot() {
    if (!state.data) return null;
    return {
      cutoff: state.data.cutoff,
      source: state.data.source,
      year: state.data.year,
      lastSync: state.lastSync,
      months: cloneData(state.data).months,
    };
  }
  window.TPObjectives = { renderHistory, snapshot };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
