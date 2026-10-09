(function () {
  // Modulo Gasto publicitario (y el Historico de Campanas): indicadores del reporte de Ads calculados con las
  // descargas de Meta que entrega window.TPData (js/data-source.js).
  const CHART_METRIC_KEY = 'tp-chart-metric-v2';
  const CHART_MODE_KEY = 'tp-chart-mode-v2';
  const CHART_COLLAPSED_KEY = 'tp-chart-collapsed-v2';
  const TABLE_COMPACT_KEY = 'tp-campaigns-compact-v1';
  const PREVIOUS_COLOR = '#94a3b8';
  // Pestana "Anual" junto a las de mes: acumula todos los meses del año con descarga.
  const YEAR_KEY = 'anual';
  // Pestana "Todos" del Historico de Campanas: todas las descargas, sin filtrar por mes.
  const HISTORY_ALL = 'todos';
  // Filtro por estado del Historico. Activa = con gasto o impresiones el ultimo dia con datos.
  const HISTORY_STATUS = [
    { key: 'todas', label: 'Todas', one: 'campana', many: 'campanas' },
    { key: 'activas', label: 'Activas', one: 'campana activa', many: 'campanas activas' },
    { key: 'finalizadas', label: 'Finalizadas', one: 'campana finalizada', many: 'campanas finalizadas' },
  ];
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
  // perMonth: en la vista anual se muestra su promedio mensual (los cocientes llevan su descripcion).
  const KPIS = [
    { key: 'spend', label: 'Inversion', hint: 'Importe gastado', better: null, format: 'money', perMonth: true },
    { key: 'impressions', label: 'Impresiones', hint: 'Veces que se mostraron los anuncios', better: 'up', format: 'count', perMonth: true },
    { key: 'reach', label: 'Alcance', hint: 'Suma diaria por publico, como en el reporte', better: 'up', format: 'count', perMonth: true },
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
    historyMonth: HISTORY_ALL,
    historyStatus: 'todas',
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

  function annualView() {
    return state.monthKey === YEAR_KEY && Boolean(data()?.metrics.yearPeriod());
  }

  function currentPeriod() {
    return annualView() ? data().metrics.yearPeriod() : data().metrics.period(selectedMonth());
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
  // Enero a Diciembre y una ultima pestana que junta todos los meses (Anual aqui, Todos en el Historico).
  function monthTabsHtml(snapshot, selectedKey, last) {
    return data().MONTHS.map((name, index) => {
      const key = `${snapshot.year}-${String(index + 1).padStart(2, '0')}`;
      const month = data().monthByKey(key);
      const available = Boolean(month?.hasData);
      const selected = selectedKey === key;
      return `<button type="button" class="month-tab ${selected ? 'active' : ''}" data-month="${key}" aria-pressed="${selected}" ${available ? '' : 'disabled title="Sin descarga de Meta en la carpeta"'}>${name}${key === snapshot.latestKey ? '<span class="current-dot"></span>' : ''}</button>`;
    }).join('') + `<button type="button" class="month-tab year-tab ${last.selected ? 'active' : ''}" data-month="${last.key}" aria-pressed="${last.selected}" title="${esc(last.available ? last.title : 'Sin descargas de Meta en la carpeta')}"${last.available ? '' : ' disabled'}>${last.label}</button>`;
  }

  function renderTabs(snapshot) {
    const host = document.getElementById('month-tabs');
    if (!host) return;
    const annual = annualView();
    host.innerHTML = monthTabsHtml(snapshot, annual ? null : selectedMonth()?.key, {
      key: YEAR_KEY,
      label: 'Anual',
      title: `Acumulado ${snapshot.year} de los meses con descarga de Meta`,
      available: Boolean(data().metrics.yearPeriod()),
      selected: annual,
    });
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
    if (period.annual) {
      const count = period.months.length;
      title.textContent = `Periodo: ${period.label} ${period.year}${period.closed ? '' : ' (año en curso)'}`;
      sub.textContent = `Acumulado de ${count} ${count === 1 ? 'mes' : 'meses'} con descarga de Meta (${period.months.map(month => month.shortName).join(', ')}). Sin año anterior para comparar.`;
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
    const average = period.annual ? monthlyAverage(period) : null;
    host.innerHTML = KPIS.map(kpi => {
      let note = `<small>${kpi.hint}</small>`;
      if (previous) note = deltaHtml(current[kpi.key], previous[kpi.key], kpi.better, period.compare.label);
      else if (average && kpi.perMonth) note = `<small title="${esc(average.basis)}">Prom. mensual: ${fmt(kpi.format, average[kpi.key])}</small>`;
      return `
      <div class="kpi-pill">
        <span>${kpi.label}</span>
        <strong>${fmt(kpi.format, current[kpi.key])}</strong>
        ${note}
      </div>`;
    }).join('');
  }

  // Promedio por mes de la vista anual. Mientras haya meses cerrados el mes en curso queda fuera: un mes a medias
  // bajaria el promedio.
  function monthlyAverage(period) {
    const closed = period.months.filter(month => month.complete || month.past);
    const months = closed.length ? closed : period.months;
    const totals = months.map(month => data().metrics.summarize(month.rows));
    const average = Object.fromEntries(KPIS.map(kpi => [kpi.key, totals.reduce((sum, item) => sum + (item[kpi.key] || 0), 0) / months.length]));
    average.basis = `Promedio de ${months.map(month => month.name).join(', ')}`;
    return average;
  }

  // Meses del año en que corrio un objetivo (vista anual, en lugar de la comparacion con el mes anterior).
  function objectiveMonths(period, key) {
    const months = period.months.filter(month => month.rows.some(row => row.group === key && (row.spend > 0 || row.impressions > 0)));
    if (months.length === period.months.length) return `Activo en los ${months.length} ${months.length === 1 ? 'mes' : 'meses'}`;
    return `Activo en ${months.map(month => month.shortName).join(', ') || 'ningun mes'}`;
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
      if (period.annual) comparison = `<p class="delta flat">${esc(objectiveMonths(period, objective.key))}</p>`;
      else if (!period.compare) comparison = '<p class="delta flat">Sin mes anterior para comparar</p>';
      else if (!before) comparison = `<p class="delta flat">Nuevo: no corria en ${esc(period.compare.label)}</p>`;
      else {
        const change = data().metrics.change(objective.results, before.results);
        const direction = change == null || Math.abs(change) < 0.05 ? 'flat' : change > 0 ? 'good' : 'bad';
        const arrow = direction === 'good' ? '&#9650;' : direction === 'bad' ? '&#9660;' : '&#9679;';
        comparison = `<p class="delta ${direction}">${arrow} ${change == null ? '-' : fmt('pct', Math.abs(change))} | ${esc(period.compare.month.shortName)}: ${fmt('count', before.results)}</p>`;
      }
      // Solo los datos de la campana: inversion, costo por resultado, alcance y CPM del objetivo elegido van en
      // el grafico de abajo, que se cambia pulsando la tarjeta.
      const metricKey = `obj:${objective.key}`;
      const selected = state.metric === metricKey;
      return `
        <button type="button" class="objective-card${selected ? ' active' : ''}" data-metric="${esc(metricKey)}" aria-pressed="${selected}" style="--campaign-color:${objective.color}" title="Ver ${esc(objective.label)} en el grafico">
          <header><span><i class="campaign-dot"></i>${esc(objective.label)}</span><em>${fmt('pct', objective.share)} de la inversion</em></header>
          <strong>${fmt('count', objective.results)}</strong>
          <small>${esc(objective.resultLabel)}</small>
          ${comparison}
        </button>`;
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
  function chartMetrics(rows) {
    const objectives = rows ? data().metrics.objectives(rows) : [];
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

  function renderChartControls(metrics, modes, modeKey) {
    const metricsHost = document.getElementById('chart-metrics');
    const modesHost = document.getElementById('chart-modes');
    if (metricsHost) {
      metricsHost.innerHTML = metrics.map(metric => `
        <label class="series-toggle campaign-chip${metric.key === state.metric ? ' active' : ''}" style="--campaign-color:${metric.color}" title="${esc(metric.resultLabel || metric.label)}">
          <input type="radio" name="chart-metric" value="${esc(metric.key)}"${metric.key === state.metric ? ' checked' : ''}>${esc(metric.label)}
        </label>`).join('');
    }
    if (modesHost) {
      modesHost.innerHTML = modes.map(mode => `
        <label class="series-toggle campaign-chip${mode.key === modeKey ? ' active' : ''}" style="--campaign-color:var(--brand-text)">
          <input type="radio" name="chart-mode" value="${mode.key}"${mode.key === modeKey ? ' checked' : ''}>${mode.label}
        </label>`).join('');
    }
  }

  // KPIs del objetivo graficado en el periodo elegido (los que antes iban en su tarjeta).
  function renderChartKpis(metric) {
    const host = document.getElementById('chart-kpis');
    if (!host) return;
    const period = metric?.group ? currentPeriod() : null;
    const objective = period && data().metrics.objectives(period.rows).find(item => item.key === metric.group);
    host.hidden = !objective;
    host.innerHTML = objective ? [
      ['Periodo', period.label],
      ['Inversion', fmt('money', objective.spend)],
      ['Costo por resultado', fmt('unitCost', objective.costPerResult)],
      ['Alcance', fmt('count', objective.reach)],
      ['CPM', fmt('money', objective.cpm)],
    ].map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value)}</dd></div>`).join('') : '';
  }

  function renderChart() {
    const month = selectedMonth();
    const panel = document.getElementById('chart-panel');
    const toggle = document.getElementById('chart-toggle-btn');
    panel?.classList.toggle('is-collapsed', state.chartCollapsed);
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!state.chartCollapsed));
      toggle.setAttribute('title', state.chartCollapsed ? 'Expandir grafico' : 'Minimizar grafico');
    }
    const annual = annualView();
    const metrics = chartMetrics(annual ? data().metrics.yearPeriod().rows : month?.rows);
    if (!metrics.some(metric => metric.key === state.metric)) state.metric = 'spend';
    if (!MODES.some(mode => mode.key === state.mode)) state.mode = 'cumulative';
    // La vista anual solo tiene sentido por mes; el modo elegido se conserva para cuando se vuelva a un mes.
    const modes = annual ? MODES.filter(item => item.key === 'monthly') : MODES;
    const mode = annual ? modes[0] : MODES.find(item => item.key === state.mode);
    renderChartControls(metrics, modes, mode.key);
    // La tarjeta del objetivo graficado queda marcada (tambien cuando se elige con los chips).
    document.querySelectorAll('#objective-cards .objective-card').forEach(card => {
      const selected = card.dataset.metric === state.metric;
      card.classList.toggle('active', selected);
      card.setAttribute('aria-pressed', String(selected));
    });
    const metric = metrics.find(item => item.key === state.metric);
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
    renderChartKpis(metric);
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
    // Sin periodo de comparacion (vista anual o primer mes) las columnas de mes anterior y variacion se ocultan.
    document.querySelector('.campaigns-panel')?.classList.toggle('no-compare', !period?.compare);
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

    if (title) title.textContent = `Anuncios | ${period.label} ${period.year}`;
    if (sub) sub.textContent = `${rows.length} ${rows.length === 1 ? 'anuncio' : 'anuncios'} ordenados por resultados dentro de cada objetivo. La estrella marca al lider de cada objetivo.`;
    if (prevHead) prevHead.textContent = period.compare ? `Resultados ${period.compare.label}` : 'Mes anterior';

    if (!rows.length) {
      body.innerHTML = '<tr><td class="table-empty" colspan="15">No hay anuncios para este objetivo en el periodo.</td></tr>';
      return;
    }
    const monthShort = period.month?.shortName;
    body.innerHTML = rows.map(ad => {
      const before = previous.get(ad.key);
      const change = before ? data().metrics.change(ad.results, before.results) : null;
      const changeCell = !period.compare ? '<span class="no-data">-</span>'
        : !before ? '<span class="delta-pill new">Nuevo</span>'
        : change == null ? '<span class="no-data">-</span>'
        : `<span class="delta-pill ${change >= 0 ? 'good' : 'bad'}">${change >= 0 ? '&#9650;' : '&#9660;'} ${fmt('pct', Math.abs(change), 0)}</span>`;
      let days = '-';
      if (period.annual && ad.firstDate) days = ad.firstDate === ad.lastDate ? shortDate(ad.firstDate, false) : `${shortDate(ad.firstDate, false)} - ${shortDate(ad.lastDate, false)}`;
      else if (!period.annual && ad.firstDay) days = ad.firstDay === ad.lastDay ? `${ad.firstDay} ${monthShort}` : `${ad.firstDay}-${ad.lastDay} ${monthShort}`;
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

  function shortDate(iso, withYear = true) {
    const [year, month, day] = String(iso || '').split('-').map(Number);
    if (!year || !month || !day) return '-';
    return `${day} ${data().SHORT_MONTHS[month - 1]}${withYear ? ` ${year}` : ''}`;
  }

  function periodLabel(first, last) {
    if (first === last) return shortDate(first);
    return `${shortDate(first, first.slice(0, 4) !== last.slice(0, 4))} - ${shortDate(last)}`;
  }

  // Mes elegido en las pestanas del Historico; null es "Todos" (o un mes que ya no tiene datos).
  function historyMonth() {
    if (state.historyMonth === HISTORY_ALL) return null;
    const month = data().monthByKey(state.historyMonth);
    return month?.hasData ? month : null;
  }

  function renderHistoryTabs(snapshot, month) {
    const host = document.getElementById('history-month-tabs');
    if (!host) return;
    host.innerHTML = monthTabsHtml(snapshot, month?.key, {
      key: HISTORY_ALL,
      label: 'Todos',
      title: 'Todas las descargas de Meta en Drive',
      available: snapshot.months.some(item => item.hasData),
      selected: !month,
    });
  }

  const matchesStatus = (item, key) => key === 'todas' || (key === 'activas' ? !item.finished : item.finished);

  // Una fila por campana con las cifras del alcance elegido: todas las descargas o solo el archivo de un mes
  // (las campanas que corrieron ese mes, con sus dias activos y su gasto de ese mes).
  function historyEntries(all, month) {
    if (!month) return all.map(item => ({ item, stats: item, rows: item.rows, ads: item.ads }));
    return all
      .filter(item => item.months.includes(month.key))
      .map(item => {
        const rows = item.rows.filter(row => row.day.startsWith(month.key));
        const days = rows.filter(row => row.spend > 0 || row.impressions > 0).map(row => row.d);
        return {
          item,
          stats: data().metrics.campaigns(rows)[0],
          rows,
          ads: data().metrics.ads(rows).sort((a, b) => b.results - a.results),
          from: Math.min(...days),
          to: Math.max(...days),
        };
      })
      .sort((a, b) => b.stats.spend - a.stats.spend);
  }

  // Todas / Activas / Finalizadas, con cuantas campanas hay de cada una en el mes elegido.
  function renderHistoryStatus(entries) {
    const host = document.getElementById('history-status-filter');
    if (!host) return;
    host.innerHTML = HISTORY_STATUS.map(status => {
      const selected = status.key === state.historyStatus;
      const count = entries.filter(entry => matchesStatus(entry.item, status.key)).length;
      return `<label class="series-toggle campaign-chip${selected ? ' active' : ''}"><input type="radio" name="history-status" value="${status.key}"${selected ? ' checked' : ''}>${status.label} (${count})</label>`;
    }).join('');
  }

  function renderHistoryKpis(snapshot, entries, month) {
    const host = document.getElementById('history-kpis');
    if (!host) return;
    const totals = data().metrics.summarize(entries.flatMap(entry => entry.rows));
    const active = entries.filter(entry => !entry.item.finished).length;
    const finished = entries.length - active;
    const statusNote = {
      todas: `${active} ${active === 1 ? 'activa' : 'activas'} y ${finished} ${finished === 1 ? 'finalizada' : 'finalizadas'}`,
      activas: `Con gasto al ${shortDate(snapshot.dataEnd)}`,
      finalizadas: `Sin gasto al ${shortDate(snapshot.dataEnd)}`,
    }[state.historyStatus];
    host.innerHTML = [
      ['Campanas', fmt('count', entries.length), statusNote],
      ['Inversion', fmt('money', totals.spend), month ? `Gasto en ${month.name}` : 'Gasto acumulado'],
      ['Impresiones', fmt('count', totals.impressions), month ? `En ${month.name}` : 'Total historico'],
      ['Alcance', fmt('count', totals.reach), 'Suma diaria por publico'],
      ['CPM prom.', fmt('money', totals.cpm), 'Costo por mil impresiones'],
    ].map(([label, value, meta]) => `<div class="kpi-pill"><span>${label}</span><strong>${value}</strong><small>${esc(meta)}</small></div>`).join('');
  }

  function historyAdChip(ad) {
    const url = data().safeUrl(ad.preview);
    return url
      ? `<a class="history-ad-link" href="${url}" target="_blank" rel="noopener noreferrer">${esc(ad.ad)}</a>`
      : `<span class="history-ad-muted">${esc(ad.ad)}</span>`;
  }

  // La lista de anuncios va plegada: abierta estiraba la fila una linea por anuncio y ensanchaba la tabla.
  function historyAdsCell(ads) {
    if (!ads.length) return '<span class="no-data">-</span>';
    return `<details class="history-ads"><summary>${ads.length} ${ads.length === 1 ? 'anuncio' : 'anuncios'}</summary><div class="history-ads-list">${ads.map(historyAdChip).join('')}</div></details>`;
  }

  // Una sola tabla con todas las campanas de las descargas de Meta en Drive. "Todos" lleva una columna de gasto
  // por archivo mensual; un mes deja las campanas de su archivo con las cifras de ese mes y el acumulado al final.
  function renderHistory() {
    const head = document.getElementById('history-head');
    const body = document.getElementById('history-body');
    const snapshot = data()?.snapshot();
    if (!head || !body || !snapshot) return;
    const month = historyMonth();
    state.historyMonth = month ? month.key : HISTORY_ALL;
    renderHistoryTabs(snapshot, month);
    const scoped = historyEntries(campaignHistory(snapshot), month);
    renderHistoryStatus(scoped);
    const entries = scoped.filter(entry => matchesStatus(entry.item, state.historyStatus));
    renderHistoryKpis(snapshot, entries, month);

    const months = month ? [] : snapshot.months.filter(item => item.hasData);
    head.innerHTML = `<tr><th>Campaña</th><th>Objetivo</th><th>Estado</th>${months.map(item => {
      const partial = !item.complete && !item.past;
      return `<th class="num" title="${esc(item.fileName || `${item.name} ${item.year}`)}">${item.shortName}${partial ? ` (al ${item.lastDay})` : ''}</th>`;
    }).join('')}<th class="num">${month ? `Gasto ${month.shortName}` : 'Gasto total'}</th><th class="num">Resultados</th><th class="num th-wrap">Costo por resultado</th><th class="num">Impresiones</th><th class="num">Alcance</th><th>Anuncios</th>${month
      ? '<th>Dias activos</th><th class="num" title="Gasto de la campana en todos los meses">Gasto acumulado</th>'
      : '<th>Periodo</th>'}</tr>`;

    const status = HISTORY_STATUS.find(item => item.key === state.historyStatus);
    const noun = entries.length === 1 ? status.one : status.many;
    const sub = document.getElementById('history-sub');
    if (sub) {
      const range = months.length > 1 ? `${months[0].name} a ${months[months.length - 1].name}` : months[0]?.name;
      if (!entries.length) {
        sub.textContent = `Ninguna ${status.one} ${month ? `con gasto en ${month.name} ${month.year}` : 'en las descargas de Meta en Drive'}.`;
      } else if (month) {
        sub.textContent = `${entries.length} ${noun} con gasto en ${month.name} ${month.year} segun su archivo en Drive (${month.fileName || 'sin nombre'}).`;
      } else {
        sub.textContent = `${entries.length} ${noun} en ${months.length} ${months.length === 1 ? 'descarga' : 'descargas'} de Meta en Drive (${range} ${snapshot.year}). Cada mes es el gasto de su archivo; el nombre aparece al pasar el mouse.`;
      }
    }
    if (!entries.length) {
      body.innerHTML = `<tr><td colspan="${head.querySelectorAll('th').length}" class="table-empty">Sin ${status.many} ${month ? `en ${esc(month.name)}` : 'en las descargas cargadas'}.</td></tr>`;
      return;
    }

    const spendIn = (rows, key) => rows.reduce((sum, row) => (row.day.startsWith(key) ? sum + row.spend : sum), 0);
    const daysLabel = (from, to) => (from === to ? `${from} ${month.shortName}` : `${from}-${to} ${month.shortName}`);
    const allRows = entries.flatMap(entry => entry.rows);
    const total = data().metrics.summarize(allRows);
    const totalPeriod = month
      ? daysLabel(Math.min(...entries.map(entry => entry.from)), Math.max(...entries.map(entry => entry.to)))
      : periodLabel(entries.reduce((min, entry) => (entry.item.first < min ? entry.item.first : min), entries[0].item.first),
        entries.reduce((max, entry) => (entry.item.last > max ? entry.item.last : max), entries[0].item.last));
    body.innerHTML = entries.map(({ item, stats, ads, from, to }) => `
      <tr>
        <td class="campaign-name">${esc(item.name)}</td>
        <td><span class="objective-label" style="--campaign-color:${item.color}"><i class="campaign-dot"></i>${esc(item.groupLabel)}</span></td>
        <td>${item.finished ? '<span class="type-pill slate">Finalizada</span>' : '<span class="type-pill green">Activa</span>'}</td>
        ${months.map(column => `<td class="num">${item.months.includes(column.key) ? fmt('money', spendIn(item.rows, column.key)) : '<span class="no-data">-</span>'}</td>`).join('')}
        <td class="num"><b>${fmt('money', stats.spend)}</b></td>
        <td class="num history-results"><b>${fmt('count', stats.results)}</b><small>${esc(stats.resultLabel)}</small></td>
        <td class="num">${fmt('unitCost', stats.costPerResult)}</td>
        <td class="num">${fmt('count', stats.impressions)}</td>
        <td class="num">${fmt('count', stats.reach)}</td>
        <td>${historyAdsCell(ads)}</td>
        ${month
          ? `<td class="date-col">${daysLabel(from, to)}</td><td class="num">${fmt('money', item.spend)}</td>`
          : `<td class="date-col">${periodLabel(item.first, item.last)}</td>`}
      </tr>`).join('') + `
      <tr class="total-row">
        <td class="campaign-name">${month ? `Total de ${esc(month.name)}` : 'Total'}</td>
        <td></td><td></td>
        ${months.map(item => `<td class="num">${entries.some(entry => entry.item.months.includes(item.key)) ? fmt('money', spendIn(allRows, item.key)) : '<span class="no-data">-</span>'}</td>`).join('')}
        <td class="num">${fmt('money', total.spend)}</td>
        <td class="num"><span class="no-data" title="Cada objetivo mide su propio resultado">No se suman</span></td>
        <td></td>
        <td class="num">${fmt('count', total.impressions)}</td>
        <td class="num">${fmt('count', total.reach)}</td>
        <td></td>
        <td class="date-col">${totalPeriod}</td>
        ${month ? '<td></td>' : ''}
      </tr>`;
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
    state.monthKey = annualView() ? YEAR_KEY : month?.key || null;
    const period = currentPeriod();
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
    document.getElementById('history-month-tabs')?.addEventListener('click', event => {
      const button = event.target.closest('.month-tab:not(:disabled)');
      if (!button || button.dataset.month === state.historyMonth) return;
      state.historyMonth = button.dataset.month;
      renderHistory();
    });
    document.getElementById('history-status-filter')?.addEventListener('change', event => {
      const input = event.target.closest('input[name="history-status"]');
      if (!input) return;
      state.historyStatus = input.value;
      renderHistory();
    });
    document.getElementById('chart-metrics')?.addEventListener('change', event => {
      const input = event.target.closest('input[name="chart-metric"]');
      if (!input) return;
      state.metric = input.value;
      saveSetting(CHART_METRIC_KEY, state.metric);
      renderChart();
    });
    // Pulsar una tarjeta de objetivo grafica su resultado; pulsarla de nuevo vuelve a la inversion.
    document.getElementById('objective-cards')?.addEventListener('click', event => {
      const card = event.target.closest('.objective-card[data-metric]');
      if (!card) return;
      state.metric = state.metric === card.dataset.metric ? 'spend' : card.dataset.metric;
      saveSetting(CHART_METRIC_KEY, state.metric);
      // Con el grafico minimizado, elegir un objetivo lo vuelve a abrir.
      if (state.chartCollapsed) {
        state.chartCollapsed = false;
        saveSetting(CHART_COLLAPSED_KEY, false);
      }
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
      renderAds(currentPeriod());
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
      [['distribution-body', 13], ['campaigns-body', 15], ['history-body', 10]].forEach(([id, span]) => {
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
