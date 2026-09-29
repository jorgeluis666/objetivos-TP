(function () {
  const SHORT_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  // Cada objetivo trae su color desde js/data-source.js; el gasto siempre va en azul.
  const SPEND_COLOR = '#2563eb';
  const HANDLE_HIT_RADIUS = 16;
  const SERIES = {
    results: { key: 'results', label: 'Resultados', axis: 'y', unit: 'count' },
    spend: { key: 'spend', label: 'Gasto', axis: 'y1', unit: 'money' },
  };

  const state = {
    ready: false,
    campaign: null,
    visible: { results: true, spend: true },
    // Escenarios por mes y objetivo: { [mes]: { [objetivo]: { results: valor, spend: valor } } }.
    // El punto actual siempre queda en el ultimo dia con datos; solo cambia su valor.
    scenarios: {},
    chart: null,
    projection: null,
    drag: null,
  };

  const money = value => Number.isFinite(Number(value))
    ? `S/. ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '-';
  const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '-';
  // Los costos por resultado de branding son centavos: se muestran con mas decimales para que no se vean en 0.01.
  const unitCost = value => (Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) < 0.1
    ? `S/. ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 3, maximumFractionDigits: 4 })}`
    : money(value));
  const format = (value, unit) => (unit === 'money' ? money(value) : count(Math.round(Number(value) || 0)));
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function scenarioFor(monthKey, objectiveKey) {
    state.scenarios[monthKey] = state.scenarios[monthKey] || {};
    state.scenarios[monthKey][objectiveKey] = state.scenarios[monthKey][objectiveKey] || {};
    return state.scenarios[monthKey][objectiveKey];
  }

  // Ritmo lineal: el acumulado al ultimo dia con datos dividido entre los dias transcurridos desde el primer
  // dia con datos, extendido hasta fin de mes. daily es el acumulado real dia a dia (indice 0 = dia 1).
  function buildSeries(daily, firstDay, lastDay, daysInMonth, closed, override) {
    const actual = daily[lastDay - 1] || 0;
    const adjusted = Number.isFinite(override);
    const elapsed = Math.max(1, lastDay - firstDay + 1);
    const daysLeft = daysInMonth - lastDay;
    const value = adjusted ? override : actual;
    const pace = value / elapsed;
    const realPace = actual / elapsed;
    return {
      daily,
      actual,
      realDay: lastDay,
      realPace,
      realProjected: closed ? actual : actual + realPace * daysLeft,
      day: lastDay,
      value,
      pace,
      projected: closed && !adjusted ? actual : value + pace * daysLeft,
      adjusted,
    };
  }

  // Se proyecta el ultimo mes con datos, por objetivo: cada objetivo mide un resultado distinto
  // (interacciones, ThruPlays, clics al boton de WhatsApp) y los resultados no se suman entre si.
  function buildProjection() {
    const tp = window.TPData;
    const month = tp?.latestMonth();
    if (!month || !month.hasData || !month.lastDay) return null;
    const { metrics } = tp;
    const closed = month.complete || month.past;
    const firstDay = month.firstDay || 1;
    const lastDay = closed ? month.daysInMonth : month.lastDay;
    const daysInMonth = month.daysInMonth;

    const campaigns = metrics.objectives(month.rows).map(objective => {
      const filter = row => row.group === objective.key;
      const scenario = scenarioFor(month.key, objective.key);
      const results = buildSeries(metrics.cumulative(metrics.dailyValues(month, 'results', filter)), firstDay, lastDay, daysInMonth, closed, scenario.results);
      const spend = buildSeries(metrics.cumulative(metrics.dailyValues(month, 'spend', filter)), firstDay, lastDay, daysInMonth, closed, scenario.spend);
      return {
        key: objective.key,
        name: objective.campaigns.join(' / '),
        short: objective.label,
        type: `${objective.campaigns.length} ${objective.campaigns.length === 1 ? 'campana' : 'campanas'}`,
        resultLabel: objective.resultLabel,
        color: objective.color,
        results,
        spend,
        costPerResult: results.projected > 0 ? spend.projected / results.projected : null,
        currentCost: objective.costPerResult,
        adjusted: results.adjusted || spend.adjusted,
      };
    });

    const spendActual = campaigns.reduce((total, campaign) => total + campaign.spend.actual, 0);
    const spendProjected = campaigns.reduce((total, campaign) => total + campaign.spend.projected, 0);
    // El CPL real que usa la calculadora es el costo por resultado del objetivo de WhatsApp.
    const whatsapp = campaigns.find(campaign => /whatsapp/.test(campaign.key));

    return {
      monthKey: month.key,
      monthName: month.name,
      monthLabel: `${month.name} ${month.year}`,
      shortMonth: SHORT_MONTHS[month.month - 1],
      year: month.year,
      daysInMonth,
      daysWithData: lastDay,
      firstDay,
      daysLeft: daysInMonth - lastDay,
      closed,
      source: tp.statusLabel(),
      campaigns,
      spendActual,
      spendProjected,
      spendPace: spendActual / Math.max(1, lastDay - firstDay + 1),
      adjusted: campaigns.some(campaign => campaign.adjusted),
      spendAdjusted: campaigns.some(campaign => campaign.spend.adjusted),
      costPerLead: whatsapp?.currentCost || null,
      costPerLeadLabel: whatsapp ? `${whatsapp.short}: ${whatsapp.resultLabel.toLowerCase()}` : '',
    };
  }

  function selectedCampaign(projection) {
    if (!projection.campaigns.length) return null;
    return projection.campaigns.find(campaign => campaign.key === state.campaign) || projection.campaigns[0];
  }

  function renderKpis(projection) {
    const host = document.getElementById('projection-kpis');
    if (!host) return;
    const budgetHint = `Ritmo real ${money(projection.spendPace)} por dia`;
    const spendCards = [
      `<div class="kpi-pill"><span>Gasto al ${projection.daysWithData}-${projection.shortMonth}</span><strong>${money(projection.spendActual)}</strong><small>${projection.closed ? 'Mes cerrado' : `Quedan ${projection.daysLeft} dias del mes`}</small></div>`,
      `<div class="kpi-pill"><span>Gasto proyectado</span><strong>${money(projection.spendProjected)}</strong><small>${projection.spendAdjusted ? 'Incluye escenarios ajustados' : budgetHint}</small></div>`,
    ];
    const selected = selectedCampaign(projection);
    const campaignCards = projection.campaigns.map(campaign => `
      <button type="button" class="kpi-pill projection-campaign-card${campaign === selected ? ' active' : ''}${campaign.adjusted ? ' is-adjusted' : ''}" data-campaign="${escapeHtml(campaign.key)}" style="--campaign-color:${campaign.color}" title="${escapeHtml(campaign.name)}">
        <span><i class="campaign-dot"></i>${escapeHtml(campaign.short)} | ${escapeHtml(campaign.resultLabel)}</span>
        <strong>${count(Math.round(campaign.results.projected))}</strong>
        <small>Gasto proyectado ${money(campaign.spend.projected)}</small>
      </button>`);
    host.innerHTML = spendCards.concat(campaignCards).join('');
  }

  function renderCampaignChips(projection) {
    const host = document.getElementById('projection-campaigns');
    if (!host) return;
    const selected = selectedCampaign(projection);
    host.innerHTML = projection.campaigns.map(campaign => `
      <label class="series-toggle campaign-chip${campaign === selected ? ' active' : ''}" style="--campaign-color:${campaign.color}" title="${escapeHtml(campaign.name)}">
        <input type="radio" name="projection-campaign" value="${escapeHtml(campaign.key)}"${campaign === selected ? ' checked' : ''}>${escapeHtml(campaign.short)}
      </label>`).join('');
  }

  function renderTable(projection) {
    const body = document.getElementById('projection-body');
    if (!body) return;
    const rows = projection.campaigns.map(campaign => {
      const status = campaign.adjusted
        ? '<span class="projection-gap over">Escenario ajustado</span>'
        : '<span class="projection-gap ok">Ritmo real</span>';
      return `
        <tr>
          <td class="campaign-name"><span class="campaign-dot" style="--campaign-color:${campaign.color}"></span>${escapeHtml(campaign.short)}</td>
          <td class="projection-campaigns-col">${escapeHtml(campaign.type)}<small class="projection-campaign-full">${escapeHtml(campaign.name)}</small></td>
          <td><span class="objective-pill">${escapeHtml(campaign.resultLabel)}</span></td>
          <td class="num">${count(campaign.results.actual)}</td>
          <td class="num">${count(Math.round(campaign.results.pace))}</td>
          <td class="num projection-value">${count(Math.round(campaign.results.projected))}</td>
          <td class="num">${money(campaign.spend.actual)}</td>
          <td class="num projection-value">${money(campaign.spend.projected)}</td>
          <td class="num">${unitCost(campaign.costPerResult)}</td>
          <td>${status}</td>
        </tr>`;
    }).join('');

    const totalRow = `
      <tr class="projection-cost-row">
        <td class="campaign-name">Total del mes</td>
        <td></td>
        <td><span class="no-data">Los resultados no se suman entre objetivos</span></td>
        <td></td><td></td><td></td>
        <td class="num">${money(projection.spendActual)}</td>
        <td class="num projection-value">${money(projection.spendProjected)}</td>
        <td></td>
        <td></td>
      </tr>`;

    body.innerHTML = rows ? rows + totalRow : '<tr><td class="table-empty" colspan="10">No hay campanas con gasto en el mes.</td></tr>';

    const head = document.getElementById('projection-actual-head');
    if (head) head.textContent = `Resultados al ${projection.daysWithData}-${projection.shortMonth}`;
    const closeHead = document.getElementById('projection-close-head');
    if (closeHead) closeHead.textContent = `Proyeccion al ${projection.daysInMonth}-${projection.shortMonth}`;
  }

  function renderLegend(projection, campaign) {
    const host = document.getElementById('projection-legend');
    if (!host) return;
    const items = [];
    if (state.visible.results) {
      items.push(`<span><i class="legend-line" style="background:${campaign.color}"></i><b>${escapeHtml(campaign.resultLabel)} real</b></span>`);
      items.push(`<span><i class="legend-line dashed" style="color:${campaign.color}"></i><b>${escapeHtml(campaign.resultLabel)} proyectado</b></span>`);
    }
    if (state.visible.spend) {
      items.push(`<span><i class="legend-line" style="background:${SPEND_COLOR}"></i><b>Gasto real</b></span>`);
      items.push(`<span><i class="legend-line dashed" style="color:${SPEND_COLOR}"></i><b>Gasto proyectado</b></span>`);
    }
    if (campaign.adjusted) items.push('<span><i class="legend-line dashed" style="color:#94a3b8"></i><b>Proyeccion original</b></span>');
    if (!projection.closed) items.push('<span><i class="legend-handle"></i><b>Punto actual (arrastrar arriba o abajo)</b></span>');
    host.innerHTML = items.join('');
  }

  function renderScenarioBar(projection, campaign) {
    const host = document.getElementById('projection-scenario');
    if (!host) return;
    if (projection.closed || !campaign) {
      host.hidden = true;
      return;
    }
    host.hidden = false;
    const day = `${projection.daysWithData}-${projection.shortMonth}`;
    const field = (key, label, series, step) => `
      <label class="projection-scenario-field">
        <span>${escapeHtml(label)} al ${day}</span>
        <input type="number" min="0" step="${step}" value="${step === 1 ? Math.round(series.value) : series.value.toFixed(2)}" data-series="${key}" aria-label="${escapeHtml(label)} al ${day}">
        <em>${series.adjusted ? `real ${format(series.actual, SERIES[key].unit)}` : 'valor real'}</em>
      </label>`;
    host.innerHTML = `
      <div class="projection-scenario-text">
        ${field('results', campaign.resultLabel, campaign.results, 1)}
        ${field('spend', 'Gasto (S/.)', campaign.spend, 0.01)}
      </div>
      <button type="button" class="table-tool-btn" id="projection-reset" ${campaign.adjusted ? '' : 'disabled'}>Restablecer punto actual</button>`;
  }

  // Linea vertical en el dia de corte real y etiqueta de valor sobre cada punto arrastrable.
  const projectionMarkers = {
    id: 'projectionMarkers',
    afterDatasetsDraw(chart, args, options) {
      const ctx = chart.ctx;
      const { top, bottom, left, right } = chart.chartArea;
      const index = options?.index;
      if (index != null && index >= 0) {
        const x = chart.scales.x.getPixelForValue(index);
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#7890b5';
        ctx.font = '700 9px Inter, sans-serif';
        ctx.textAlign = x > (left + right) / 2 ? 'right' : 'left';
        ctx.fillText(options.label || 'Ultima actualizacion', x + (ctx.textAlign === 'right' ? -6 : 6), top + 10);
        ctx.restore();
      }
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        if (!dataset.handle || !chart.isDatasetVisible(datasetIndex)) return;
        const point = chart.getDatasetMeta(datasetIndex).data[dataset.handleIndex];
        if (!point) return;
        const text = format(dataset.data[dataset.handleIndex], dataset.unit);
        ctx.save();
        if (dataset.realValue != null && dataset.realValue !== dataset.data[dataset.handleIndex]) {
          const realY = chart.scales[dataset.yAxisID].getPixelForValue(dataset.realValue);
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = dataset.borderColor;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(point.x, realY);
          ctx.lineTo(point.x, point.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.font = '700 10px Inter, sans-serif';
        const width = ctx.measureText(text).width + 12;
        const x = Math.min(Math.max(point.x - width / 2, left), right - width);
        // Resultados etiqueta arriba y gasto abajo para que no se tapen cuando las lineas se acercan.
        const above = dataset.seriesKey !== 'spend';
        const y = above ? (point.y - 28 < top ? point.y + 12 : point.y - 28) : (point.y + 29 > bottom ? point.y - 28 : point.y + 12);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = dataset.borderColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, y, width, 17, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = dataset.borderColor;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x + 6, y + 9);
        ctx.restore();
      });
    },
  };

  function seriesDatasets(series, meta, projection, draggable) {
    const days = projection.daysInMonth;
    // La linea real es el acumulado dia a dia de la descarga de Meta; la proyeccion parte del punto actual.
    const real = Array.from({ length: days }, (_, i) => (i + 1 <= series.realDay ? series.daily[i] ?? null : null));
    const forecast = Array.from({ length: days }, (_, i) => (i + 1 >= series.day ? series.value + series.pace * (i + 1 - series.day) : null));
    const original = Array.from({ length: days }, (_, i) => (i + 1 >= series.realDay ? series.actual + series.realPace * (i + 1 - series.realDay) : null));
    const handle = Array.from({ length: days }, (_, i) => (i + 1 === series.day ? series.value : null));
    const base = { yAxisID: meta.axis, unit: meta.unit, pointRadius: 0, pointHoverRadius: 4, tension: 0, seriesKey: meta.key };
    const datasets = [
      { ...base, label: `${meta.label} real`, data: real, borderColor: meta.color, backgroundColor: meta.fill, borderWidth: 2, fill: meta.key === 'results' ? 'origin' : false },
      { ...base, label: `${meta.label} proyectado`, data: projection.closed ? [] : forecast, borderColor: meta.color, borderDash: [6, 5], borderWidth: 2, fill: false },
    ];
    if (series.adjusted) {
      datasets.push({ ...base, label: `${meta.label} proyeccion original`, data: original, borderColor: '#94a3b8', borderDash: [3, 4], borderWidth: 1.5, fill: false });
    }
    if (draggable) {
      datasets.push({ ...base, label: `${meta.label} punto actual`, data: handle, borderColor: meta.color, backgroundColor: '#fff', borderWidth: 3, pointRadius: 7, pointHoverRadius: 9, showLine: false, handle: true, handleIndex: series.day - 1, realValue: series.actual });
    }
    return datasets;
  }

  function chartDatasets(projection, campaign) {
    const draggable = !projection.closed;
    const datasets = [];
    if (state.visible.results) {
      datasets.push(...seriesDatasets(campaign.results, { ...SERIES.results, label: campaign.resultLabel, color: campaign.color, fill: `${campaign.color}1a` }, projection, draggable));
    }
    if (state.visible.spend) {
      datasets.push(...seriesDatasets(campaign.spend, { ...SERIES.spend, color: SPEND_COLOR, fill: 'rgba(37,99,235,.08)' }, projection, draggable));
    }
    return datasets;
  }

  function renderChart(projection) {
    const canvas = document.getElementById('chart-projection');
    if (!canvas || typeof Chart === 'undefined') return;
    const campaign = selectedCampaign(projection);
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    if (!campaign) {
      renderLegend(projection, { adjusted: false });
      return;
    }
    const labels = Array.from({ length: projection.daysInMonth }, (_, index) => `${index + 1} ${projection.shortMonth}`);
    const money0 = value => (value === 0 ? 'S/. 0' : `S/. ${Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 })}`);

    state.chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets: chartDatasets(projection, campaign) },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 18, right: 8, left: 4 } },
        plugins: {
          legend: { display: false },
          projectionMarkers: { index: projection.daysWithData - 1, label: `Datos al ${projection.daysWithData}-${projection.shortMonth}` },
          tooltip: {
            filter: item => item.raw != null && !item.dataset.handle,
            callbacks: {
              label: context => ` ${context.dataset.label}: ${format(context.raw, context.dataset.unit)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#7890b5', font: { size: 10 }, maxTicksLimit: 10, autoSkip: true } },
          y: {
            display: 'auto', position: 'left', beginAtZero: true, border: { display: false }, grid: { color: 'rgba(148,163,184,.20)' },
            title: { display: true, text: campaign.resultLabel, color: campaign.color, font: { size: 10, weight: '700' } },
            ticks: { color: '#7890b5', font: { size: 10 }, callback: value => Number(value).toLocaleString('es-PE') },
          },
          y1: {
            // Con ambas series visibles el gasto recibe margen extra para que su linea corra por debajo de la de resultados.
            display: 'auto', position: 'right', beginAtZero: true, grace: state.visible.results ? '60%' : 0, border: { display: false }, grid: { drawOnChartArea: !state.visible.results },
            title: { display: true, text: 'Gasto', color: SPEND_COLOR, font: { size: 10, weight: '700' } },
            ticks: { color: '#7890b5', font: { size: 10 }, callback: money0 },
          },
        },
      },
      plugins: [projectionMarkers],
    });

    renderLegend(projection, campaign);
  }

  function renderHeader(projection) {
    const title = document.getElementById('projection-title');
    if (title) title.textContent = `Linea de tiempo | ${projection.monthLabel}`;
    const sub = document.getElementById('projection-sub');
    if (sub) {
      sub.textContent = projection.closed
        ? `Mes cerrado con ${projection.daysInMonth} dias de datos.`
        : `Datos reales hasta el dia ${projection.daysWithData} y proyeccion lineal hasta el ${projection.daysInMonth}. Arrastra el punto actual hacia arriba o abajo para simular otro escenario.`;
    }
    const note = document.getElementById('projection-note');
    if (note) {
      note.textContent = `Cada objetivo mide un resultado distinto (interacciones, ThruPlays, clics al boton de WhatsApp), por eso se proyectan por separado. La linea continua es el acumulado real de cada dia; la punteada mantiene el ritmo diario del punto actual hasta el cierre del mes. Fuente: Meta Ads | ${projection.source}.`;
    }
    const desc = document.getElementById('projection-desc');
    if (desc) {
      desc.textContent = projection.closed
        ? `${projection.monthLabel} ya cerro: se muestran sus resultados finales por objetivo con los datos del modulo Gasto publicitario.`
        : `Proyeccion al cierre de ${projection.monthLabel} por objetivo, calculada con los datos reales del modulo Gasto publicitario hasta el ${projection.daysWithData} de ${projection.monthName.toLowerCase()}.`;
    }
  }

  // El CPL real del mes (costo por resultado del objetivo de WhatsApp) alimenta la calculadora de inversion.
  function renderCplLink(projection) {
    const button = document.getElementById('projection-use-cpl');
    if (!button) return;
    const cpl = projection.costPerLead;
    if (!cpl) {
      button.hidden = true;
      return;
    }
    button.hidden = false;
    button.textContent = `Usar CPL real (${money(cpl)})`;
    button.title = `Costo por resultado real de ${projection.costPerLeadLabel} en ${projection.monthLabel}`;
    button.dataset.cpl = cpl.toFixed(2);
  }

  // Sin datos se oculta el contenido del panel (sin borrarlo) para que vuelva cuando llegue un barrido bueno.
  function setPanelEmpty(empty) {
    const panel = document.getElementById('projection-panel');
    if (!panel) return;
    panel.classList.toggle('is-empty', empty);
    let notice = document.getElementById('projection-empty');
    if (empty && !notice) {
      notice = document.createElement('div');
      notice.id = 'projection-empty';
      notice.className = 'empty-state projection-empty';
      notice.innerHTML = '<strong>Sin datos para proyectar</strong>No hay descargas de Meta con gasto en la carpeta de Drive.';
      panel.appendChild(notice);
    }
  }

  function renderEmpty() {
    if (state.chart) {
      state.chart.destroy();
      state.chart = null;
    }
    setPanelEmpty(true);
    const body = document.getElementById('projection-body');
    if (body) body.innerHTML = '<tr><td class="table-empty" colspan="10">Sin datos para proyectar.</td></tr>';
  }

  function renderWaiting() {
    const sub = document.getElementById('projection-sub');
    if (sub) sub.textContent = 'Esperando los datos de Meta...';
    const body = document.getElementById('projection-body');
    if (body) body.innerHTML = '<tr><td class="table-empty" colspan="10">Esperando los datos de Meta...</td></tr>';
  }

  function recompute() {
    state.projection = buildProjection();
    return state.projection;
  }

  // Durante el arrastre solo se actualizan los datos del grafico; recrearlo cortaria el gesto.
  function refreshAfterScenario() {
    const projection = recompute();
    if (!projection) return;
    const campaign = selectedCampaign(projection);
    renderKpis(projection);
    renderTable(projection);
    renderScenarioBar(projection, campaign);
    renderLegend(projection, campaign);
    if (state.chart && campaign) {
      state.chart.data.datasets = chartDatasets(projection, campaign);
      state.chart.update('none');
    }
  }

  function render() {
    // El modulo puede abrirse antes de que lleguen los datos; el evento tp:data-updated lo reintenta.
    if (!window.TPData?.snapshot()) {
      renderWaiting();
      return;
    }
    const projection = recompute();
    if (!projection) {
      renderEmpty();
      return;
    }
    setPanelEmpty(false);
    const campaign = selectedCampaign(projection);
    state.campaign = campaign?.key || null;
    renderHeader(projection);
    renderKpis(projection);
    renderCampaignChips(projection);
    renderChart(projection);
    renderScenarioBar(projection, campaign);
    renderTable(projection);
    renderCplLink(projection);
  }

  function selectCampaign(key) {
    if (!key || key === state.campaign) return;
    state.campaign = key;
    render();
  }

  function handleAt(chart, x, y) {
    let best = null;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      if (!dataset.handle) return;
      const point = chart.getDatasetMeta(datasetIndex).data[dataset.handleIndex];
      if (!point) return;
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= HANDLE_HIT_RADIUS && (!best || distance < best.distance)) best = { dataset, distance };
    });
    return best?.dataset || null;
  }

  function canvasPoint(event) {
    const rect = event.target.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function setScenarioValue(seriesKey, value) {
    if (!state.projection || !Number.isFinite(value)) return;
    const rounded = seriesKey === 'spend' ? Math.round(value * 100) / 100 : Math.round(value);
    scenarioFor(state.projection.monthKey, state.campaign)[seriesKey] = Math.max(0, rounded);
    refreshAfterScenario();
  }

  function wireDrag() {
    const canvas = document.getElementById('chart-projection');
    if (!canvas) return;

    canvas.addEventListener('pointerdown', event => {
      const chart = state.chart;
      if (!chart || !state.projection || state.projection.closed) return;
      const { x, y } = canvasPoint(event);
      const handle = handleAt(chart, x, y);
      if (!handle) return;
      event.preventDefault();
      // Se congela el eje para que la escala no se mueva mientras se arrastra.
      const scale = chart.scales[handle.yAxisID];
      chart.options.scales[handle.yAxisID].max = scale.max;
      const point = chart.getDatasetMeta(chart.data.datasets.indexOf(handle)).data[handle.handleIndex];
      state.drag = { series: handle.seriesKey, axis: handle.yAxisID, max: scale.max, offset: y - point.y, pointerId: event.pointerId };
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-dragging');
      chart.options.plugins.tooltip.enabled = false;
    });

    canvas.addEventListener('pointermove', event => {
      const chart = state.chart;
      if (!chart) return;
      const { x, y } = canvasPoint(event);
      if (!state.drag) {
        canvas.classList.toggle('can-drag', Boolean(!state.projection?.closed && handleAt(chart, x, y)));
        return;
      }
      // Solo se mueve en vertical sobre el dia de corte y sin salir del area del grafico.
      const { top, bottom } = chart.chartArea;
      const pixel = Math.min(bottom, Math.max(top, y - state.drag.offset));
      const value = Math.min(state.drag.max, Math.max(0, chart.scales[state.drag.axis].getValueForPixel(pixel)));
      setScenarioValue(state.drag.series, value);
    });

    const endDrag = event => {
      if (!state.drag) return;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      const chart = state.chart;
      if (chart) {
        delete chart.options.scales[state.drag.axis].max;
        chart.options.plugins.tooltip.enabled = true;
        chart.update('none');
      }
      state.drag = null;
      canvas.classList.remove('is-dragging');
    };
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
  }

  function wireEvents() {
    document.getElementById('projection-campaigns')?.addEventListener('change', event => {
      const input = event.target.closest('input[type="radio"]');
      if (input) selectCampaign(input.value);
    });

    document.getElementById('projection-kpis')?.addEventListener('click', event => {
      const card = event.target.closest('[data-campaign]');
      if (card) selectCampaign(card.dataset.campaign);
    });

    document.getElementById('projection-series')?.addEventListener('change', event => {
      const input = event.target.closest('input[type="checkbox"]');
      if (!input) return;
      state.visible[input.value] = input.checked;
      // Siempre queda al menos una serie visible.
      if (!state.visible.results && !state.visible.spend) {
        state.visible[input.value] = true;
        input.checked = true;
      }
      document.querySelectorAll('#projection-series .series-toggle').forEach(label => {
        label.classList.toggle('active', Boolean(state.visible[label.querySelector('input')?.value]));
      });
      if (state.projection) renderChart(state.projection);
    });

    document.getElementById('projection-scenario')?.addEventListener('change', event => {
      const input = event.target.closest('input[data-series]');
      if (!input || input.value === '') return;
      setScenarioValue(input.dataset.series, Number(input.value));
    });

    document.getElementById('projection-scenario')?.addEventListener('click', event => {
      if (!event.target.closest('#projection-reset') || !state.projection) return;
      delete state.scenarios[state.projection.monthKey]?.[state.campaign];
      render();
    });

    document.getElementById('projection-use-cpl')?.addEventListener('click', event => {
      const cpl = event.currentTarget.dataset.cpl;
      if (!cpl) return;
      window.MessagesCalculator?.init();
      const input = document.getElementById('messages-cpl');
      if (!input) return;
      input.value = cpl;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    });

    window.addEventListener('tp:data-updated', () => {
      if (state.ready && !state.drag) render();
    });

    wireDrag();
  }

  function init() {
    if (!state.ready) {
      wireEvents();
      state.ready = true;
    }
    render();
  }

  window.TPProjections = { init, render };
})();
