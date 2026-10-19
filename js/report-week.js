(function () {
  // Generacion de Reporte: el reporte semanal de lunes a domingo, con el mismo orden del ultimo reporte
  // publicado en la carpeta Reportes de Drive (resumen del periodo, conversaciones por dia, mejores
  // anuncios, conjuntos y conclusiones). No trae datos nuevos: usa las mismas filas del barrido de Meta
  // que ya tiene el tablero (<Marca>Data.snapshot(), una fila por dia, campaña, conjunto y anuncio),
  // sumadas por semana en vez de por mes.
  //
  // Cada lunes la semana que acaba de cerrar pasa a ser la primera de la lista sin que nadie toque nada:
  // el tablero relee el barrido al abrirse y el workflow de Pages vuelve a publicar los lunes. Las
  // conclusiones las escribe el equipo (el barrido no sabe por que paso lo que paso) y quedan guardadas
  // por semana en este navegador.
  //
  // Este archivo es el mismo en todos los tableros de marca: lo unico que cambia es CONFIG.
  const CONFIG = {
    brand: 'Terminal Pesquero',
    slug: 'Terminal-Pesquero',
    data: () => window.TPData,
    updatedEvent: 'tp:data-updated',
    notesKey: 'tp-week-notes-v1',
    // El nombre que usa la descarga de esta marca para las conversaciones (gana el primero con datos).
    conversionFields: ['conversations', 'messages', 'results'],
  };

  const WEEKS_IN_LIST = 12;
  const SUM_FIELDS = ['spend', 'impressions', 'reach', 'clicks', 'results', 'conversations', 'messages', 'interactions', 'purchases'];
  // Titulos de las conclusiones del ultimo reporte de la carpeta: el equipo reescribe el texto, no el orden.
  const NOTE_FIELDS = [
    { key: 'logro', label: 'Lo que funciono' },
    { key: 'alerta', label: 'Lo que hay que corregir' },
    { key: 'siguiente', label: 'Proximos pasos' },
  ];

  let chart = null;
  let selectedWeek = '';
  let wired = false;

  const api = () => CONFIG.data() || null;
  // Un tablero con sub-marcas (ExcambiareData.brandLabel) nombra en la portada la que se esta viendo.
  const brandName = () => (api()?.brandLabel ? `${CONFIG.brand} · ${api().brandLabel()}` : CONFIG.brand);
  const brandSlug = () => (api()?.brandLabel ? `${CONFIG.slug}-${api().brandLabel().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-')}` : CONFIG.slug);

  // ── Semanas en hora de Lima ────────────────────────────────────────────
  const pad = value => String(value).padStart(2, '0');
  const isoOf = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

  function todayIso() {
    const { year, month, day } = api().limaParts(new Date());
    return isoOf(year, month + 1, day);
  }

  function shiftDays(day, amount) {
    const moved = new Date(Date.parse(`${day}T00:00:00Z`) + amount * 86400000);
    return isoOf(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
  }

  // Lunes de la semana de ese dia (getUTCDay: 0 es domingo, de ahi el +6 % 7).
  function mondayOf(day) {
    return shiftDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
  }

  function dayLabel(day) {
    const [, month, date] = day.split('-').map(Number);
    return `${date} ${api().SHORT_MONTHS[month - 1].toLowerCase()}`;
  }

  // "29 sep – 5 oct 2026"; dentro del mismo mes, "6 – 12 oct 2026".
  function rangeLabel(monday) {
    const sunday = shiftDays(monday, 6);
    const startMonth = Number(monday.split('-')[1]);
    const [endYear, endMonth] = sunday.split('-').map(Number);
    const start = startMonth === endMonth ? String(Number(monday.split('-')[2])) : dayLabel(monday);
    return `${start} – ${dayLabel(sunday)} ${endYear}`;
  }

  function fileLabel(monday) {
    const sunday = shiftDays(monday, 6);
    const short = day => `${Number(day.split('-')[2])}${api().SHORT_MONTHS[Number(day.split('-')[1]) - 1]}`;
    return `${short(monday)}-${short(sunday)}${sunday.split('-')[0]}`;
  }

  // ── Filas del barrido ──────────────────────────────────────────────────
  // Las filas ya normalizadas del tablero: una por dia, campaña, conjunto y anuncio.
  function allRows() {
    const months = api()?.snapshot()?.months || [];
    return months.filter(month => !month.error).flatMap(month => month.rows || []);
  }

  // Que mide esta marca. Con columna de conversaciones ("conversations" o "messages") ese es el numero
  // del reporte. Sin ella queda "results", que NO se puede sumar entre objetivos: una cuenta mezcla
  // ThruPlays, interacciones y contactos. En ese caso manda el tipo de resultado con mas inversion y los
  // demas van en el desglose.
  function conversionField(rows) {
    return CONFIG.conversionFields.find(field => field !== 'results' && rows.some(row => Number(row[field]) > 0)) || 'results';
  }

  // Tipos de resultado de unas filas, con su inversion y su costo, de mayor a menor inversion.
  function resultTypes(rows) {
    const types = new Map();
    rows.forEach(row => {
      const name = String(row.resultType || '').trim();
      if (!name) return;
      const type = types.get(name) || { name, results: 0, spend: 0 };
      type.results += Number(row.results) || 0;
      type.spend += Number(row.spend) || 0;
      types.set(name, type);
    });
    return [...types.values()]
      .filter(type => type.results > 0 || type.spend > 0)
      .map(type => ({ ...type, spend: Math.round(type.spend * 100) / 100, cost: type.results > 0 ? type.spend / type.results : null }))
      .sort((left, right) => right.spend - left.spend || right.results - left.results);
  }

  // El numero que encabeza el reporte y la etiqueta con la que se llama.
  function headline(rows, field) {
    if (field !== 'results') return { label: 'Conversaciones', value: rows.reduce((total, row) => total + (Number(row[field]) || 0), 0), spend: null };
    const main = resultTypes(rows)[0];
    return main ? { label: main.name, value: main.results, spend: main.spend } : { label: 'Resultados', value: 0, spend: 0 };
  }

  const activity = row => Number(row.spend) > 0 || Number(row.impressions) > 0;

  function totals(rows, field) {
    const sum = {};
    SUM_FIELDS.forEach(name => { sum[name] = rows.reduce((total, row) => total + (Number(row[name]) || 0), 0); });
    sum.spend = Math.round(sum.spend * 100) / 100;
    const main = headline(rows, field);
    sum.conversionLabel = main.label;
    sum.conversions = main.value;
    // Con varios tipos de resultado el costo es el del tipo que encabeza, no el gasto de toda la cuenta.
    const conversionSpend = main.spend == null ? sum.spend : main.spend;
    sum.costPerConversion = sum.conversions > 0 ? conversionSpend / sum.conversions : null;
    sum.types = resultTypes(rows);
    sum.cpm = sum.impressions > 0 ? (sum.spend / sum.impressions) * 1000 : null;
    sum.cpc = sum.clicks > 0 ? sum.spend / sum.clicks : null;
    sum.ctr = sum.impressions > 0 ? (sum.clicks / sum.impressions) * 100 : null;
    sum.frequency = sum.reach > 0 ? sum.impressions / sum.reach : null;
    sum.days = new Set(rows.filter(activity).map(row => row.day)).size;
    return sum;
  }

  function groupBy(rows, field, keyOf, nameOf) {
    const groups = new Map();
    rows.forEach(row => {
      const key = keyOf(row);
      if (!groups.has(key)) groups.set(key, { name: nameOf(row), rows: [], preview: '' });
      const group = groups.get(key);
      group.rows.push(row);
      if (!group.preview && /^https:\/\//.test(row.preview || '')) group.preview = row.preview;
    });
    return [...groups.values()]
      .map(group => ({ ...group, ...totals(group.rows, field) }))
      .filter(group => group.spend > 0 || group.conversions > 0)
      .sort((left, right) => right.conversions - left.conversions || right.spend - left.spend);
  }

  // Semanas cerradas con actividad, de la mas reciente a la mas antigua. La semana en curso no se lista:
  // el reporte es de lunes a domingo completo.
  function weeks() {
    const currentMonday = mondayOf(todayIso());
    const byWeek = new Map();
    allRows().forEach(row => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day || '')) return;
      const monday = mondayOf(row.day);
      if (monday >= currentMonday) return;
      if (!byWeek.has(monday)) byWeek.set(monday, []);
      byWeek.get(monday).push(row);
    });
    return [...byWeek.entries()]
      .filter(([, rows]) => rows.some(activity))
      .sort((left, right) => right[0].localeCompare(left[0]))
      .slice(0, WEEKS_IN_LIST)
      .map(([monday, rows]) => ({ monday, rows }));
  }

  // ── El reporte que se toma como modelo ─────────────────────────────────
  // El ultimo PDF de la carpeta Reportes: el orden de las secciones de abajo es el suyo.
  function modelReport() {
    const files = (api()?.snapshot()?.reports?.files || [])
      .filter(file => file.mimeType === 'application/pdf')
      .sort((left, right) => String(right.modifiedTime || '').localeCompare(String(left.modifiedTime || '')));
    // Gana el ultimo que se llame como un reporte; si la carpeta usa otros nombres, el PDF mas reciente.
    return files.find(file => /reporte|meta.?ads/i.test(file.title || '')) || files[0] || null;
  }

  // ── Conclusiones ───────────────────────────────────────────────────────
  function readNotes() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(CONFIG.notesKey) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch {
      return {};
    }
  }

  function saveNote(monday, key, value) {
    const notes = readNotes();
    notes[monday] = { ...(notes[monday] || {}), [key]: value };
    try {
      window.localStorage.setItem(CONFIG.notesKey, JSON.stringify(notes));
    } catch {
      // Sin localStorage el texto dura hasta recargar; el PDF se descarga igual.
    }
  }

  // Lo que se puede afirmar con el barrido: el resto lo escribe el equipo encima.
  function suggestedNotes(report) {
    const { fmt, metrics } = api();
    const best = report.ads[0];
    const cheapest = [...report.ads].filter(ad => ad.costPerConversion != null).sort((a, b) => a.costPerConversion - b.costPerConversion)[0];
    const audience = [...report.audiences].filter(group => group.costPerConversion != null).sort((a, b) => a.costPerConversion - b.costPerConversion)[0];
    const variation = metrics.change(report.week.conversions, report.previous?.conversions);
    const quiet = report.series.filter(day => day.hasData && day.conversions === 0).length;

    const logro = [
      best ? `«${best.name}» fue el anuncio con mas ${report.measuresConversions ? 'conversaciones' : 'resultados'} (${fmt.count(best.conversions)} con ${fmt.money(best.spend)})` : '',
      cheapest && cheapest !== best ? `el costo mas bajo lo dio «${cheapest.name}» (${fmt.unitCost(cheapest.costPerConversion)} por ${report.measuresConversions ? 'conversacion' : 'resultado'})` : '',
      audience ? `el publico mas eficiente fue ${audience.name} (${fmt.unitCost(audience.costPerConversion)})` : '',
    ].filter(Boolean).join('; ');

    const alerta = [
      variation != null ? `${report.measuresConversions ? 'Las conversaciones' : 'Los resultados'} ${variation >= 0 ? 'subieron' : 'bajaron'} ${fmt.pct(Math.abs(variation))} contra la semana anterior` : 'No hay semana anterior con datos para comparar',
      quiet ? `${quiet} ${quiet === 1 ? 'dia' : 'dias'} de la semana sin ${report.measuresConversions ? 'conversaciones' : 'resultados'}` : '',
      report.missingDays.length ? `faltan los dias ${report.missingDays.map(dayLabel).join(', ')} en la descarga de Meta` : '',
    ].filter(Boolean).join('; ');

    return { logro: logro ? `${logro}.` : '', alerta: alerta ? `${alerta}.` : '', siguiente: '' };
  }

  // ── Armado del reporte de una semana ───────────────────────────────────
  function buildReport(monday, rows) {
    const previousMonday = shiftDays(monday, -7);
    const rowsAll = allRows();
    const field = conversionField(rowsAll);
    const previousRows = rowsAll.filter(row => row.day >= previousMonday && row.day < monday);
    const week = totals(rows, field);
    const previous = previousRows.length ? totals(previousRows, field) : null;

    const series = Array.from({ length: 7 }, (_, index) => {
      const day = shiftDays(monday, index);
      const dayRows = rows.filter(row => row.day === day);
      return { day, label: dayLabel(day), conversions: totals(dayRows, field).conversions, spend: totals(dayRows, field).spend, hasData: dayRows.length > 0 };
    });

    // Un dia sin filas que ademas esta despues del ultimo dia del barrido: la descarga del mes todavia no
    // llega hasta ahi, asi que el total puede subir. Se avisa en vez de darlo por cerrado.
    const dataEnd = api()?.snapshot()?.dataEnd || rowsAll.map(row => row.day).sort().pop() || '';
    const missingDays = series.filter(day => !day.hasData && day.day > dataEnd).map(day => day.day);

    return {
      monday,
      week,
      previous,
      series,
      measuresConversions: field !== 'results',
      missingDays,
      dataEnd,
      ads: groupBy(rows, field, row => `${row.adSet}\u0000${row.ad}`, row => (row.adSet ? `${row.ad} · ${row.adSet}` : row.ad)),
      audiences: groupBy(rows, field, row => row.adSet || 'Sin conjunto', row => row.adSet || 'Sin conjunto'),
      campaigns: groupBy(rows, field, row => row.campaign, row => row.campaign),
    };
  }

  // ── Pintado ────────────────────────────────────────────────────────────
  const kpiHtml = (label, value, note) => `<div class="kpi-pill"><span>${api().esc(label)}</span><strong>${value}</strong>${note ? `<small>${api().esc(note)}</small>` : ''}</div>`;

  function deltaNote(current, before, unit) {
    const { fmt, metrics } = api();
    const variation = metrics.change(current, before);
    // change() no compara contra cero: se dice cual era el numero en vez de callarlo.
    if (variation == null) return before == null ? 'Sin semana anterior' : `vs ${unit === 'count' ? fmt.count(before) : fmt.money(before)} la semana anterior`;
    const previous = unit === 'money' ? fmt.money(before) : unit === 'cost' ? fmt.unitCost(before) : fmt.count(before);
    return `${variation >= 0 ? '+' : '-'}${fmt.pct(Math.abs(variation))} vs ${previous}`;
  }

  function tableHtml(groups, { nameHead, withPreview, highlight, typeColumn, label }) {
    const { esc, safeUrl, fmt } = api();
    if (!groups.length) return '<div class="empty-state"><strong>Sin datos</strong><span>La semana no tiene entregas en la descarga de Meta.</span></div>';
    const best = groups[0];
    const rows = groups.map(group => `
      <tr>
        <td class="campaign-name">${esc(group.name)}${highlight && group === best && group.conversions > 0 ? ' <span class="week-best">Mejor anuncio</span>' : ''}</td>
        ${typeColumn ? `<td class="ad-name-col">${esc(group.conversionLabel)}</td>` : ''}
        <td class="num">${fmt.money(group.spend)}</td>
        <td class="num">${fmt.count(group.conversions)}</td>
        <td class="num">${fmt.unitCost(group.costPerConversion)}</td>
        <td class="num">${fmt.money(group.cpm)}</td>
        <td class="num">${fmt.count(group.reach)}</td>
        <td class="num">${fmt.decimal(group.frequency)}</td>
        ${withPreview ? `<td>${group.preview ? `<a class="report-btn" href="${safeUrl(group.preview)}" target="_blank" rel="noopener">Ver</a>` : '<span class="no-data">Sin enlace</span>'}</td>` : ''}
      </tr>`).join('');
    return `
      <div class="table-scroll">
        <table class="data-table">
          <thead><tr><th>${esc(nameHead)}</th>${typeColumn ? '<th>Resultado</th>' : ''}<th class="num">Inversion</th><th class="num">${esc(label)}</th><th class="num">Costo x resultado</th><th class="num">CPM</th><th class="num">Alcance</th><th class="num">Frec.</th>${withPreview ? '<th>Vista previa</th>' : ''}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }

  function notesHtml(report) {
    const { esc } = api();
    const saved = readNotes()[report.monday] || {};
    const suggested = suggestedNotes(report);
    return NOTE_FIELDS.map((field, index) => {
      const value = saved[field.key] != null ? saved[field.key] : suggested[field.key];
      return `
        <label class="week-note" for="week-note-${field.key}">
          <span class="week-note-head"><b>0${index + 1}</b> ${esc(field.label)}</span>
          <textarea id="week-note-${field.key}" data-week-note="${field.key}" rows="3" placeholder="Escribe la conclusion que va en el reporte">${esc(value)}</textarea>
        </label>`;
    }).join('');
  }

  function renderChart(report) {
    const canvas = document.getElementById('week-chart');
    if (!canvas || typeof window.Chart !== 'function') return;
    const { fmt } = api();
    // El color de la marca sale del CSS (--brand): el canvas no entiende var().
    const brandColor = getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || '#b91c1c';
    chart?.destroy();
    chart = new window.Chart(canvas, {
      data: {
        labels: report.series.map(day => day.label),
        datasets: [
          { type: 'bar', label: report.week.conversionLabel, data: report.series.map(day => day.conversions), backgroundColor: brandColor, borderRadius: 4, yAxisID: 'y' },
          { type: 'line', label: 'Inversion', data: report.series.map(day => day.spend), borderColor: '#2563eb', backgroundColor: '#2563eb', borderWidth: 2, tension: .3, pointRadius: 3, yAxisID: 'y1' },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: context => ` ${context.dataset.label}: ${context.dataset.yAxisID === 'y1' ? fmt.money(context.raw) : fmt.count(context.raw)}` } },
        },
        scales: {
          x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#7890b5', font: { size: 10 } } },
          y: { beginAtZero: true, grid: { color: '#eef2f7' }, border: { display: false }, ticks: { color: '#7890b5', font: { size: 10 }, precision: 0 } },
          y1: { beginAtZero: true, position: 'right', grid: { display: false }, border: { display: false }, ticks: { color: '#7890b5', font: { size: 10 }, callback: value => `${api().CURRENCY || 'S/'} ${value}` } },
        },
      },
    });
  }

  function render() {
    const host = document.getElementById('week-report');
    if (!host || !api()) return;
    const { esc, fmt } = api();

    const available = weeks();
    const select = document.getElementById('week-select');
    if (!available.length) {
      if (select) select.innerHTML = '<option value="">Sin semanas cerradas</option>';
      host.innerHTML = '<div class="panel"><div class="empty-state"><strong>Todavia no hay una semana cerrada con datos</strong><span>El reporte se arma con las descargas de Meta Ads de la carpeta de Drive. En cuanto haya una semana de lunes a domingo con entregas, aparece aqui.</span></div></div>';
      return;
    }

    if (!available.some(week => week.monday === selectedWeek)) selectedWeek = available[0].monday;
    const current = available.find(week => week.monday === selectedWeek);
    const report = buildReport(current.monday, current.rows);
    const model = modelReport();
    const isLast = current.monday === available[0].monday;

    if (select) {
      select.innerHTML = available
        .map((week, index) => `<option value="${week.monday}"${week.monday === selectedWeek ? ' selected' : ''}>${esc(rangeLabel(week.monday))}${index === 0 ? ' · semana que acaba de pasar' : ''}</option>`)
        .join('');
    }

    const modelHost = document.getElementById('week-model');
    if (modelHost) {
      modelHost.innerHTML = model
        ? `Modelo: <a href="https://drive.google.com/file/d/${esc(model.id)}/view" target="_blank" rel="noopener">${esc(model.title)}</a>`
        : 'Modelo: el ultimo reporte de la carpeta Reportes de Drive';
    }

    const week = report.week;
    const previous = report.previous || {};
    host.innerHTML = `
      <div class="week-doc" id="week-doc">
        <div class="panel week-cover">
          <div>
            <div class="week-cover-brand">Lima Retail · Data Driven Marketing</div>
            <div class="week-cover-title">Reporte de Publicidad · ${esc(brandName())}</div>
            <div class="week-cover-period">${esc(rangeLabel(report.monday))} · Meta Ads · lunes a domingo</div>
          </div>
          <div class="week-cover-meta">
            <span>${isLast ? 'Semana que acaba de pasar' : 'Semana cerrada'}</span>
            <b>${esc(rangeLabel(report.monday))}</b>
            <span>${week.days} ${week.days === 1 ? 'dia' : 'dias'} con entrega</span>
          </div>
        </div>

        ${report.missingDays.length ? `<div class="week-warning">La descarga de Meta llega hasta el ${esc(dayLabel(report.dataEnd))}: ${esc(report.missingDays.map(dayLabel).join(', '))} todavia no estan en la hoja del mes, asi que los totales pueden subir.</div>` : ''}

        <h2 class="week-h2">01 · Resumen del periodo</h2>
        <div class="kpi-strip week-kpis">
          ${kpiHtml('Inversion', fmt.money(week.spend), deltaNote(week.spend, previous.spend, 'money'))}
          ${kpiHtml(week.conversionLabel, fmt.count(week.conversions), deltaNote(week.conversions, previous.conversions, 'count'))}
          ${kpiHtml(`Costo x ${report.measuresConversions ? 'conversacion' : 'resultado'}`, fmt.unitCost(week.costPerConversion), deltaNote(week.costPerConversion, previous.costPerConversion, 'cost'))}
          ${kpiHtml('Alcance', fmt.count(week.reach), `Frecuencia ${fmt.decimal(week.frequency)}`)}
          ${kpiHtml('Impresiones', fmt.count(week.impressions), `CPM ${fmt.money(week.cpm)}`)}
          ${kpiHtml('Clics', fmt.count(week.clicks), `CTR ${fmt.pct(week.ctr)} · CPC ${fmt.unitCost(week.cpc)}`)}
        </div>

        ${report.week.types.length > 1 ? `
        <div class="panel week-types">
          <div class="panel-head"><div><div class="panel-title">Resultados por tipo</div><div class="panel-sub">Cada objetivo mide su propio resultado, asi que no se suman entre si. ${report.measuresConversions ? 'Arriba manda el total de conversaciones.' : 'Arriba manda el tipo con mas inversion.'}</div></div></div>
          <div class="table-scroll">
            <table class="data-table">
              <thead><tr><th>Tipo de resultado</th><th class="num">Inversion</th><th class="num">Resultados</th><th class="num">Costo x resultado</th></tr></thead>
              <tbody>${report.week.types.map(type => `<tr><td class="campaign-name">${esc(type.name)}</td><td class="num">${fmt.money(type.spend)}</td><td class="num">${fmt.count(type.results)}</td><td class="num">${fmt.unitCost(type.cost)}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>` : ''}

        <div class="panel week-chart-panel">
          <div class="panel-head">
            <div>
              <div class="panel-title">${esc(week.conversionLabel)} por dia</div>
              <div class="panel-sub">Barras: ${esc(week.conversionLabel.toLowerCase())}. Linea: inversion del dia.</div>
            </div>
          </div>
          <div class="chart-wrap h-260"><canvas id="week-chart" role="img" aria-label="Conversaciones e inversion por dia de la semana"></canvas></div>
          <div class="chart-legend"><span><i class="legend-dot brand"></i><b>${esc(week.conversionLabel)}</b></span> <span><i class="legend-line"></i><b>Inversion</b></span></div>
        </div>

        <h2 class="week-h2">02 · Mejores anuncios</h2>
        <div class="panel">${tableHtml(report.ads, { nameHead: 'Anuncio · conjunto', withPreview: true, highlight: true, typeColumn: !report.measuresConversions, label: report.measuresConversions ? 'Conversaciones' : 'Resultados' })}</div>

        <h2 class="week-h2">03 · Conjuntos y campañas</h2>
        <div class="panel">
          <div class="panel-head"><div><div class="panel-title">Por conjunto de anuncios (publico)</div><div class="panel-sub">Donde se concentraron las conversaciones de la semana.</div></div></div>
          ${tableHtml(report.audiences, { nameHead: 'Conjunto', withPreview: false, typeColumn: !report.measuresConversions, label: report.measuresConversions ? 'Conversaciones' : 'Resultados' })}
        </div>
        <div class="panel week-campaigns">
          <div class="panel-head"><div><div class="panel-title">Por campaña</div><div class="panel-sub">La descarga de Meta suma edad y sexo, asi que el reporte no desglosa por edad ni genero.</div></div></div>
          ${tableHtml(report.campaigns, { nameHead: 'Campaña', withPreview: false, typeColumn: !report.measuresConversions, label: report.measuresConversions ? 'Conversaciones' : 'Resultados' })}
        </div>

        <h2 class="week-h2">04 · Conclusiones y proximos pasos</h2>
        <div class="panel week-notes-panel">
          <div class="panel-head"><div><div class="panel-title">Lo que va en el reporte</div><div class="panel-sub">Los dos primeros textos vienen propuestos con lo que dice la semana. Se editan aqui y quedan guardados en este navegador.</div></div></div>
          <div class="week-notes">${notesHtml(report)}</div>
        </div>

        <div class="week-foot">Fuente: descargas de Meta Ads de ${esc(brandName())} · ${esc(rangeLabel(report.monday))} · Lima Retail</div>
      </div>`;

    renderChart(report);

    host.querySelectorAll('[data-week-note]').forEach(field => {
      field.addEventListener('input', () => saveNote(report.monday, field.dataset.weekNote, field.value));
    });
  }

  // El nombre del PDF lo pone el navegador con el titulo del documento: se cambia solo mientras imprime.
  function printReport() {
    if (!selectedWeek) return;
    const title = document.title;
    document.title = `Reporte_${brandSlug()}_${fileLabel(selectedWeek)}`;
    const restore = () => { document.title = title; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    window.print();
    window.setTimeout(restore, 2000);
  }

  function init() {
    render();
    if (wired) return;
    wired = true;
    document.getElementById('week-select')?.addEventListener('change', event => {
      selectedWeek = event.target.value;
      render();
    });
    document.getElementById('week-print')?.addEventListener('click', printReport);
    // El barrido se relee al abrir el tablero y con Actualizar: si la semana cambia, el reporte se repinta.
    window.addEventListener(CONFIG.updatedEvent, () => {
      if (document.getElementById('view-week')?.classList.contains('visible')) render();
    });
  }

  window.ReporteSemanal = { init };
})();
