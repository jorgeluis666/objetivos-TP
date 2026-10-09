(function () {
  // Modulo Gasto publicitario (y el Historico de Campanas): indicadores del reporte de Ads calculados con las
  // descargas de Meta que entrega window.TPData (js/data-source.js).
  const CHART_METRIC_KEY = 'tp-chart-metric-v2';
  const CHART_MODE_KEY = 'tp-chart-mode-v2';
  const CHART_COLLAPSED_KEY = 'tp-chart-collapsed-v2';
  const TABLE_COMPACT_KEY = 'tp-campaigns-compact-v1';
  const PREVIOUS_COLOR = '#94a3b8';
  const BASE_METRICS = [
    { key: 'spend', label: 'Inversion', unit: 'money', color: '#2563eb', field: 'spend' },
    { key: 'impressions', label: 'Impresiones', unit: 'count', color: '#0891b2', field: 'impressions' },
    { key: 'reach', label: 'Alcance', unit: 'count', color: '#4f46e5', field: 'reach' },
  ];
  const MODES = [
    { key: 'cumulative', label: 'Acumulado del mes' },
    { key: 'daily', label: 'Por dia' },
    { key: 'monthly', label: 'Por mes' },
  ];
  // Indicadores del resumen ejecutivo del reporte. better: hacia donde una variacion es buena (null = neutra).
  const KPIS = [
    { key: 'spend', label: 'Inversion', hint: 'Importe gastado', better: null, format: 'money' },
    { key: 'impressions', label: 'Impresiones', hint: 'Veces que se mostraron los anuncios', better: 'up', format: 'count' },
    { key: 'reach', label: 'Alcance', hint: 'Suma diaria por publico, como en el reporte', better: 'up', format: 'count' },
    { key: 'frequency', label: 'Frecuencia', hint: 'Impresiones / alcance', better: null, format: 'decimal' },
    { key: 'cpm', label: 'CPM prom.', hint: 'Costo por mil impresiones', better: 'down', format: 'money' },
  ];

  const state = {
    monthKey: null,
    metric: readSetting(CHART_METRIC_KEY, 'spend'),
    mode: readSetting(CHART_MODE_KEY, 'cumulative'),
    chartCollapsed: readSetting(CHART_COLLAPSED_KEY, 'false') === 'true',
    tableCompact: readSetting(TABLE_COMPACT_KEY, 'false') === 'true',
    tableFullscreen: false,
    adsObjective: 'all',
    chart: null,
    tabsHome: null,
    wired: false,
  };

  const data = () => window.TPData;
  const fmt = (kind, ...args) => data().fmt[kind](...args);
  const esc = value => data().esc(value);

  function readSetting(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function saveSetting(key, value) {
    try { localStorage.setItem(key, String(value)); } catch {}
  }

  function selectedMonth() {
    const snapshot = data()?.snapshot();
    if (!snapshot) return null;
    const month = data().monthByKey(state.monthKey);
    return month && month.hasData ? month : data().latestMonth();
  }

  // "▲ 12,3% vs 1-20 Agosto". El color depende de si subir es bueno para ese indicador.
  function deltaHtml(current, previous, better, compareLabel) {
    const change = data().metrics.change(current, previous);
    if (change == null) return `<small class="delta flat">Sin dato en ${esc(compareLabel)}</small>`;
    const direction = Math.abs(change) < 0.05 ? 'flat' : change > 0 ? 'up' : 'down';
    const tone = direction === 'flat' || !better ? 'flat' : direction === better ? 'good' : 'bad';
    const arrow = direction === 'up' ? '&#9650;' : direction === 'down' ? '&#9660;' : '&#9679;';
    return `<small class="delta ${tone}">${arrow} ${fmt('pct', Math.abs(change))} vs ${esc(compareLabel)}</small>`;
  }

  // ── Pestanas de mes y periodo ────────────────────────────────────────────
  function renderTabs(snapshot) {
    const host = document.getElementById('month-tabs');
    if (!host) return;
    const current = selectedMonth();
    host.innerHTML = data().MONTHS.map((name, index) => {
      const key = `${snapshot.year}-${String(index + 1).padStart(2, '0')}`;
      const month = data().monthByKey(key);
      const available = Boolean(month?.hasData);
      const selected = current?.key === key;
      return `<button type="button" class="month-tab ${selected ? 'active' : ''}" data-month="${key}" aria-pressed="${selected}" ${available ? '' : 'disabled title="Sin descarga de Meta en la carpeta"'}>${name}${key === snapshot.latestKey ? '<span class="current-dot"></span>' : ''}</button>`;
    }).join('');
  }

  function renderPeriod(period) {
    const title = document.getElementById('period-title');
    const sub = document.getElementById('period-sub');
    if (!title || !sub) return;
    if (!period) {
      title.textContent = 'Sin datos de Meta';
      sub.textContent = 'No hay descargas con gasto en la carpeta de Drive.';
      return;
    }
    const month = period.month;
    title.textContent = `Periodo: ${period.label} ${month.year}${period.closed ? '' : ' (mes en curso)'}`;
    // El archivo del mes y el aviso de descarga incompleta viven en el estado de la barra superior.
    sub.textContent = period.compare ? `Comparacion vs ${period.compare.label}` : 'Sin mes anterior para comparar';
  }

  // ── Resumen ejecutivo ────────────────────────────────────────────────────
  function renderKpis(period) {
    const host = document.getElementById('kpi-strip');
    if (!host) return;
    if (!period) {
      host.innerHTML = '';
      return;
    }
    const current = data().metrics.summarize(period.rows);
    const previous = period.compare ? data().metrics.summarize(period.compare.rows) : null;
    host.innerHTML = KPIS.map(kpi => `
      <div class="kpi-pill">
        <span>${kpi.label}</span>
        <strong>${fmt(kpi.format, current[kpi.key])}</strong>
        ${previous ? deltaHtml(current[kpi.key], previous[kpi.key], kpi.better, period.compare.label) : `<small>${kpi.hint}</small>`}
      </div>`).join('');
  }

  // ── Resultados por objetivo ──────────────────────────────────────────────
  function renderObjectives(period) {
    const host = document.getElementById('objective-cards');
    const reoriented = document.getElementById('reoriented');
    const sub = document.getElementById('objectives-sub');
    if (!host) return;
    if (!period) {
      host.innerHTML = '<div class="empty-state"><strong>Sin datos</strong>No hay gasto registrado en el mes.</div>';
      if (reoriented) reoriented.hidden = true;
      return;
    }
    const current = data().metrics.objectives(period.rows);
    const previous = period.compare ? data().metrics.objectives(period.compare.rows) : [];
    if (sub) sub.textContent = `${period.label}${period.compare ? ` vs ${period.compare.label}` : ''}. Cada objetivo se mide con su propio resultado: no se suman entre objetivos.`;

    host.innerHTML = current.map(objective => {
      const before = previous.find(item => item.key === objective.key);
      let comparison;
      if (!period.compare) comparison = '<p class="delta flat">Sin mes anterior para comparar</p>';
      else if (!before) comparison = `<p class="delta flat">Nuevo: no corria en ${esc(period.compare.label)}</p>`;
      else {
        const change = data().metrics.change(objective.results, before.results);
        const direction = change == null || Math.abs(change) < 0.05 ? 'flat' : change > 0 ? 'good' : 'bad';
        const arrow = direction === 'good' ? '&#9650;' : direction === 'bad' ? '&#9660;' : '&#9679;';
        comparison = `<p class="delta ${direction}">${arrow} ${change == null ? '-' : fmt('pct', Math.abs(change))} | ${esc(period.compare.month.shortName)}: ${fmt('count', before.results)}</p>`;
      }
      return `
        <article class="objective-card" style="--campaign-color:${objective.color}">
          <header><span><i class="campaign-dot"></i>${esc(objective.label)}</span><em>${fmt('pct', objective.share)} de la inversion</em></header>
          <strong>${fmt('count', objective.results)}</strong>
          <small>${esc(objective.resultLabel)}</small>
          <dl>
            <div><dt>Inversion</dt><dd>${fmt('money', objective.spend)}</dd></div>
            <div><dt>Costo por resultado</dt><dd>${fmt('unitCost', objective.costPerResult)}</dd></div>
            <div><dt>Alcance</dt><dd>${fmt('count', objective.reach)}</dd></div>
            <div><dt>CPM</dt><dd>${fmt('money', objective.cpm)}</dd></div>
          </dl>
          ${comparison}
        </article>`;
    }).join('') || '<div class="empty-state"><strong>Sin resultados</strong>No hay campanas con gasto en el periodo.</div>';

    // Campanas del mes anterior que ya no corren en este tramo (lamina "Reorientadas" del reporte).
    if (reoriented) {
      const gone = previous.filter(item => item.spend > 0 && !current.some(objective => objective.key === item.key));
      reoriented.hidden = !gone.length;
      reoriented.innerHTML = gone.length
        ? `<div class="reoriented-title">Activas en ${esc(period.compare.label)} y sin gasto en este tramo</div>${gone.map(item => `
            <div class="reoriented-item" style="--campaign-color:${item.color}"><i class="campaign-dot"></i><b>${esc(item.label)}</b> ${fmt('money', item.spend)} | ${fmt('count', item.results)} ${esc(item.resultLabel.toLowerCase())}</div>`).join('')}`
        : '';
    }
  }

  // ── Grafico lineal ───────────────────────────────────────────────────────
  function chartMetrics(month) {
    const objectives = month ? data().metrics.objectives(month.rows) : [];
    return BASE_METRICS.concat(objectives.map(objective => ({
      key: `obj:${objective.key}`,
      label: objective.label,
      resultLabel: objective.resultLabel,
      unit: 'count',
      color: objective.color,
      field: 'results',
      group: objective.key,
    })));
  }

  function metricFilter(metric) {
    return metric.group ? row => row.group === metric.group : null;
  }

  function monthlyValue(month, metric) {
    if (!month?.hasData) return null;
    const rows = metric.group ? month.rows.filter(row => row.group === metric.group) : month.rows;
    if (!rows.length) return null;
    return rows.reduce((sum, row) => sum + row[metric.field], 0);
  }

  function renderChartControls(metrics) {
    const metricsHost = document.getElementById('chart-metrics');
    const modesHost = document.getElementById('chart-modes');
    if (metricsHost) {
      metricsHost.innerHTML = metrics.map(metric => `
        <label class="series-toggle campaign-chip${metric.key === state.metric ? ' active' : ''}" style="--campaign-color:${metric.color}" title="${esc(metric.resultLabel || metric.label)}">
          <input type="radio" name="chart-metric" value="${esc(metric.key)}"${metric.key === state.metric ? ' checked' : ''}>${esc(metric.label)}
        </label>`).join('');
    }
    if (modesHost) {
      modesHost.innerHTML = MODES.map(mode => `
        <label class="series-toggle campaign-chip${mode.key === state.mode ? ' active' : ''}" style="--campaign-color:var(--brand-text)">
          <input type="radio" name="chart-mode" value="${mode.key}"${mode.key === state.mode ? ' checked' : ''}>${mode.label}
        </label>`).join('');
    }
  }

  function renderChart() {
    const month = selectedMonth();
    const panel = document.getElementById('chart-panel');
    const toggle = document.getElementById('chart-toggle-btn');
    panel?.classList.toggle('is-collapsed', state.chartCollapsed);
    if (toggle) {
      toggle.textContent = state.chartCollapsed ? '+' : '-';
      toggle.setAttribute('aria-expanded', String(!state.chartCollapsed));
      toggle.setAttribute('title', state.chartCollapsed ? 'Expandir grafico' : 'Minimizar grafico');
    }
    const metrics = chartMetrics(month);
    if (!metrics.some(metric => metric.key === state.metric)) state.metric = 'spend';
    if (!MODES.some(mode => mode.key === state.mode)) state.mode = 'cumulative';
    renderChartControls(metrics);
    const metric = metrics.find(item => item.key === state.metric);
    const mode = MODES.find(item => item.key === state.mode);
    const title = document.getElementById('chart-title');
    const sub = document.getElementById('chart-sub');
    const legend = document.getElementById('chart-legend');
    if (!month) {
      if (title) title.textContent = 'Evolucion';
      if (sub) sub.textContent = 'Sin datos de Meta.';
      if (legend) legend.innerHTML = '';
      return;
    }
    const snapshot = data().snapshot();
    const previous = data().previousMonth(month);
    const metricName = metric.group ? `${metric.label} (${metric.resultLabel.toLowerCase()})` : metric.label;
    if (title) title.textContent = `${metricName} | ${mode.label} | ${mode.key === 'monthly' ? snapshot.year : `${month.name} ${month.year}`}`;

    let labels;
    let datasets;
    let legendItems;
    if (mode.key === 'monthly') {
      labels = data().SHORT_MONTHS;
      const values = data().MONTHS.map((_, index) => monthlyValue(data().monthByKey(`${snapshot.year}-${String(index + 1).padStart(2, '0')}`), metric));
      datasets = [{ label: metricName, data: values, borderColor: metric.color, backgroundColor: `${metric.color}1a`, fill: true, borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: metric.color, tension: 0.25, spanGaps: false, unit: metric.unit, valueLabels: true }];
      legendItems = [`<span><i class="legend-line" style="background:${metric.color}"></i><b>${esc(metricName)} por mes</b></span>`];
      if (sub) sub.textContent = 'Total de cada mes con descarga de Meta. El mes en curso va hasta el ultimo dia con datos.';
    } else {
      const cumulative = mode.key === 'cumulative';
      const transform = values => (cumulative ? data().metrics.cumulative(values) : values);
      labels = Array.from({ length: month.daysInMonth }, (_, index) => `${index + 1}`);
      const currentValues = transform(data().metrics.dailyValues(month, metric.field, metricFilter(metric)));
      datasets = [{ label: month.name, data: currentValues, borderColor: metric.color, backgroundColor: `${metric.color}14`, fill: cumulative, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.2, unit: metric.unit }];
      legendItems = [`<span><i class="legend-line" style="background:${metric.color}"></i><b>${esc(month.name)} ${month.year}</b></span>`];
      if (previous?.hasData) {
        const previousValues = transform(data().metrics.dailyValues(previous, metric.field, metricFilter(metric))).slice(0, month.daysInMonth);
        if (previousValues.some(value => value)) {
          datasets.push({ label: previous.name, data: previousValues, borderColor: PREVIOUS_COLOR, borderDash: [6, 5], fill: false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2, unit: metric.unit });
          legendItems.push(`<span><i class="legend-line dashed" style="color:${PREVIOUS_COLOR}"></i><b>${esc(previous.name)} (mismo dia del mes)</b></span>`);
        }
      }
      if (sub) sub.textContent = cumulative
        ? 'Acumulado dia a dia del mes elegido frente al mes anterior en el mismo dia del mes.'
        : 'Valor de cada dia del mes elegido frente al mes anterior.';
    }
    if (legend) legend.innerHTML = legendItems.join('');
    if (state.chartCollapsed) return;

    const canvas = document.getElementById('chart-monthly');
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Grafico no disponible sin conexion.</strong><span>Los indicadores y las tablas siguen visibles.</span></div>';
      return;
    }
    const format = value => (metric.unit === 'money' ? fmt('money', value) : fmt('count', value));
    const tick = value => (metric.unit === 'money'
      ? (value === 0 ? 'S/. 0' : `S/. ${Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 })}`)
      : Number(value).toLocaleString('es-PE', { notation: Math.abs(value) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }));
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 24, right: 12, left: 4 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: item => item.raw != null,
            callbacks: {
              title: items => (mode.key === 'monthly' ? data().MONTHS[items[0].dataIndex] : `Dia ${items[0].label}`),
              label: context => ` ${context.dataset.label}: ${format(context.raw)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#7890b5', font: { size: 10 }, autoSkip: true, maxTicksLimit: mode.key === 'monthly' ? 12 : 16 } },
          y: { beginAtZero: true, border: { display: false }, grid: { color: 'rgba(148,163,184,.20)' }, ticks: { color: '#7890b5', font: { size: 10 }, callback: tick } },
        },
      },
      plugins: [{
        id: 'valueLabels',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          ctx.save();
          ctx.font = '600 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          chart.data.datasets.forEach((dataset, index) => {
            if (!dataset.valueLabels) return;
            ctx.fillStyle = dataset.borderColor;
            chart.getDatasetMeta(index).data.forEach((point, pointIndex) => {
              const value = dataset.data[pointIndex];
              if (value == null) return;
              const text = metric.unit === 'money' ? tick(Math.round(value)) : Number(value).toLocaleString('es-PE', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 });
              ctx.fillText(text, point.x, point.y - 12);
            });
          });
          ctx.restore();
        },
      }],
    });
  }

  // ── Distribucion por campana ─────────────────────────────────────────────
  function renderDistribution(period) {
    const body = document.getElementById('distribution-body');
    const sub = document.getElementById('distribution-sub');
    if (!body) return;
    if (!period) {
      body.innerHTML = '<tr><td class="table-empty" colspan="13">Sin datos para el periodo.</td></tr>';
      return;
    }
    const rows = data().metrics.campaigns(period.rows);
    const colors = new Map(data().metrics.objectives(period.rows).map(objective => [objective.key, objective.color]));
    const total = data().metrics.summarize(period.rows);
    if (sub) sub.textContent = `${period.label} | ${rows.length} ${rows.length === 1 ? 'campana' : 'campanas'} con gasto o impresiones.`;
    body.innerHTML = rows.map(row => `
      <tr>
        <td class="campaign-name">${esc(row.name)}</td>
        <td><span class="objective-label" style="--campaign-color:${colors.get(row.group) || PREVIOUS_COLOR}"><i class="campaign-dot"></i>${esc(row.groupLabel)}</span></td>
        <td><span class="objective-pill">${esc(row.resultLabel)}</span></td>
        <td class="num">${fmt('count', row.results)}</td>
        <td class="num">${fmt('unitCost', row.costPerResult)}</td>
        <td class="num">${fmt('money', row.spend)}</td>
        <td class="share-col"><div class="share-bar" style="--campaign-color:${colors.get(row.group) || PREVIOUS_COLOR}"><span style="width:${Math.min(100, row.share).toFixed(1)}%"></span></div><b class="share-value">${fmt('pct', row.share)}</b></td>
        <td class="num">${fmt('count', row.impressions)}</td>
        <td class="num">${fmt('count', row.reach)}</td>
        <td class="num">${fmt('decimal', row.frequency)}</td>
        <td class="num">${fmt('money', row.cpm)}</td>
        <td class="num">${fmt('count', row.clicks)}</td>
        <td class="num">${fmt('pct', row.ctr, 2)}</td>
      </tr>`).join('') + `
      <tr class="total-row">
        <td class="campaign-name">Total del periodo</td>
        <td></td>
        <td><span class="no-data">Los resultados no se suman entre objetivos</span></td>
        <td></td><td></td>
        <td class="num">${fmt('money', total.spend)}</td>
        <td><b class="share-value">100%</b></td>
        <td class="num">${fmt('count', total.impressions)}</td>
        <td class="num">${fmt('count', total.reach)}</td>
        <td class="num">${fmt('decimal', total.frequency)}</td>
        <td class="num">${fmt('money', total.cpm)}</td>
        <td class="num">${fmt('count', total.clicks)}</td>
        <td class="num">${fmt('pct', total.ctr, 2)}</td>
      </tr>`;
  }

  // ── Anuncios del periodo ─────────────────────────────────────────────────
  function renderAdsFilter(objectives) {
    const select = document.getElementById('ads-objective');
    if (!select) return;
    if (state.adsObjective !== 'all' && !objectives.some(objective => objective.key === state.adsObjective)) state.adsObjective = 'all';
    select.innerHTML = ['<option value="all">Todos los objetivos</option>']
      .concat(objectives.map(objective => `<option value="${esc(objective.key)}"${objective.key === state.adsObjective ? ' selected' : ''}>${esc(objective.label)}</option>`))
      .join('');
  }

  function renderAds(period) {
    const body = document.getElementById('campaigns-body');
    const title = document.getElementById('campaigns-title');
    const sub = document.getElementById('campaigns-sub');
    const prevHead = document.getElementById('ads-prev-head');
    if (!body) return;
    if (!period) {
      body.innerHTML = '<tr><td class="table-empty" colspan="15">Sin datos para el periodo.</td></tr>';
      renderAdsFilter([]);
      return;
    }
    const objectives = data().metrics.objectives(period.rows);
    renderAdsFilter(objectives);
    const order = new Map(objectives.map((objective, index) => [objective.key, index]));
    const colors = new Map(objectives.map(objective => [objective.key, objective.color]));
    const previous = new Map((period.compare ? data().metrics.ads(period.compare.rows) : []).map(ad => [ad.key, ad]));
    const all = data().metrics.ads(period.rows)
      .sort((a, b) => (order.get(a.group) - order.get(b.group)) || (b.results - a.results) || (b.spend - a.spend));
    const leaders = new Set();
    all.forEach(ad => { if (ad.results > 0 && !leaders.has(ad.group)) { leaders.add(ad.group); ad.leader = true; } });
    const rows = state.adsObjective === 'all' ? all : all.filter(ad => ad.group === state.adsObjective);

    if (title) title.textContent = `Anuncios | ${period.label} ${period.month.year}`;
    if (sub) sub.textContent = `${rows.length} ${rows.length === 1 ? 'anuncio' : 'anuncios'} ordenados por resultados dentro de cada objetivo. La estrella marca al lider de cada objetivo.`;
    if (prevHead) prevHead.textContent = period.compare ? `Resultados ${period.compare.label}` : 'Mes anterior';

    if (!rows.length) {
      body.innerHTML = '<tr><td class="table-empty" colspan="15">No hay anuncios para este objetivo en el periodo.</td></tr>';
      return;
    }
    const monthShort = period.month.shortName;
    body.innerHTML = rows.map(ad => {
      const before = previous.get(ad.key);
      const change = before ? data().metrics.change(ad.results, before.results) : null;
      const changeCell = !period.compare ? '<span class="no-data">-</span>'
        : !before ? '<span class="delta-pill new">Nuevo</span>'
        : change == null ? '<span class="no-data">-</span>'
        : `<span class="delta-pill ${change >= 0 ? 'good' : 'bad'}">${change >= 0 ? '&#9650;' : '&#9660;'} ${fmt('pct', Math.abs(change), 0)}</span>`;
      const days = ad.firstDay ? (ad.firstDay === ad.lastDay ? `${ad.firstDay} ${monthShort}` : `${ad.firstDay}-${ad.lastDay} ${monthShort}`) : '-';
      const preview = data().safeUrl(ad.preview);
      return `
        <tr>
          <td class="type-col"><span class="objective-label" style="--campaign-color:${colors.get(ad.group) || PREVIOUS_COLOR}"><i class="campaign-dot"></i>${esc(ad.groupLabel)}</span></td>
          <td class="ad-name-col" title="${esc(ad.ad)}"><span class="ad-name-text">${ad.leader ? '<b class="leader-star" title="Lider del objetivo">&#9733;</b> ' : ''}${esc(ad.ad || '(sin nombre)')}</span></td>
          <td class="campaign-set-col">${esc(ad.campaigns.join(' / '))}<small>${esc(ad.adSets.join(' / ') || '-')}</small></td>
          <td><span class="objective-pill">${esc(ad.resultLabel)}</span></td>
          <td class="num"><b>${fmt('count', ad.results)}</b></td>
          <td class="num">${before ? fmt('count', before.results) : '<span class="no-data">-</span>'}</td>
          <td class="num">${changeCell}</td>
          <td class="num">${fmt('unitCost', ad.costPerResult)}</td>
          <td class="num">${fmt('money', ad.spend)}</td>
          <td class="num">${fmt('count', ad.impressions)}</td>
          <td class="num">${fmt('count', ad.reach)}</td>
          <td class="num">${fmt('money', ad.cpm)}</td>
          <td class="num">${fmt('count', ad.clicks)}</td>
          <td class="date-col">${days}</td>
          <td>${preview ? `<a class="preview-link" href="${preview}" target="_blank" rel="noopener noreferrer">Ver anuncio &raquo;</a>` : '<span class="no-data">Sin enlace</span>'}</td>
        </tr>`;
    }).join('');
  }

  // ── Historico de campanas ────────────────────────────────────────────────
  function campaignHistory(snapshot) {
    const byName = new Map();
    snapshot.months.forEach(month => {
      month.rows.forEach(row => {
        if (!byName.has(row.campaign)) byName.set(row.campaign, { rows: [], months: new Set(), first: null, last: null });
        const entry = byName.get(row.campaign);
        entry.rows.push(row);
        if (row.spend > 0 || row.impressions > 0) {
          const date = `${month.key}-${String(row.d).padStart(2, '0')}`;
          entry.months.add(month.key);
          if (!entry.first || date < entry.first) entry.first = date;
          if (!entry.last || date > entry.last) entry.last = date;
        }
      });
    });
    const objectives = new Map(data().metrics.objectives(snapshot.months.flatMap(month => month.rows)).map(objective => [objective.key, objective]));
    return [...byName.entries()]
      .filter(([, entry]) => entry.last)
      .map(([name, entry]) => {
        const campaign = data().metrics.campaigns(entry.rows)[0];
        const adList = data().metrics.ads(entry.rows).sort((a, b) => b.results - a.results);
        return {
          ...campaign,
          name,
          color: objectives.get(campaign.group)?.color || PREVIOUS_COLOR,
          rows: entry.rows,
          ads: adList,
          first: entry.first,
          last: entry.last,
          months: [...entry.months].sort(),
          finished: Boolean(snapshot.dataEnd && entry.last < snapshot.dataEnd),
        };
      })
      .sort((a, b) => b.last.localeCompare(a.last) || b.spend - a.spend);
  }

  function shortDate(iso) {
    const [year, month, day] = String(iso || '').split('-').map(Number);
    if (!year || !month || !day) return '-';
    return `${day} ${data().SHORT_MONTHS[month - 1]} ${year}`;
  }

  function renderHistory() {
    const body = document.getElementById('history-body');
    const snapshot = data()?.snapshot();
    if (!body || !snapshot) return;
    const all = campaignHistory(snapshot);
    const rows = all.filter(item => item.finished);
    const active = all.filter(item => !item.finished);
    const totals = data().metrics.summarize(rows.flatMap(item => item.rows));
    const kpis = document.getElementById('history-kpis');
    const sub = document.getElementById('history-sub');
    if (kpis) {
      kpis.innerHTML = [
        ['Campanas finalizadas', fmt('count', rows.length), `${active.length} activas al ${shortDate(snapshot.dataEnd)}`],
        ['Inversion', fmt('money', totals.spend), 'Gasto acumulado de las finalizadas'],
        ['Impresiones', fmt('count', totals.impressions), 'Total historico'],
        ['Alcance', fmt('count', totals.reach), 'Suma diaria por publico'],
        ['CPM prom.', fmt('money', totals.cpm), 'Costo por mil impresiones'],
      ].map(([label, value, meta]) => `<div class="kpi-pill"><span>${label}</span><strong>${value}</strong><small>${esc(meta)}</small></div>`).join('');
    }
    if (sub) sub.textContent = rows.length ? `${rows.length} campanas sin gasto al ${shortDate(snapshot.dataEnd)}, ultimo dia con datos.` : 'Sin campanas finalizadas registradas.';
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="12" class="table-empty">Sin campanas finalizadas en los meses cargados.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(item => `
      <tr>
        <td class="campaign-name">${esc(item.name)}</td>
        <td><span class="objective-label" style="--campaign-color:${item.color}"><i class="campaign-dot"></i>${esc(item.groupLabel)}</span></td>
        <td><span class="objective-pill">${esc(item.resultLabel)}</span></td>
        <td class="num">${fmt('count', item.results)}</td>
        <td class="num">${fmt('unitCost', item.costPerResult)}</td>
        <td class="num">${fmt('money', item.spend)}</td>
        <td class="num">${fmt('count', item.impressions)}</td>
        <td class="num">${fmt('count', item.reach)}</td>
        <td>${item.ads.map(ad => {
          const url = data().safeUrl(ad.preview);
          return url
            ? `<a class="history-ad-link" href="${url}" target="_blank" rel="noopener noreferrer">${esc(ad.ad)}</a>`
            : `<span class="history-ad-muted">${esc(ad.ad)}</span>`;
        }).join('')}</td>
        <td class="date-col">${shortDate(item.first)}</td>
        <td class="date-col">${shortDate(item.last)}</td>
        <td class="date-col">${item.months.map(key => data().monthByKey(key)?.shortName || key).join(', ')}</td>
      </tr>`).join('');
  }

  // ── Herramientas de la tabla de anuncios ─────────────────────────────────
  function applyTableCompact() {
    const panel = document.querySelector('.campaigns-panel');
    const button = document.getElementById('campaigns-density-btn');
    if (!panel || !button) return;
    panel.classList.toggle('is-compact', state.tableCompact);
    button.setAttribute('aria-pressed', String(state.tableCompact));
    button.textContent = state.tableCompact ? 'Comodo' : 'Compacto';
    button.setAttribute('title', state.tableCompact ? 'Volver a filas amplias' : 'Reducir el alto de las filas');
  }

  function toggleTableFullscreen(force) {
    state.tableFullscreen = force == null ? !state.tableFullscreen : Boolean(force);
    const panel = document.querySelector('.campaigns-panel');
    const button = document.getElementById('campaigns-expand-btn');
    const tabs = document.getElementById('month-tabs');
    const scroll = panel?.querySelector('.table-scroll');
    if (!panel || !button) return;
    panel.classList.toggle('is-fullscreen', state.tableFullscreen);
    document.body.classList.toggle('tp-table-fullscreen', state.tableFullscreen);
    // Las pestanas de mes viajan al panel para poder cambiar de mes sin salir.
    if (tabs && scroll && state.tabsHome) {
      if (state.tableFullscreen) panel.insertBefore(tabs, scroll);
      else state.tabsHome.parent.insertBefore(tabs, state.tabsHome.next);
    }
    button.setAttribute('aria-pressed', String(state.tableFullscreen));
    button.innerHTML = state.tableFullscreen ? '&#10005; Salir' : '&#10530; Pantalla completa';
    button.setAttribute('title', state.tableFullscreen ? 'Salir de pantalla completa (Esc)' : 'Ver la tabla en pantalla completa (Esc para salir)');
    if (state.tableFullscreen) scroll?.focus?.();
  }

  // ── Render y eventos ─────────────────────────────────────────────────────
  function renderAll() {
    const snapshot = data()?.snapshot();
    if (!snapshot) return;
    const month = selectedMonth();
    state.monthKey = month?.key || null;
    const period = data().metrics.period(month);
    renderTabs(snapshot);
    renderPeriod(period);
    renderKpis(period);
    renderObjectives(period);
    renderChart();
    renderDistribution(period);
    renderAds(period);
    renderHistory();
  }

  function wireEvents() {
    const tabs = document.getElementById('month-tabs');
    if (tabs) state.tabsHome = { parent: tabs.parentNode, next: tabs.nextSibling };
    tabs?.addEventListener('click', event => {
      const button = event.target.closest('.month-tab:not(:disabled)');
      if (!button || button.dataset.month === state.monthKey) return;
      state.monthKey = button.dataset.month;
      renderAll();
    });
    document.getElementById('chart-metrics')?.addEventListener('change', event => {
      const input = event.target.closest('input[name="chart-metric"]');
      if (!input) return;
      state.metric = input.value;
      saveSetting(CHART_METRIC_KEY, state.metric);
      renderChart();
    });
    document.getElementById('chart-modes')?.addEventListener('change', event => {
      const input = event.target.closest('input[name="chart-mode"]');
      if (!input) return;
      state.mode = input.value;
      saveSetting(CHART_MODE_KEY, state.mode);
      renderChart();
    });
    document.getElementById('chart-toggle-btn')?.addEventListener('click', () => {
      state.chartCollapsed = !state.chartCollapsed;
      saveSetting(CHART_COLLAPSED_KEY, state.chartCollapsed);
      renderChart();
    });
    document.getElementById('ads-objective')?.addEventListener('change', event => {
      state.adsObjective = event.target.value;
      renderAds(data().metrics.period(selectedMonth()));
    });
    document.getElementById('campaigns-density-btn')?.addEventListener('click', () => {
      state.tableCompact = !state.tableCompact;
      saveSetting(TABLE_COMPACT_KEY, state.tableCompact);
      applyTableCompact();
    });
    document.getElementById('campaigns-expand-btn')?.addEventListener('click', () => toggleTableFullscreen());
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.tableFullscreen) toggleTableFullscreen(false);
    });
    // Cambiar de modulo con el panel fijo dejaria el body bloqueado.
    document.querySelectorAll('[data-view-target]').forEach(button => {
      button.addEventListener('click', () => { if (state.tableFullscreen) toggleTableFullscreen(false); });
    });
    applyTableCompact();
    window.addEventListener('tp:data-updated', renderAll);
    // Sin datos de ningun origen: se reemplazan los "Cargando..." por el motivo.
    window.addEventListener('tp:data-error', () => {
      if (data().snapshot()) return;
      const message = `No se pudieron cargar los datos (${data().status().error}). Pulsa Actualizar para reintentar.`;
      const title = document.getElementById('period-title');
      if (title) title.textContent = 'Sin datos de Meta';
      const sub = document.getElementById('period-sub');
      if (sub) sub.textContent = message;
      [['distribution-body', 13], ['campaigns-body', 15], ['history-body', 12]].forEach(([id, span]) => {
        const body = document.getElementById(id);
        if (body) body.innerHTML = `<tr><td class="table-empty" colspan="${span}">${esc(message)}</td></tr>`;
      });
    });
  }

  function init() {
    if (state.wired || !window.TPData) return;
    state.wired = true;
    wireEvents();
    renderAll();
  }

  window.TPObjectives = { renderHistory, renderAll };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
