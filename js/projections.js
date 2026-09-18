(function () {
  const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const SHORT_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const METRICS = {
    investment: { key: 'investment', label: 'Inversion', unit: 'money', color: '#2563eb', fill: 'rgba(37,99,235,.10)', field: 'spend', reference: 'budget', referenceLabel: 'Presupuesto' },
    messages: { key: 'messages', label: 'Mensajes', unit: 'count', color: '#16a34a', fill: 'rgba(22,163,74,.10)', field: 'messages', reference: null, referenceLabel: null },
    reservations: { key: 'reservations', label: 'Reservas', unit: 'count', color: '#ea580c', fill: 'rgba(234,88,12,.10)', field: 'reservations', reference: 'reservationGoal', referenceLabel: 'Objetivo' },
  };

  const state = { ready: false, metric: 'investment', chart: null, projection: null };

  const money = value => Number.isFinite(Number(value))
    ? `S/. ${Number(value).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '-';
  const count = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('es-PE', { maximumFractionDigits: 0 }) : '-';
  const format = (value, unit) => (unit === 'money' ? money(value) : count(Math.round(Number(value) || 0)));

  function toDate(iso) {
    const value = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? `${iso}T00:00:00` : iso;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function longDate(date) {
    return date ? `${date.getDate()} de ${MONTHS[date.getMonth()].toLowerCase()} de ${date.getFullYear()}` : '-';
  }

  // El mes proyectado es el que esta en curso; si aun no tiene gasto, se usa el ultimo mes con datos.
  function pickMonth(months, cutoff) {
    const withData = months.filter(month => Number(month.spend) > 0);
    if (!withData.length) return null;
    const reference = toDate(cutoff) || new Date();
    const current = withData.find(month => MONTHS.indexOf(month.name) === reference.getMonth());
    return current || withData[withData.length - 1];
  }

  function buildProjection(snapshot) {
    const month = pickMonth(snapshot.months || [], snapshot.cutoff);
    if (!month) return null;

    const monthIndex = MONTHS.indexOf(month.name);
    const year = snapshot.year || (toDate(snapshot.cutoff) || new Date()).getFullYear();
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const cutoffDate = toDate(snapshot.cutoff);
    const sameMonth = cutoffDate && cutoffDate.getMonth() === monthIndex && cutoffDate.getFullYear() === year;
    const closed = !sameMonth;
    const daysWithData = closed ? daysInMonth : Math.min(daysInMonth, Math.max(1, cutoffDate.getDate()));
    const daysLeft = daysInMonth - daysWithData;

    const reservationGoal = (month.campaigns || []).reduce((total, campaign) => total + (Number(campaign.reservationGoal) || 0), 0) || null;
    const references = { budget: Number(month.budgetTotal) || null, reservationGoal, messages: null };

    const metrics = Object.values(METRICS).map(metric => {
      const actual = Number(month[metric.field]) || 0;
      const pace = actual / daysWithData;
      const projected = closed ? actual : pace * daysInMonth;
      const reference = metric.reference ? references[metric.reference] : null;
      return {
        ...metric,
        actual,
        pace,
        projected,
        reference,
        gap: reference == null ? null : reference - projected,
        requiredPace: reference == null || daysLeft <= 0 ? null : Math.max(0, (reference - actual) / daysLeft),
      };
    });

    const byKey = Object.fromEntries(metrics.map(metric => [metric.key, metric]));
    const projectedSpend = byKey.investment.projected;
    const projectedMessages = byKey.messages.projected;
    const projectedReservations = byKey.reservations.projected;

    return {
      monthName: month.name,
      monthLabel: `${month.name} ${year}`,
      shortMonth: SHORT_MONTHS[monthIndex],
      year,
      daysInMonth,
      daysWithData,
      daysLeft,
      closed,
      cutoffDate,
      source: snapshot.source,
      metrics,
      byKey,
      budget: references.budget,
      budgetUsedPct: references.budget ? (byKey.investment.actual / references.budget) * 100 : null,
      budgetProjectedPct: references.budget ? (projectedSpend / references.budget) * 100 : null,
      costPerMessage: byKey.messages.actual ? byKey.investment.actual / byKey.messages.actual : null,
      costPerReservation: byKey.reservations.actual ? byKey.investment.actual / byKey.reservations.actual : null,
      projectedCostPerMessage: projectedMessages ? projectedSpend / projectedMessages : null,
      projectedCostPerReservation: projectedReservations ? projectedSpend / projectedReservations : null,
    };
  }

  function renderKpis(projection) {
    const host = document.getElementById('projection-kpis');
    if (!host) return;
    const investment = projection.byKey.investment;
    const messages = projection.byKey.messages;
    const reservations = projection.byKey.reservations;
    const budgetHint = projection.budget
      ? `${projection.budgetProjectedPct.toFixed(0)}% del presupuesto (${money(projection.budget)})`
      : 'Sin presupuesto registrado';
    const goalHint = reservations.reference
      ? `Objetivo ${count(reservations.reference)} | ${reservations.gap >= 0 ? `faltan ${count(Math.abs(Math.round(reservations.gap)))}` : `sobre el objetivo por ${count(Math.abs(Math.round(reservations.gap)))}`}`
      : 'Sin objetivo registrado';

    const cards = [
      { label: 'Inversion proyectada', value: money(investment.projected), hint: budgetHint },
      { label: 'Mensajes proyectados', value: count(Math.round(messages.projected)), hint: `Ritmo ${count(Math.round(messages.pace))} por dia` },
      { label: 'Reservas proyectadas', value: count(Math.round(reservations.projected)), hint: goalHint },
      { label: 'Ritmo de inversion', value: `${money(investment.pace)} / dia`, hint: projection.closed ? 'Mes cerrado' : `Quedan ${projection.daysLeft} dias del mes` },
      { label: 'Avance del mes', value: `${projection.daysWithData} de ${projection.daysInMonth} dias`, hint: `Datos al ${longDate(projection.cutoffDate)}` },
    ];

    host.innerHTML = cards.map(card => `
      <div class="kpi-pill">
        <span>${card.label}</span>
        <strong>${card.value}</strong>
        <small>${card.hint}</small>
      </div>
    `).join('');
  }

  function renderTable(projection) {
    const body = document.getElementById('projection-body');
    if (!body) return;
    const rows = projection.metrics.map(metric => {
      const gap = metric.gap == null
        ? '<span class="no-data">Sin referencia</span>'
        : `<span class="projection-gap ${metric.gap >= 0 ? 'ok' : 'over'}">${metric.gap >= 0 ? '' : '+'}${format(Math.abs(metric.gap), metric.unit)} ${metric.gap >= 0 ? 'por debajo' : 'por encima'}</span>`;
      return `
        <tr>
          <td class="campaign-name">${metric.label}</td>
          <td class="num">${format(metric.actual, metric.unit)}</td>
          <td class="num">${format(metric.pace, metric.unit)}</td>
          <td class="num projection-value">${format(metric.projected, metric.unit)}</td>
          <td class="num">${metric.reference == null ? '<span class="no-data">-</span>' : format(metric.reference, metric.unit)}</td>
          <td>${gap}</td>
        </tr>`;
    }).join('');

    const costRow = `
      <tr class="projection-cost-row">
        <td class="campaign-name">Costo por mensaje / reserva</td>
        <td class="num">${money(projection.costPerMessage)} / ${money(projection.costPerReservation)}</td>
        <td class="num"><span class="no-data">-</span></td>
        <td class="num projection-value">${money(projection.projectedCostPerMessage)} / ${money(projection.projectedCostPerReservation)}</td>
        <td class="num"><span class="no-data">-</span></td>
        <td><span class="no-data">Se mantiene si el ritmo no cambia</span></td>
      </tr>`;

    body.innerHTML = rows + costRow;

    const head = document.getElementById('projection-actual-head');
    if (head) head.textContent = `Actual al ${projection.daysWithData}-${projection.shortMonth}`;
    const closeHead = document.getElementById('projection-close-head');
    if (closeHead) closeHead.textContent = `Proyeccion al ${projection.daysInMonth}-${projection.shortMonth}`;
  }

  function renderLegend(projection, metric) {
    const host = document.getElementById('projection-legend');
    if (!host) return;
    const items = [
      `<span><i class="legend-line" style="background:${metric.color}"></i><b>Acumulado real</b></span>`,
      `<span><i class="legend-line dashed" style="background:${metric.color}"></i><b>Proyeccion al cierre</b></span>`,
    ];
    if (metric.reference != null) {
      items.push(`<span><i class="legend-line dashed" style="background:#94a3b8"></i><b>${metric.referenceLabel}</b></span>`);
    }
    host.innerHTML = items.join('');
  }

  const cutoffMarker = {
    id: 'cutoffMarker',
    afterDatasetsDraw(chart, args, options) {
      const index = options?.index;
      if (index == null || index < 0) return;
      const x = chart.scales.x.getPixelForValue(index);
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
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
      ctx.textAlign = x > (chart.chartArea.left + chart.chartArea.right) / 2 ? 'right' : 'left';
      ctx.fillText(options.label || 'Ultima actualizacion', x + (ctx.textAlign === 'right' ? -6 : 6), top + 10);
      ctx.restore();
    },
  };

  function renderChart(projection) {
    const canvas = document.getElementById('chart-projection');
    if (!canvas || typeof Chart === 'undefined') return;
    const metric = projection.byKey[state.metric] || projection.byKey.investment;
    const labels = Array.from({ length: projection.daysInMonth }, (_, index) => `${index + 1} ${projection.shortMonth}`);
    const real = labels.map((_, index) => (index + 1 <= projection.daysWithData ? metric.pace * (index + 1) : null));
    const forecast = labels.map((_, index) => (index + 1 >= projection.daysWithData ? metric.pace * (index + 1) : null));

    const datasets = [
      { label: 'Acumulado real', data: real, borderColor: metric.color, backgroundColor: metric.fill, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .15, fill: true, unit: metric.unit },
      { label: 'Proyeccion al cierre', data: projection.closed ? [] : forecast, borderColor: metric.color, borderDash: [6, 5], borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: .15, fill: false, unit: metric.unit },
    ];
    if (metric.reference != null) {
      datasets.push({ label: metric.referenceLabel, data: labels.map(() => metric.reference), borderColor: '#94a3b8', borderDash: [3, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, fill: false, unit: metric.unit });
    }

    const ticks = metric.unit === 'money'
      ? value => (value === 0 ? 'S/. 0' : `S/. ${(value / 1000).toFixed(1)}k`)
      : value => Number(value).toLocaleString('es-PE');

    if (state.chart) state.chart.destroy();
    state.chart = new Chart(canvas, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 18, right: 14, left: 4 } },
        plugins: {
          legend: { display: false },
          cutoffMarker: { index: projection.daysWithData - 1, label: `Datos al ${projection.daysWithData}-${projection.shortMonth}` },
          tooltip: {
            callbacks: {
              label: context => (context.raw == null ? null : ` ${context.dataset.label}: ${format(context.raw, metric.unit)}`),
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#7890b5', font: { size: 10 }, maxTicksLimit: 10, autoSkip: true } },
          y: { beginAtZero: true, border: { display: false }, grid: { color: 'rgba(148,163,184,.20)' }, ticks: { color: '#7890b5', font: { size: 10 }, callback: ticks } },
        },
      },
      plugins: [cutoffMarker],
    });

    renderLegend(projection, metric);
  }

  function renderHeader(projection) {
    const title = document.getElementById('projection-title');
    if (title) title.textContent = `Linea de tiempo | ${projection.monthLabel}`;
    const sub = document.getElementById('projection-sub');
    if (sub) {
      sub.textContent = projection.closed
        ? `Mes cerrado con ${projection.daysInMonth} dias de datos.`
        : `Datos reales hasta el dia ${projection.daysWithData} y proyeccion lineal hasta el ${projection.daysInMonth}.`;
    }
    const note = document.getElementById('projection-note');
    if (note) {
      note.textContent = `La proyeccion asume que se mantiene el ritmo promedio del mes (${money(projection.byKey.investment.pace)} por dia). Fuente: ${projection.source || 'Terminal Pesquero'}.`;
    }
    const desc = document.getElementById('projection-desc');
    if (desc) {
      desc.textContent = `Proyeccion al cierre de ${projection.monthLabel} calculada con los datos reales del modulo Gasto publicitario, actualizados al ${longDate(projection.cutoffDate)}.`;
    }
  }

  // El CPL real del mes alimenta la calculadora de inversion.
  function renderCplLink(projection) {
    const button = document.getElementById('projection-use-cpl');
    if (!button) return;
    const cpl = projection.costPerMessage;
    if (!cpl) {
      button.hidden = true;
      return;
    }
    button.hidden = false;
    button.textContent = `Usar CPL real (${money(cpl)})`;
    button.dataset.cpl = cpl.toFixed(2);
  }

  function renderEmpty() {
    const panel = document.getElementById('projection-panel');
    if (panel) panel.innerHTML = '<div class="empty-state"><strong>Sin datos para proyectar</strong>Todavia no hay gasto registrado en el mes en curso.</div>';
    const body = document.getElementById('projection-body');
    if (body) body.innerHTML = '<tr><td class="table-empty" colspan="6">Sin datos para proyectar.</td></tr>';
  }

  function renderWaiting() {
    const sub = document.getElementById('projection-sub');
    if (sub) sub.textContent = 'Esperando los datos del modulo Gasto publicitario...';
    const body = document.getElementById('projection-body');
    if (body) body.innerHTML = '<tr><td class="table-empty" colspan="6">Esperando los datos del modulo Gasto publicitario...</td></tr>';
  }

  function render() {
    // El modulo puede abrirse antes de que Gasto publicitario termine de cargar; el evento tp:data-updated lo reintenta.
    const snapshot = window.TPObjectives?.snapshot?.();
    if (!snapshot) {
      renderWaiting();
      return;
    }
    const projection = buildProjection(snapshot);
    state.projection = projection;
    if (!projection) {
      renderEmpty();
      return;
    }
    renderHeader(projection);
    renderKpis(projection);
    renderChart(projection);
    renderTable(projection);
    renderCplLink(projection);
  }

  function wireEvents() {
    document.getElementById('projection-metrics')?.addEventListener('change', event => {
      const input = event.target.closest('input[type="radio"]');
      if (!input) return;
      state.metric = input.value;
      document.querySelectorAll('#projection-metrics .series-toggle').forEach(label => {
        label.classList.toggle('active', label.dataset.series === state.metric);
      });
      if (state.projection) renderChart(state.projection);
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
      if (state.ready) render();
    });
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
