(function () {
  // Modulos Gasto publicitario, Anuncios y el Historico de Campanas: indicadores del reporte de Ads calculados con
  // las descargas de Meta que entrega window.TPData (js/data-source.js).
  const TABLE_COMPACT_KEY = 'tp-campaigns-compact-v1';
  // Vistas que comparten el mes elegido (Gasto publicitario y Anuncios).
  const PERIOD_VIEWS = ['view-obj', 'view-ads'];
  // El barrido no trae compras: el Top 3 de Anuncios es por contactos de WhatsApp (clics al boton en Pedidos
  // WhatsApp y conversaciones en Mensajes WhatsApp).
  const TOP_GROUPS = ['pedidos-whatsapp', 'mensajes-whatsapp'];
  // Indicadores, vista, un solo cuadro y minimizado del grafico de cada campana, por clave de objetivo.
  const CAMPAIGN_CHARTS_KEY = 'tp-campaign-charts-v1';
  const PREVIOUS_COLOR = '#94a3b8';
  const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>';
  // Pestana "Anual" junto a las de mes: acumula todos los meses del año con descarga.
  const YEAR_KEY = 'anual';
  // Pestana "Todos" del Historico de Campanas: todas las descargas, sin filtrar por mes.
  const HISTORY_ALL = 'todos';
  // Filtro por estado del Historico. Activa = con gasto o impresiones el ultimo dia con datos.
  const HISTORY_STATUS = [
    { key: 'todas', label: 'Todas', one: 'campaña', many: 'campañas' },
    { key: 'activas', label: 'Activas', one: 'campaña activa', many: 'campañas activas' },
    { key: 'finalizadas', label: 'Finalizadas', one: 'campaña finalizada', many: 'campañas finalizadas' },
  ];
  // Sin "Acumulado del mes": un total corrido siempre sube y hace ver un crecimiento que no hay.
  const MODES = [
    { key: 'daily', label: 'Por día' },
    { key: 'monthly', label: 'Por mes' },
  ];
  // Indicadores del grafico de cada campana (Resultados toma el nombre del resultado del objetivo). Se puede elegir
  // mas de uno; por defecto va el resultado junto a la inversion, que es la relacion que se quiere leer.
  // color: el de su linea cuando los indicadores van juntos en un solo cuadro (el resultado lleva el del objetivo).
  const CAMPAIGN_METRICS = [
    { key: 'results', label: 'Resultados', field: 'results', unit: 'count' },
    { key: 'spend', label: 'Inversión', field: 'spend', unit: 'money', color: '#334155' },
    { key: 'impressions', label: 'Impresiones', field: 'impressions', unit: 'count', color: '#0891b2' },
    { key: 'reach', label: 'Alcance', field: 'reach', unit: 'count', color: '#b45309' },
    // Cociente: inversion / resultados del dia o del mes; sin resultados queda como hueco.
    { key: 'costPerResult', label: 'Costo por resultado', ratio: ['spend', 'results'], unit: 'money', color: '#be123c' },
  ];
  // En un solo cuadro, un indicador cuyo color coincide con el del objetivo toma este.
  const COMBINED_ALT_COLOR = '#64748b';
  const DEFAULT_CAMPAIGN_METRICS = ['results', 'spend'];
  // KPIs de la cabecera de cada campana, con su variacion contra el mes anterior.
  const CAMPAIGN_KPIS = [
    { key: 'results', label: null, format: 'count', better: 'up' },
    { key: 'spend', label: 'Inversión', format: 'money', better: null },
    { key: 'costPerResult', label: 'Costo por resultado', format: 'unitCost', better: 'down' },
    { key: 'reach', label: 'Alcance', format: 'count', better: 'up' },
    { key: 'impressions', label: 'Impresiones', format: 'count', better: 'up' },
    { key: 'cpm', label: 'CPM', format: 'money', better: 'down' },
  ];
  // Indicadores del resumen ejecutivo del reporte. better: hacia donde una variacion es buena (null = neutra).
  // perMonth: en la vista anual se muestra su promedio mensual (los cocientes llevan su descripcion).
  const KPIS = [
    { key: 'spend', label: 'Inversión', hint: 'Importe gastado', better: null, format: 'money', perMonth: true },
    { key: 'impressions', label: 'Impresiones', hint: 'Veces que se mostraron los anuncios', better: 'up', format: 'count', perMonth: true },
    { key: 'reach', label: 'Alcance', hint: 'Suma diaria por público, como en el reporte', better: 'up', format: 'count', perMonth: true },
    { key: 'frequency', label: 'Frecuencia', hint: 'Impresiones / alcance', better: null, format: 'decimal' },
    { key: 'cpm', label: 'CPM prom.', hint: 'Costo por mil impresiones', better: 'down', format: 'money' },
  ];

  const state = {
    monthKey: null,
    // Sube con cada cambio de mes; cada vista guarda la version que pinto y se repinta al abrirse si quedo atras.
    monthVersion: 0,
    rendered: Object.fromEntries(PERIOD_VIEWS.map(view => [view, -1])),
    // Año de las pestanas en la vista anual (con un mes elegido manda el año de ese mes).
    year: null,
    tableCompact: readSetting(TABLE_COMPACT_KEY, 'false') === 'true',
    tableFullscreen: false,
    adsObjective: 'all',
    historyMonth: HISTORY_ALL,
    // Año de las pestanas del Historico en "Todos" (con un mes elegido manda el año de ese mes).
    historyYear: null,
    historyStatus: 'todas',
    campaignCharts: readJson(CAMPAIGN_CHARTS_KEY),
    // Graficos de Chart.js vivos, uno por cuadro de campana (clave del objetivo).
    charts: new Map(),
    tabsHome: null,
    wired: false,
  };

  const data = () => window.TPData;
  const fmt = (kind, ...args) => data().fmt[kind](...args);
  const esc = value => data().esc(value);
  const hasActivity = item => data().metrics.hasActivity(item);

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

  function readJson(key) {
    try {
      const value = JSON.parse(readSetting(key, '{}'));
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  // Reemplaza el HTML de host sin sacar el foco del control que se estaba usando (pestana, chip o filtro).
  function replaceHtml(host, html) {
    data().keepFocus(host, () => { host.innerHTML = html; });
  }

  // Años con meses con datos, del mas antiguo al mas reciente. Con mas de uno las pestanas llevan encima los años.
  function dataYears(snapshot) {
    return [...new Set(snapshot.months.filter(month => month.hasData).map(month => month.year))];
  }

  // El año pedido si tiene meses con datos; si no, el del ultimo mes con datos.
  function validYear(snapshot, year) {
    return dataYears(snapshot).includes(year) ? year : snapshot.year;
  }

  function latestMonthOf(snapshot, year) {
    return snapshot.months.filter(month => month.hasData && month.year === year).pop() || null;
  }

  function selectedMonth() {
    const snapshot = data()?.snapshot();
    if (!snapshot) return null;
    const month = data().monthByKey(state.monthKey);
    return month && month.hasData ? month : data().latestMonth();
  }

  // Año de las pestanas de Gasto publicitario: el del mes elegido o, en la vista anual, el año elegido.
  function viewYear() {
    const snapshot = data().snapshot();
    if (state.monthKey === YEAR_KEY) return validYear(snapshot, state.year);
    return selectedMonth()?.year ?? snapshot.year;
  }

  function annualView() {
    return state.monthKey === YEAR_KEY && Boolean(data()?.metrics.yearPeriod(viewYear()));
  }

  function currentPeriod() {
    return annualView() ? data().metrics.yearPeriod(viewYear()) : data().metrics.period(selectedMonth());
  }

  // "▲ 12,3% vs 1-20 Agosto". El color depende de si subir es bueno para ese indicador. Sin compareLabel queda
  // solo "▲ 12,3%" (filas de KPIs cuyo subtitulo ya dice contra que periodo se compara).
  function deltaHtml(current, previous, better, compareLabel) {
    const change = data().metrics.change(current, previous);
    if (change == null) return compareLabel ? `<small class="delta flat">Sin dato en ${esc(compareLabel)}</small>` : '';
    const direction = Math.abs(change) < 0.05 ? 'flat' : change > 0 ? 'up' : 'down';
    const tone = direction === 'flat' || !better ? 'flat' : direction === better ? 'good' : 'bad';
    const arrow = direction === 'up' ? '&#9650;' : direction === 'down' ? '&#9660;' : '&#9679;';
    return `<small class="delta ${tone}">${arrow} ${fmt('pct', Math.abs(change))}${compareLabel ? ` vs ${esc(compareLabel)}` : ''}</small>`;
  }

  // Celda de variacion de una tabla con mes anterior: "Nuevo" si no corria (previous null), pastilla verde o roja si no.
  function variationCell(current, previous) {
    if (previous == null) return '<span class="delta-pill new">Nuevo</span>';
    const change = data().metrics.change(current, previous);
    if (change == null) return '<span class="no-data">—</span>';
    return `<span class="delta-pill ${change >= 0 ? 'good' : 'bad'}">${change >= 0 ? '&#9650;' : '&#9660;'} ${fmt('pct', Math.abs(change), 0)}</span>`;
  }

  // Nombre del anuncio con enlace a su vista previa en Meta (sin enlace queda el nombre solo).
  function adNameLink(ad) {
    const name = esc(ad.ad || '(sin nombre)');
    const url = data().safeUrl(ad.preview);
    return url
      ? `<a class="ad-link" href="${url}" target="_blank" rel="noopener noreferrer" title="Ver el anuncio en Meta">${name}<span class="ad-link-ic" aria-hidden="true">&#8599;</span></a>`
      : name;
  }

  // ── La pieza del anuncio ("06 Artes", del barrido) ───────────────────────
  // Misma clave que arteKey_() del Apps Script: sin extension, sin "(Carrusel)", sin tildes ni
  // signos. Solo hay pieza de algunos anuncios; el que no la tenga se dibuja igual, sin miniatura.
  const arteKey = name => String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s*\((carrusel|carousel)\)\s*$/i, '')
    .replace(/\.[A-Za-z0-9]{2,5}$/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');

  function arteDe(ad) {
    const piezas = data().snapshot()?.artes?.piezas;
    if (!piezas) return null;
    return piezas[arteKey(ad.ad)] || null;
  }

  // La miniatura la sirve Drive y la pide el navegador de quien mira el tablero: la carpeta de artes
  // esta compartida por enlace. Un video trae su fotograma, un carrusel su primera lamina.
  function arteThumb(ad) {
    const arte = arteDe(ad);
    if (!arte) return '';
    const id = arte.tipo === 'carrusel' ? (arte.laminas || [])[0] : arte.id;
    if (!id) return '';
    const etiqueta = arte.tipo === 'carrusel' ? 'Carrusel' : arte.tipo === 'video' ? 'Video' : 'Imagen';
    return `<img class="ad-thumb" src="https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&sz=w160"
      alt="" loading="lazy" title="${esc(arte.nombre)} · ${etiqueta}">`;
  }

  // Dias activos del anuncio: "3-18 Sep" en un mes, rango de fechas en la vista anual.
  function adDays(ad, period) {
    if (period.annual) {
      if (!ad.firstDate) return '—';
      return ad.firstDate === ad.lastDate ? shortDate(ad.firstDate, false) : `${shortDate(ad.firstDate, false)} - ${shortDate(ad.lastDate, false)}`;
    }
    if (!ad.firstDay) return '—';
    const monthShort = period.month?.shortName;
    return ad.firstDay === ad.lastDay ? `${ad.firstDay} ${monthShort}` : `${ad.firstDay}-${ad.lastDay} ${monthShort}`;
  }

  // ── Pestanas de mes y periodo ────────────────────────────────────────────
  // Enero a Diciembre del año dado y una ultima pestana que junta todos los meses (Anual aqui, Todos en el
  // Historico). Con descargas de mas de un año, encima van los años a todo el ancho de la grilla de pestanas.
  function monthTabsHtml(snapshot, year, selectedKey, last) {
    const years = dataYears(snapshot);
    const yearTabs = years.length > 1
      ? `<div class="year-tabs" role="group" aria-label="Año">${years.map(item => `<button type="button" class="month-tab ${item === year ? 'active' : ''}" data-year="${item}" aria-pressed="${item === year}">${item}</button>`).join('')}</div>`
      : '';
    return yearTabs + data().MONTHS.map((name, index) => {
      const key = `${year}-${String(index + 1).padStart(2, '0')}`;
      const month = data().monthByKey(key);
      const available = Boolean(month?.hasData);
      const selected = selectedKey === key;
      return `<button type="button" class="month-tab ${selected ? 'active' : ''}" data-month="${key}" aria-pressed="${selected}" ${available ? '' : 'disabled title="Sin descarga de Meta en la carpeta"'}>${name}${key === snapshot.latestKey ? '<span class="current-dot"></span>' : ''}</button>`;
    }).join('') + `<button type="button" class="month-tab ${last.selected ? 'active' : ''}" data-month="${last.key}" aria-pressed="${last.selected}" title="${esc(last.available ? last.title : 'Sin descargas de Meta en la carpeta')}"${last.available ? '' : ' disabled'}>${last.label}</button>`;
  }

  // Las pestanas de Gasto publicitario (month-tabs) y las de Anuncios (ads-month-tabs) muestran el mismo mes.
  function renderTabs(snapshot, hostId = 'month-tabs') {
    const host = document.getElementById(hostId);
    if (!host) return;
    const annual = annualView();
    const year = viewYear();
    replaceHtml(host, monthTabsHtml(snapshot, year, annual ? null : selectedMonth()?.key, {
      key: YEAR_KEY,
      label: 'Anual',
      title: `Acumulado ${year} de los meses con descarga de Meta`,
      available: Boolean(data().metrics.yearPeriod(year)),
      selected: annual,
    }));
  }

  // prefix '' es Gasto publicitario y 'ads-' es Anuncios (mismos textos salvo el subtitulo de la vista anual).
  function renderPeriod(period, prefix = '') {
    const title = document.getElementById(`${prefix}period-title`);
    const sub = document.getElementById(`${prefix}period-sub`);
    if (!title || !sub) return;
    if (!period) {
      title.textContent = 'Sin datos de Meta';
      sub.textContent = 'No hay descargas con gasto en la carpeta de Drive.';
      return;
    }
    if (period.annual) {
      const count = period.months.length;
      // Un año anterior al del ultimo mes con datos ya termino aunque falte la descarga completa de diciembre.
      const closed = period.closed || period.year < data().snapshot().year;
      title.textContent = `Periodo: ${period.label} ${period.year}${closed ? '' : ' (año en curso)'}`;
      sub.textContent = prefix
        ? 'Acumulado del año: sin periodo anterior para comparar'
        : `Acumulado de ${count} ${count === 1 ? 'mes' : 'meses'} con descarga de Meta (${period.months.map(month => month.shortName).join(', ')}). Sin año anterior para comparar.`;
      return;
    }
    const month = period.month;
    title.textContent = `Periodo: ${period.label} ${month.year}${period.closed ? '' : ' (mes en curso)'}`;
    // El archivo del mes y el aviso de descarga incompleta viven en el estado de la barra superior.
    sub.textContent = period.compare ? `Comparación vs ${period.compare.label}` : 'Sin mes anterior para comparar';
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
    const months = period.months.filter(month => month.rows.some(row => row.group === key && hasActivity(row)));
    if (months.length === period.months.length) return `Activo en los ${months.length} ${months.length === 1 ? 'mes' : 'meses'}`;
    return `Activo en ${months.map(month => month.shortName).join(', ') || 'ningún mes'}`;
  }

  // ── Graficos lineales ────────────────────────────────────────────────────
  // Los de cada cuadro de campana. metric: { key, label, field, unit, color, group }; group es el objetivo del
  // cuadro y limita las filas a las suyas.
  function metricFilter(metric) {
    return row => row.group === metric.group;
  }

  // Cociente del costo por resultado: sin resultados (o sin dato) queda como hueco.
  const ratioValue = (top, bottom) => (top == null || !(bottom > 0) ? null : top / bottom);

  // Un mes sin gasto ni impresiones del objetivo queda como hueco, igual que un mes sin descarga.
  function monthlyValue(month, metric) {
    if (!month?.hasData) return null;
    const rows = month.rows.filter(metricFilter(metric));
    if (!rows.some(hasActivity)) return null;
    const sum = field => rows.reduce((total, row) => total + row[field], 0);
    return metric.ratio ? ratioValue(...metric.ratio.map(sum)) : sum(metric.field);
  }

  // Valores por dia del indicador (indice 0 = dia 1); el costo por resultado sale de la inversion y los resultados
  // de cada dia.
  function dailyMetric(month, metric) {
    const values = field => data().metrics.dailyValues(month, field, metricFilter(metric));
    if (!metric.ratio) return values(metric.field);
    const [top, bottom] = metric.ratio.map(values);
    return top.map((value, index) => ratioValue(value, bottom[index]));
  }

  // Total de cada mes del año, o dia a dia del mes frente al mes anterior en el mismo dia. compare = false deja
  // solo el mes elegido (varios indicadores a la vez). Cada punto del mes elegido lleva su valor (valueLabels).
  function lineSeries(metric, modeKey, month, compare = true) {
    if (modeKey === 'monthly') {
      const year = viewYear();
      return {
        labels: data().SHORT_MONTHS,
        datasets: [{ label: metric.label, unit: metric.unit, data: data().MONTHS.map((_, index) => monthlyValue(data().monthByKey(`${year}-${String(index + 1).padStart(2, '0')}`), metric)), borderColor: metric.color, backgroundColor: `${metric.color}1a`, fill: true, borderWidth: 2.5, pointRadius: 5, pointHoverRadius: 7, pointBackgroundColor: metric.color, tension: 0.25, spanGaps: false, valueLabels: true }],
        legend: [`<span><i class="legend-line" style="background:${metric.color}"></i><b>${esc(metric.label)} por mes</b></span>`],
      };
    }
    const series = {
      labels: Array.from({ length: month.daysInMonth }, (_, index) => `${index + 1}`),
      datasets: [{ label: compare ? month.name : metric.label, unit: metric.unit, data: dailyMetric(month, metric), borderColor: metric.color, backgroundColor: `${metric.color}14`, fill: false, borderWidth: 2.5, pointRadius: 2, pointHoverRadius: 4, pointBackgroundColor: metric.color, tension: 0.2, spanGaps: false, valueLabels: true }],
      legend: [`<span><i class="legend-line" style="background:${metric.color}"></i><b>${esc(month.name)} ${month.year}</b></span>`],
    };
    const previous = data().previousMonth(month);
    if (compare && previous?.hasData) {
      const previousValues = dailyMetric(previous, metric).slice(0, month.daysInMonth);
      if (previousValues.some(value => value)) {
        series.datasets.push({ label: previous.name, unit: metric.unit, data: previousValues, borderColor: PREVIOUS_COLOR, borderDash: [6, 5], fill: false, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.2 });
        series.legend.push(`<span><i class="legend-line dashed" style="color:${PREVIOUS_COLOR}"></i><b>${esc(previous.name)} (mismo día del mes)</b></span>`);
      }
    }
    return series;
  }

  // Un indicador: su linea contra el mes anterior. Varios: una linea por indicador, sin comparacion, cada una en su
  // propio panel (eje y) para ver como se mueve el resultado frente a la inversion sin mezclar escalas. Con combined,
  // todas en un solo cuadro, un color por indicador y cada una con su escala (sin eje: el valor va en el punto).
  function campaignSeries(metrics, modeKey, month, combined = false) {
    if (metrics.length === 1) return lineSeries(metrics[0], modeKey, month);
    const parts = metrics.map(metric => lineSeries(metric, modeKey, month, false));
    if (combined) {
      const what = modeKey === 'monthly' ? 'Por mes' : `Por día, ${esc(month.name)} ${month.year}`;
      return {
        labels: parts[0].labels,
        datasets: parts.map((part, index) => {
          const color = metrics[index].combinedColor;
          return { ...part.datasets[0], label: metrics[index].label, yAxisID: `y${index}`, borderColor: color, pointBackgroundColor: color, fill: false };
        }),
        legend: metrics.map(metric => `<span><i class="legend-line" style="background:${metric.combinedColor}"></i><b>${esc(metric.label)}</b></span>`)
          .concat(`<span>${what}. Cada indicador con su escala: compara la forma y lee el valor en el punto.</span>`),
      };
    }
    const color = metrics[0].color;
    const what = modeKey === 'monthly' ? `${metrics.length} indicadores por mes` : `${esc(month.name)} ${month.year}`;
    const previous = modeKey === 'monthly' ? null : data().previousMonth(month);
    return {
      labels: parts[0].labels,
      datasets: parts.map((part, index) => ({ ...part.datasets[0], label: metrics[index].label, yAxisID: `y${index}` })),
      legend: [
        `<span><i class="legend-line" style="background:${color}"></i><b>${what}</b></span>`,
        `<span>Cada indicador con su escala.${previous?.hasData ? ` Elige uno solo para compararlo con ${esc(previous.name)}.` : ''}</span>`,
      ],
    };
  }

  function destroyChart(id) {
    state.charts.get(id)?.destroy();
    state.charts.delete(id);
  }

  // El costo por resultado de branding son centavos: unitCost les da mas decimales (en lo demas es igual a money).
  const formatValue = (unit, value) => (unit === 'money' ? fmt('unitCost', value) : fmt('count', value));
  // Etiqueta del punto: soles sin decimales, salvo montos chicos (S/. 0.40 no debe leerse S/. 0).
  const pointValue = (unit, value) => (unit === 'money'
    ? (Math.abs(value) >= 10 ? tickValue('money', Math.round(value)) : fmt('unitCost', value))
    : Number(value).toLocaleString('es-PE', { notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }));
  // Ejes en soles enteros; por debajo de 10 (el costo por resultado de branding son centavos) van con decimales para
  // que las marcas no se repitan.
  const tickValue = (unit, value) => (unit === 'money'
    ? (value === 0 ? 'S/. 0' : `S/. ${Number(value).toLocaleString('es-PE', { maximumFractionDigits: Math.abs(value) >= 10 ? 0 : Math.abs(value) >= 1 ? 2 : 3 })}`)
    : Number(value).toLocaleString('es-PE', { notation: Math.abs(value) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 1 }));

  // Con un indicador hay un solo eje y; con varios, un eje por indicador apilado en vertical (paneles con su
  // escala) sobre el mismo eje de dias. Nunca dos escalas a la vista sobre las mismas lineas: los cruces entre lineas
  // no significarian nada. En un solo cuadro (combined) cada indicador tiene su escala sin eje visible: se compara la
  // forma de las lineas y el valor va en cada punto.
  function yScales(metrics, combined = false) {
    const base = unit => ({ beginAtZero: true, border: { display: false }, ticks: { color: '#94A3B8', font: { size: 10 }, callback: value => tickValue(unit, value) } });
    if (metrics.length === 1) return { y: { ...base(metrics[0].unit), grid: { color: 'rgba(15,23,42,.06)' } } };
    if (combined) return Object.fromEntries(metrics.map((metric, index) => [`y${index}`, { display: false, beginAtZero: true, grace: '18%' }]));
    // Chart.js apila de abajo hacia arriba en el orden de los ejes: se dan al reves para que el resultado quede arriba.
    return Object.fromEntries(metrics.map((metric, index) => [`y${index}`, {
      ...base(metric.unit),
      stack: 'metrics',
      stackWeight: 1,
      grace: '25%',
      // El tope de cada panel cae sobre el cero del panel de arriba: se omite para que no se encimen.
      ticks: { ...base(metric.unit).ticks, maxTicksLimit: 5, callback: (value, tickIndex, ticks) => (index > 0 && tickIndex === ticks.length - 1 ? '' : tickValue(metric.unit, value)) },
      // La linea del cero marca el piso de cada panel.
      grid: { color: context => (context.tick?.value === 0 ? '#cbd5e1' : 'rgba(15,23,42,.06)') },
      panelLabel: metric.label,
    }]).reverse());
  }

  function drawLineChart(id, canvas, series, metrics, modeKey, combined = false) {
    destroyChart(id);
    if (!canvas) return;
    if (typeof Chart === 'undefined') {
      canvas.parentElement.innerHTML = '<div class="empty-state"><strong>Gráfico no disponible sin conexión.</strong><span>Los indicadores y las tablas siguen visibles.</span></div>';
      return;
    }
    state.charts.set(id, new Chart(canvas, {
      type: 'line',
      data: { labels: series.labels, datasets: series.datasets },
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
              title: items => (modeKey === 'monthly' ? data().MONTHS[items[0].dataIndex] : `Día ${items[0].label}`),
              label: context => ` ${context.dataset.label}: ${formatValue(context.dataset.unit, context.raw)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: '#cbd5e1' }, ticks: { color: '#94A3B8', font: { size: 10 }, autoSkip: true, maxTicksLimit: modeKey === 'monthly' ? 12 : 16 } },
          ...yScales(metrics, combined),
        },
      },
      plugins: [{
        // Valor en cada punto (valueLabels), menos los ceros (el punto ya esta en la base). Va arriba en un pico y
        // abajo en un valle, para no montarse en la linea; si choca con otra etiqueta o con el nombre de un panel, o
        // se sale de su panel, prueba el otro lado y, si tampoco cabe, se omite (queda en el tooltip).
        id: 'valueLabels',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          const placed = [];
          const overlaps = box => placed.some(other => !(box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom));
          const isValue = value => value != null && Number.isFinite(Number(value));
          ctx.save();
          // Los nombres de los paneles (panelLabels) tambien ocupan lugar.
          ctx.font = '600 11px Inter, sans-serif';
          Object.values(chart.scales).forEach(scale => {
            if (!scale.options.panelLabel) return;
            const left = chart.chartArea.left + 4;
            placed.push({ left, right: left + ctx.measureText(scale.options.panelLabel).width + 8, top: scale.top + 2, bottom: scale.top + 18 });
          });
          ctx.font = '600 10px Inter, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255,255,255,.92)';
          chart.data.datasets.forEach((dataset, index) => {
            if (!dataset.valueLabels) return;
            const meta = chart.getDatasetMeta(index);
            const scale = chart.scales[meta.yAxisID];
            if (!scale) return;
            // Solo el panel de arriba puede usar el margen superior del grafico.
            const top = scale.top <= chart.chartArea.top + 1 ? chart.chartArea.top - 22 : scale.top;
            ctx.fillStyle = dataset.borderColor;
            meta.data.forEach((point, pointIndex) => {
              const value = dataset.data[pointIndex];
              if (!isValue(value) || Number(value) === 0) return;
              const text = pointValue(dataset.unit, value);
              const half = ctx.measureText(text).width / 2 + 2;
              const before = dataset.data[pointIndex - 1];
              const after = dataset.data[pointIndex + 1];
              const valley = isValue(before) && isValue(after) && value < before && value < after;
              const sides = valley ? [point.y + 13, point.y - 12] : [point.y - 12, point.y + 13];
              // Pegada al borde, la etiqueta se corre hacia adentro para no cortarse.
              const x = Math.min(Math.max(point.x, half), chart.width - half);
              const box = sides
                .map(y => ({ y, left: x - half, right: x + half, top: y - 6, bottom: y + 6 }))
                .find(item => item.top >= top && item.bottom <= scale.bottom && !overlaps(item));
              if (!box) return;
              placed.push(box);
              ctx.strokeText(text, x, box.y);
              ctx.fillText(text, x, box.y);
            });
          });
          ctx.restore();
        },
      }, {
        // Nombre de cada panel arriba a la izquierda, en horizontal (solo con varios indicadores).
        id: 'panelLabels',
        afterDatasetsDraw(chart) {
          const ctx = chart.ctx;
          ctx.save();
          ctx.font = '600 11px Inter, sans-serif';
          ctx.textBaseline = 'top';
          Object.values(chart.scales).forEach(scale => {
            const label = scale.options.panelLabel;
            if (!label) return;
            const x = chart.chartArea.left + 8;
            const y = scale.top + 4;
            ctx.fillStyle = 'rgba(255,255,255,.85)';
            ctx.fillRect(x - 4, y - 2, ctx.measureText(label).width + 8, 16);
            ctx.fillStyle = '#475569';
            ctx.fillText(label, x, y);
          });
          ctx.restore();
        },
      }, {
        // Linea vertical en el dia del tooltip, a lo alto de todos los paneles.
        id: 'crosshair',
        afterDatasetsDraw(chart) {
          const active = chart.tooltip?.getActiveElements() || [];
          if (!active.length) return;
          const x = active[0].element.x;
          const ctx = chart.ctx;
          ctx.save();
          ctx.strokeStyle = '#94a3b8';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(x, chart.chartArea.top);
          ctx.lineTo(x, chart.chartArea.bottom);
          ctx.stroke();
          ctx.restore();
        },
      }],
    }));
  }

  // Chips de un grafico: radio para la vista, casillas para los indicadores (selected es entonces una lista).
  function chipsHtml(items, selected, name, color, multiple = false) {
    return items.map(item => {
      const on = multiple ? selected.includes(item.key) : item.key === selected;
      return `
      <label class="series-toggle campaign-chip${on ? ' active' : ''}" style="--campaign-color:${color || item.color}">
        <input type="${multiple ? 'checkbox' : 'radio'}" name="${esc(name)}" value="${esc(item.key)}"${on ? ' checked' : ''}>${esc(item.label)}
      </label>`;
    }).join('');
  }

  // La vista anual solo tiene sentido por mes; el modo elegido se conserva para cuando se vuelva a un mes.
  function chartModes(savedMode, annual) {
    if (annual) return { modes: MODES.filter(item => item.key === 'monthly'), modeKey: 'monthly' };
    return { modes: MODES, modeKey: MODES.some(item => item.key === savedMode) ? savedMode : 'daily' };
  }

  function setToggle(button, collapsed, what) {
    if (!button) return;
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('title', collapsed ? `Expandir ${what}` : `Minimizar ${what}`);
  }

  // ── Cuadro de cada campana ───────────────────────────────────────────────
  // Cada objetivo (la "campana" del reporte) tiene su cuadro: KPIs contra el mes anterior, su grafico y sus
  // conjuntos de anuncios. Indicadores, vista, un solo cuadro y minimizado se recuerdan por objetivo.
  function campaignSettings(key) {
    const saved = state.campaignCharts[key] || {};
    const metrics = CAMPAIGN_METRICS.map(item => item.key).filter(metricKey => Array.isArray(saved.metrics) && saved.metrics.includes(metricKey));
    return {
      metrics: metrics.length ? metrics : DEFAULT_CAMPAIGN_METRICS,
      // Abre por dia; una vista guardada en el acumulado (ya no se ofrece) vuelve a Por dia.
      mode: MODES.some(item => item.key === saved.mode) ? saved.mode : 'daily',
      collapsed: saved.collapsed === true,
      // Varios indicadores en un solo cuadro (cada uno con su escala) en vez de paneles apilados.
      combined: saved.combined === true,
    };
  }

  function saveCampaignSettings(key, changes) {
    state.campaignCharts[key] = { ...campaignSettings(key), ...changes };
    saveSetting(CAMPAIGN_CHARTS_KEY, JSON.stringify(state.campaignCharts));
  }

  function campaignBlock(key) {
    return [...document.querySelectorAll('#campaign-blocks .campaign-block')].find(node => node.dataset.objective === key) || null;
  }

  // Conjuntos de anuncios del objetivo en el periodo, con sus resultados contra el mes anterior.
  function adSetsHtml(period, objective) {
    const ofObjective = rows => rows.filter(row => row.group === objective.key);
    const sets = data().metrics.adSets(ofObjective(period.rows));
    const previous = new Map((period.compare ? data().metrics.adSets(ofObjective(period.compare.rows)) : []).map(set => [set.key, set]));
    const compare = Boolean(period.compare);
    // Con una sola campana su nombre ya esta en el subtitulo del cuadro.
    const manyCampaigns = objective.campaigns.length > 1;
    // [titulo, numerica]
    const head = [['Conjunto']].concat(manyCampaigns ? [['Campaña']] : [], [['Resultados', true]])
      .concat(compare ? [[`Resultados ${period.compare.label}`, true], ['Variación', true]] : [])
      .concat([['Costo por resultado', true], ['Inversión', true], ['% de la campaña'], ['Impresiones', true], ['Alcance', true], ['CPM', true], ['Clics', true]]);
    const body = sets.map(set => {
      const before = previous.get(set.key);
      return `
        <tr>
          <td class="campaign-name">${esc(set.name || '(sin conjunto)')}<small>${set.adCount} ${set.adCount === 1 ? 'anuncio' : 'anuncios'}</small></td>
          ${manyCampaigns ? `<td class="campaign-set-col">${esc(set.campaigns.join(' / '))}</td>` : ''}
          <td class="num"><b>${fmt('count', set.results)}</b></td>
          ${compare ? `<td class="num">${before ? fmt('count', before.results) : '<span class="no-data">—</span>'}</td><td class="num">${variationCell(set.results, before?.results)}</td>` : ''}
          <td class="num">${fmt('unitCost', set.costPerResult)}</td>
          <td class="num">${fmt('money', set.spend)}</td>
          <td class="share-col"><div class="share-bar"><span style="width:${Math.min(100, set.share).toFixed(1)}%"></span></div><b class="share-value">${fmt('pct', set.share)}</b></td>
          <td class="num">${fmt('count', set.impressions)}</td>
          <td class="num">${fmt('count', set.reach)}</td>
          <td class="num">${fmt('money', set.cpm)}</td>
          <td class="num">${fmt('count', set.clicks)}</td>
        </tr>`;
    }).join('') || `<tr><td class="table-empty" colspan="${head.length}">Sin conjuntos con gasto en el periodo.</td></tr>`;
    return `
      <div class="adset-head">
        <div class="panel-title">Conjuntos de anuncios</div>
        <div class="panel-sub">${sets.length} ${sets.length === 1 ? 'conjunto' : 'conjuntos'} con gasto o impresiones en ${esc(period.label)}${compare ? `. Resultados contra ${esc(period.compare.label)}` : ''}.</div>
      </div>
      <div class="table-scroll">
        <table class="data-table adset-table">
          <thead><tr>${head.map(([label, numeric]) => `<th${numeric ? ' class="num"' : ''}>${esc(label)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  // Anuncios del objetivo en el periodo, de mas a menos resultados, con la estrella en el lider.
  function campaignAdsHtml(period, objective) {
    const ofObjective = rows => rows.filter(row => row.group === objective.key);
    const ads = data().metrics.ads(ofObjective(period.rows)).sort((a, b) => (b.results - a.results) || (b.spend - a.spend));
    const previous = new Map((period.compare ? data().metrics.ads(ofObjective(period.compare.rows)) : []).map(ad => [ad.key, ad]));
    const compare = Boolean(period.compare);
    // Con un solo conjunto su nombre no aporta: la columna aparece cuando hay mas de uno.
    const manySets = new Set(ads.flatMap(ad => ad.adSets)).size > 1;
    // [titulo, numerica]
    const head = [['Anuncio']].concat(manySets ? [['Conjunto']] : [], [['Resultados', true]])
      .concat(compare ? [[`Resultados ${period.compare.label}`, true], ['Variación', true]] : [])
      .concat([['Costo por resultado', true], ['Inversión', true], ['% de la campaña'], ['Impresiones', true], ['Alcance', true], ['CPM', true], ['Clics', true], ['Días activos']]);
    const body = ads.map((ad, index) => {
      const before = previous.get(ad.key);
      const share = objective.spend > 0 ? (ad.spend / objective.spend) * 100 : 0;
      return `
        <tr>
          <td class="campaign-name campaign-ad-name" title="${esc(ad.ad)}">${arteThumb(ad)}${index === 0 && ad.results > 0 ? '<b class="leader-star" title="Líder de la campaña">&#9733;</b> ' : ''}${adNameLink(ad)}</td>
          ${manySets ? `<td class="campaign-set-col">${esc(ad.adSets.join(' / ') || '—')}</td>` : ''}
          <td class="num"><b>${fmt('count', ad.results)}</b></td>
          ${compare ? `<td class="num">${before ? fmt('count', before.results) : '<span class="no-data">—</span>'}</td><td class="num">${variationCell(ad.results, before?.results)}</td>` : ''}
          <td class="num">${fmt('unitCost', ad.costPerResult)}</td>
          <td class="num">${fmt('money', ad.spend)}</td>
          <td class="share-col"><div class="share-bar"><span style="width:${Math.min(100, share).toFixed(1)}%"></span></div><b class="share-value">${fmt('pct', share)}</b></td>
          <td class="num">${fmt('count', ad.impressions)}</td>
          <td class="num">${fmt('count', ad.reach)}</td>
          <td class="num">${fmt('money', ad.cpm)}</td>
          <td class="num">${fmt('count', ad.clicks)}</td>
          <td class="date-col">${adDays(ad, period)}</td>
        </tr>`;
    }).join('') || `<tr><td class="table-empty" colspan="${head.length}">Sin anuncios con gasto en el periodo.</td></tr>`;
    return `
      <div class="adset-head">
        <div class="panel-title">Anuncios</div>
        <div class="panel-sub">${ads.length} ${ads.length === 1 ? 'anuncio' : 'anuncios'} con gasto o impresiones en ${esc(period.label)}${compare ? `. Resultados contra ${esc(period.compare.label)}` : ''}. La estrella marca al líder.</div>
      </div>
      <div class="table-scroll">
        <table class="data-table adset-table campaign-ads-table">
          <thead><tr>${head.map(([label, numeric]) => `<th${numeric ? ' class="num"' : ''}>${esc(label)}</th>`).join('')}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>`;
  }

  function campaignHtml(period, objective, before) {
    const key = esc(objective.key);
    const settings = campaignSettings(objective.key);
    let comparison = '';
    if (period.annual) comparison = `. ${objectiveMonths(period, objective.key)}`;
    else if (period.compare) comparison = before ? ` vs ${period.compare.label}` : `. Nueva: no corría en ${period.compare.label}`;
    const kpis = CAMPAIGN_KPIS.map(kpi => `
      <div><dt>${esc(kpi.label || objective.resultLabel)}</dt><dd>${fmt(kpi.format, objective[kpi.key])}${before ? deltaHtml(objective[kpi.key], before[kpi.key], kpi.better) : ''}</dd></div>`).join('');
    return `
      <section class="campaign-block${settings.collapsed ? ' is-collapsed' : ''}" id="campaign-${key}" data-objective="${key}" style="--campaign-color:${objective.color}">
        <div class="panel-head chart-panel-head">
          <div>
            <div class="campaign-block-title"><i class="campaign-dot"></i>Campaña ${esc(objective.label)}<em>${fmt('pct', objective.share)} de la inversión</em></div>
            <div class="panel-sub">${esc(objective.campaigns.join(' / '))} | ${esc(period.label)}${esc(comparison)}</div>
          </div>
          <div class="chart-controls">
            <div class="chart-series-toggles" data-campaign-modes role="radiogroup" aria-label="Vista del gráfico de ${esc(objective.label)}"></div>
            <button type="button" class="chart-toggle" data-campaign-toggle="${key}" aria-controls="campaign-body-${key}">${CHEVRON}</button>
          </div>
        </div>
        <dl class="chart-kpis">${kpis}</dl>
        <div class="campaign-block-body" id="campaign-body-${key}">
          <div class="chart-series-toggles chart-metrics" data-campaign-metrics role="group" aria-label="Indicadores del gráfico de ${esc(objective.label)}"></div>
          <div class="chart-wrap h-300"><canvas role="img" aria-label="Gráfico de la campaña ${esc(objective.label)}"></canvas></div>
          <div class="chart-legend projection-legend" data-campaign-legend></div>
          ${adSetsHtml(period, objective)}
          ${campaignAdsHtml(period, objective)}
        </div>
      </section>`;
  }

  // Los controles del cuadro lo redibujan solo con la clave; renderCampaigns le pasa el periodo y sus objetivos.
  function renderCampaignChart(key, period = currentPeriod(), objectives = period ? data().metrics.objectives(period.rows) : []) {
    const block = campaignBlock(key);
    const objective = objectives.find(item => item.key === key);
    const month = selectedMonth();
    if (!block || !objective || !month) return;
    const settings = campaignSettings(key);
    const { modes, modeKey } = chartModes(settings.mode, period.annual);
    const metrics = CAMPAIGN_METRICS.map(item => ({
      ...item,
      label: item.key === 'results' ? objective.resultLabel : item.label,
      color: objective.color,
      combinedColor: !item.color ? objective.color : item.color === objective.color ? COMBINED_ALT_COLOR : item.color,
      group: key,
    }));
    const selected = metrics.filter(item => settings.metrics.includes(item.key));
    const combined = settings.combined && selected.length > 1;
    block.classList.toggle('is-collapsed', settings.collapsed);
    setToggle(block.querySelector('[data-campaign-toggle]'), settings.collapsed, `la campaña ${objective.label}`);
    replaceHtml(block.querySelector('[data-campaign-modes]'), chipsHtml(modes, modeKey, `campaign-mode-${key}`, 'var(--brand-text)'));
    // El boton de un solo cuadro aparece con dos o mas indicadores marcados.
    const combineButton = selected.length > 1
      ? `<button type="button" class="series-toggle campaign-chip campaign-combine${combined ? ' active' : ''}" data-campaign-combine aria-pressed="${combined}" title="${combined ? 'Volver a un panel por indicador' : 'Juntar los indicadores en un solo cuadro'}">Un solo cuadro</button>`
      : '';
    replaceHtml(block.querySelector('[data-campaign-metrics]'), chipsHtml(metrics, settings.metrics, `campaign-metric-${key}`, null, true) + combineButton);
    if (settings.collapsed) {
      destroyChart(key);
      return;
    }
    const series = campaignSeries(selected, modeKey, month, combined);
    const canvas = block.querySelector('canvas');
    // Cada panel extra suma alto para que ninguno quede aplastado; en un solo cuadro, algo mas de alto para las
    // etiquetas. Sin Chart.js el canvas ya es el aviso.
    if (canvas) canvas.parentElement.style.height = combined ? '380px' : selected.length > 1 ? `${90 + 135 * selected.length}px` : '';
    block.querySelector('[data-campaign-legend]').innerHTML = series.legend.join('');
    drawLineChart(key, canvas, series, selected, modeKey, combined);
  }

  function renderCampaigns(period, objectives) {
    const host = document.getElementById('campaign-blocks');
    if (!host) return;
    [...state.charts.keys()].forEach(destroyChart);
    if (!period) {
      host.innerHTML = '';
      return;
    }
    const previous = period.compare ? data().metrics.objectives(period.compare.rows) : [];
    // Datos nuevos rehacen los cuadros sin sacar el foco del chip o del boton que se estaba usando.
    data().keepFocus(host, () => {
      host.innerHTML = objectives.map(objective => campaignHtml(period, objective, previous.find(item => item.key === objective.key))).join('');
      objectives.forEach(objective => renderCampaignChart(objective.key, period, objectives));
    });
  }

  // ── Distribucion por campana ─────────────────────────────────────────────
  function renderDistribution(period, objectives) {
    const body = document.getElementById('distribution-body');
    const sub = document.getElementById('distribution-sub');
    if (!body) return;
    if (!period) {
      body.innerHTML = '<tr><td class="table-empty" colspan="13">Sin datos para el periodo.</td></tr>';
      if (sub) sub.textContent = '';
      return;
    }
    const rows = data().metrics.campaigns(period.rows);
    const colors = new Map(objectives.map(objective => [objective.key, objective.color]));
    const total = data().metrics.summarize(period.rows);
    if (sub) sub.textContent = `${period.label} | ${rows.length} ${rows.length === 1 ? 'campaña' : 'campañas'} con gasto o impresiones.`;
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

  // ── Modulo Anuncios (vista view-ads) ─────────────────────────────────────
  // Top 3 de anuncios por contactos de WhatsApp: los de mas resultados en las campanas de WhatsApp y, a igual
  // cantidad, el de menor costo por resultado. Cada tarjeta dice que resultado cuenta (clics o conversaciones).
  function renderTopAds(period, objectives) {
    const host = document.getElementById('ads-top');
    if (!host) return;
    if (!period) {
      host.innerHTML = '';
      return;
    }
    const colors = new Map(objectives.map(objective => [objective.key, objective.color]));
    const top = data().metrics.ads(period.rows.filter(row => TOP_GROUPS.includes(row.group)))
      .filter(ad => ad.results > 0)
      .sort((a, b) => (b.results - a.results) || ((a.costPerResult ?? Infinity) - (b.costPerResult ?? Infinity)))
      .slice(0, 3);
    const head = '<div class="ad-top-head">Top 3 de anuncios por contactos de WhatsApp</div>';
    if (!top.length) {
      host.innerHTML = `${head}<p class="ad-top-note">Ningún anuncio de las campañas de WhatsApp registró contactos en el periodo.</p>`;
      return;
    }
    host.innerHTML = `${head}<div class="ad-top-list">${top.map((ad, index) => `
      <div class="ad-top-card" style="--campaign-color:${colors.get(ad.group) || PREVIOUS_COLOR}">
        <span class="ad-top-rank">${index + 1}</span>
        <div class="ad-top-body">
          <div class="ad-top-name" title="${esc(ad.ad)}">${adNameLink(ad)}</div>
          <div class="ad-top-group"><i class="campaign-dot"></i>${esc(ad.groupLabel)} · ${esc(ad.campaigns.join(' / '))}</div>
          <div class="ad-top-value">${fmt('count', ad.results)}<small>${esc(ad.resultLabel)}</small></div>
          <div class="ad-top-meta">${fmt('unitCost', ad.costPerResult)} por resultado · ${fmt('money', ad.spend)} de inversión</div>
        </div>
      </div>`).join('')}</div>`;
  }

  function renderAdsFilter(objectives) {
    const select = document.getElementById('ads-objective');
    if (!select) return;
    if (state.adsObjective !== 'all' && !objectives.some(objective => objective.key === state.adsObjective)) state.adsObjective = 'all';
    select.innerHTML = ['<option value="all">Todos los objetivos</option>']
      .concat(objectives.map(objective => `<option value="${esc(objective.key)}"${objective.key === state.adsObjective ? ' selected' : ''}>${esc(objective.label)}</option>`))
      .join('');
  }

  function renderAds(period, objectives = period ? data().metrics.objectives(period.rows) : []) {
    const body = document.getElementById('campaigns-body');
    const title = document.getElementById('campaigns-title');
    const sub = document.getElementById('campaigns-sub');
    const prevHead = document.getElementById('ads-prev-head');
    if (!body) return;
    // Sin periodo de comparacion (vista anual o primer mes) las columnas de mes anterior y variacion se ocultan.
    document.querySelector('.campaigns-panel')?.classList.toggle('no-compare', !period?.compare);
    if (!period) {
      body.innerHTML = '<tr><td class="table-empty" colspan="14">Sin datos para el periodo.</td></tr>';
      // Vuelven los textos iniciales: los del periodo anterior ya no aplican.
      if (title) title.textContent = 'Anuncios del periodo';
      if (sub) sub.textContent = '';
      if (prevHead) prevHead.textContent = 'Mes anterior';
      renderAdsFilter([]);
      return;
    }
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
    if (sub) sub.textContent = `${rows.length} ${rows.length === 1 ? 'anuncio' : 'anuncios'} ordenados por resultados dentro de cada objetivo. La estrella marca al líder de cada objetivo.`;
    if (prevHead) prevHead.textContent = period.compare ? `Resultados ${period.compare.label}` : 'Mes anterior';

    if (!rows.length) {
      body.innerHTML = '<tr><td class="table-empty" colspan="14">No hay anuncios para este objetivo en el periodo.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(ad => {
      const before = previous.get(ad.key);
      const changeCell = period.compare ? variationCell(ad.results, before?.results) : '<span class="no-data">—</span>';
      return `
        <tr>
          <td class="type-col"><span class="objective-label" style="--campaign-color:${colors.get(ad.group) || PREVIOUS_COLOR}"><i class="campaign-dot"></i>${esc(ad.groupLabel)}</span></td>
          <td class="ad-name-col" title="${esc(ad.ad)}">${arteThumb(ad)}<span class="ad-name-text">${ad.leader ? '<b class="leader-star" title="Líder del objetivo">&#9733;</b> ' : ''}${adNameLink(ad)}</span></td>
          <td class="campaign-set-col">${esc(ad.campaigns.join(' / '))}<small>${esc(ad.adSets.join(' / ') || '—')}</small></td>
          <td><span class="objective-pill">${esc(ad.resultLabel)}</span></td>
          <td class="num"><b>${fmt('count', ad.results)}</b></td>
          <td class="num">${before ? fmt('count', before.results) : '<span class="no-data">—</span>'}</td>
          <td class="num">${changeCell}</td>
          <td class="num">${fmt('unitCost', ad.costPerResult)}</td>
          <td class="num">${fmt('money', ad.spend)}</td>
          <td class="num">${fmt('count', ad.impressions)}</td>
          <td class="num">${fmt('count', ad.reach)}</td>
          <td class="num">${fmt('money', ad.cpm)}</td>
          <td class="num">${fmt('count', ad.clicks)}</td>
          <td class="date-col">${adDays(ad, period)}</td>
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
        if (hasActivity(row)) {
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
    if (!year || !month || !day) return '—';
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

  function renderHistoryTabs(snapshot, year, month) {
    const host = document.getElementById('history-month-tabs');
    if (!host) return;
    replaceHtml(host, monthTabsHtml(snapshot, year, month?.key, {
      key: HISTORY_ALL,
      label: 'Todos',
      title: 'Todas las descargas de Meta en Drive',
      available: snapshot.months.some(item => item.hasData),
      selected: !month,
    }));
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
        const days = rows.filter(hasActivity).map(row => row.d);
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
    replaceHtml(host, HISTORY_STATUS.map(status => {
      const selected = status.key === state.historyStatus;
      const count = entries.filter(entry => matchesStatus(entry.item, status.key)).length;
      return `<label class="series-toggle campaign-chip${selected ? ' active' : ''}"><input type="radio" name="history-status" value="${status.key}"${selected ? ' checked' : ''}>${status.label} (${count})</label>`;
    }).join(''));
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
      ['Campañas', fmt('count', entries.length), statusNote],
      ['Inversión', fmt('money', totals.spend), month ? `Gasto en ${month.name}` : 'Gasto acumulado'],
      ['Impresiones', fmt('count', totals.impressions), month ? `En ${month.name}` : 'Total histórico'],
      ['Alcance', fmt('count', totals.reach), 'Suma diaria por público'],
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
  function historyAdsCell(ads, campaign) {
    if (!ads.length) return '<span class="no-data">—</span>';
    return `<details class="history-ads" data-campaign="${esc(campaign)}"><summary>${ads.length} ${ads.length === 1 ? 'anuncio' : 'anuncios'}</summary><div class="history-ads-list">${ads.map(historyAdChip).join('')}</div></details>`;
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
    state.historyYear = month ? month.year : validYear(snapshot, state.historyYear);
    renderHistoryTabs(snapshot, state.historyYear, month);
    const scoped = historyEntries(campaignHistory(snapshot), month);
    renderHistoryStatus(scoped);
    const entries = scoped.filter(entry => matchesStatus(entry.item, state.historyStatus));
    renderHistoryKpis(snapshot, entries, month);

    // Con descargas de mas de un año cada columna de mes lleva el suyo (Dic 26, Ene 27).
    const multiYear = dataYears(snapshot).length > 1;
    const months = month ? [] : snapshot.months.filter(item => item.hasData);
    head.innerHTML = `<tr><th>Campaña</th><th>Objetivo</th><th>Estado</th>${months.map(item => {
      const partial = !item.complete && !item.past;
      return `<th class="num" title="${esc(item.fileName || `${item.name} ${item.year}`)}">${item.shortName}${multiYear ? ` ${String(item.year).slice(2)}` : ''}${partial ? ` (al ${item.lastDay})` : ''}</th>`;
    }).join('')}<th class="num">${month ? `Gasto ${month.shortName}` : 'Gasto total'}</th><th class="num">Resultados</th><th class="num th-wrap">Costo por resultado</th><th class="num">Impresiones</th><th class="num">Alcance</th><th>Anuncios</th>${month
      ? '<th>Días activos</th><th class="num" title="Gasto de la campaña en todos los meses">Gasto acumulado</th>'
      : '<th>Periodo</th>'}</tr>`;

    const status = HISTORY_STATUS.find(item => item.key === state.historyStatus);
    const noun = entries.length === 1 ? status.one : status.many;
    const sub = document.getElementById('history-sub');
    if (sub) {
      if (!entries.length) {
        sub.textContent = `Ninguna ${status.one} ${month ? `con gasto en ${month.name} ${month.year}` : 'en las descargas de Meta en Drive'}.`;
      } else if (month) {
        sub.textContent = `${entries.length} ${noun} con gasto en ${month.name} ${month.year} según su archivo en Drive (${month.fileName || 'sin nombre'}).`;
      } else {
        const first = months[0];
        const last = months[months.length - 1];
        // Con mas de un año cada extremo del rango lleva el suyo.
        const range = multiYear
          ? `${first.name} ${first.year} a ${last.name} ${last.year}`
          : `${months.length > 1 ? `${first.name} a ${last.name}` : first.name} ${snapshot.year}`;
        sub.textContent = `${entries.length} ${noun} en ${months.length} ${months.length === 1 ? 'descarga' : 'descargas'} de Meta en Drive (${range}). Cada mes es el gasto de su archivo; el nombre aparece al pasar el mouse.`;
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
        ${months.map(column => `<td class="num">${item.months.includes(column.key) ? fmt('money', spendIn(item.rows, column.key)) : '<span class="no-data">—</span>'}</td>`).join('')}
        <td class="num"><b>${fmt('money', stats.spend)}</b></td>
        <td class="num history-results"><b>${fmt('count', stats.results)}</b><small>${esc(stats.resultLabel)}</small></td>
        <td class="num">${fmt('unitCost', stats.costPerResult)}</td>
        <td class="num">${fmt('count', stats.impressions)}</td>
        <td class="num">${fmt('count', stats.reach)}</td>
        <td>${historyAdsCell(ads, item.name)}</td>
        ${month
          ? `<td class="date-col">${daysLabel(from, to)}</td><td class="num">${fmt('money', item.spend)}</td>`
          : `<td class="date-col">${periodLabel(item.first, item.last)}</td>`}
      </tr>`).join('') + `
      <tr class="total-row">
        <td class="campaign-name">${month ? `Total de ${esc(month.name)}` : 'Total'}</td>
        <td></td><td></td>
        ${months.map(item => `<td class="num">${entries.some(entry => entry.item.months.includes(item.key)) ? fmt('money', spendIn(allRows, item.key)) : '<span class="no-data">—</span>'}</td>`).join('')}
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
    button.textContent = state.tableCompact ? 'Cómodo' : 'Compacto';
    button.setAttribute('title', state.tableCompact ? 'Volver a filas amplias' : 'Reducir el alto de las filas');
  }

  function toggleTableFullscreen(force) {
    state.tableFullscreen = force == null ? !state.tableFullscreen : Boolean(force);
    const panel = document.querySelector('.campaigns-panel');
    const button = document.getElementById('campaigns-expand-btn');
    const tabs = document.getElementById('ads-month-tabs');
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
  // Gasto publicitario (view-obj) o Anuncios (view-ads): pestanas, periodo y todo lo que depende del mes elegido.
  function renderPeriodView(viewId) {
    const snapshot = data()?.snapshot();
    if (!snapshot) return;
    const month = selectedMonth();
    state.year = viewYear();
    state.monthKey = annualView() ? YEAR_KEY : month?.key || null;
    const period = currentPeriod();
    // Los objetivos del periodo se calculan una vez para los cuadros, la distribucion y los anuncios.
    const objectives = period ? data().metrics.objectives(period.rows) : [];
    if (viewId === 'view-ads') {
      renderTabs(snapshot, 'ads-month-tabs');
      renderPeriod(period, 'ads-');
      renderTopAds(period, objectives);
      renderAds(period, objectives);
    } else {
      renderTabs(snapshot);
      renderPeriod(period);
      renderKpis(period);
      renderCampaigns(period, objectives);
      renderDistribution(period, objectives);
    }
    state.rendered[viewId] = state.monthVersion;
  }

  // Al abrir Gasto publicitario o Anuncios: se repinta solo si el mes cambio en la otra vista.
  function show(viewId) {
    if (state.wired && PERIOD_VIEWS.includes(viewId) && state.rendered[viewId] !== state.monthVersion) renderPeriodView(viewId);
  }

  // Con datos nuevos se repintan todas las vistas; el Historico cambia de mes con sus propias pestanas.
  function renderAll() {
    PERIOD_VIEWS.forEach(renderPeriodView);
    renderHistory();
  }

  function wireEvents() {
    const adsTabs = document.getElementById('ads-month-tabs');
    if (adsTabs) state.tabsHome = { parent: adsTabs.parentNode, next: adsTabs.nextSibling };
    // Las pestanas de las dos vistas cambian el mismo mes: se pinta la vista de la pestana y la otra queda atrasada.
    [['month-tabs', 'view-obj'], ['ads-month-tabs', 'view-ads']].forEach(([id, viewId]) => {
      document.getElementById(id)?.addEventListener('click', event => {
        const button = event.target.closest('.month-tab:not(:disabled)');
        if (!button) return;
        const year = Number(button.dataset.year);
        if (year) {
          if (year === viewYear()) return;
          // Otro año: un mes pasa al ultimo mes con datos de ese año y la vista anual sigue en anual.
          state.year = year;
          if (state.monthKey !== YEAR_KEY) state.monthKey = latestMonthOf(data().snapshot(), year)?.key || null;
        } else {
          if (button.dataset.month === state.monthKey) return;
          state.monthKey = button.dataset.month;
        }
        state.monthVersion += 1;
        renderPeriodView(viewId);
      });
    });
    document.getElementById('history-month-tabs')?.addEventListener('click', event => {
      const button = event.target.closest('.month-tab:not(:disabled)');
      if (!button) return;
      const year = Number(button.dataset.year);
      if (year) {
        if (year === state.historyYear) return;
        // Otro año: "Todos" se mantiene y un mes pasa al ultimo mes con datos de ese año.
        state.historyYear = year;
        if (state.historyMonth !== HISTORY_ALL) state.historyMonth = latestMonthOf(data().snapshot(), year)?.key || HISTORY_ALL;
      } else {
        if (button.dataset.month === state.historyMonth) return;
        state.historyMonth = button.dataset.month;
      }
      renderHistory();
    });
    document.getElementById('history-status-filter')?.addEventListener('change', event => {
      const input = event.target.closest('input[name="history-status"]');
      if (!input) return;
      state.historyStatus = input.value;
      renderHistory();
    });
    // Indicadores, vista, un solo cuadro y minimizado de cada cuadro de campana.
    const campaigns = document.getElementById('campaign-blocks');
    campaigns?.addEventListener('change', event => {
      const input = event.target.closest('input');
      const block = input?.closest('.campaign-block');
      const key = block?.dataset.objective;
      if (!key) return;
      if (input.closest('[data-campaign-modes]')) {
        saveCampaignSettings(key, { mode: input.value });
      } else {
        // Siempre queda al menos un indicador: desmarcar el ultimo lo deja como estaba.
        const checked = [...block.querySelectorAll('[data-campaign-metrics] input:checked')].map(item => item.value);
        if (checked.length) saveCampaignSettings(key, { metrics: checked });
      }
      renderCampaignChart(key);
    });
    campaigns?.addEventListener('click', event => {
      const combine = event.target.closest('[data-campaign-combine]');
      const key = (combine || event.target.closest('[data-campaign-toggle]'))?.closest('.campaign-block')?.dataset.objective;
      if (!key) return;
      // "Un solo cuadro" junta o separa los indicadores; el chevron minimiza o expande el cuadro.
      saveCampaignSettings(key, combine ? { combined: !campaignSettings(key).combined } : { collapsed: !campaignSettings(key).collapsed });
      renderCampaignChart(key);
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
    // Datos nuevos no cierran la lista de anuncios que el usuario tiene abierta en el Historico.
    window.addEventListener('tp:data-updated', () => {
      const body = document.getElementById('history-body');
      const open = new Set([...(body?.querySelectorAll('details.history-ads[open]') || [])].map(node => node.dataset.campaign));
      renderAll();
      if (open.size) body.querySelectorAll('details.history-ads').forEach(node => { if (open.has(node.dataset.campaign)) node.open = true; });
    });
    // Sin datos de ningun origen: se reemplazan los "Cargando..." por el motivo.
    window.addEventListener('tp:data-error', () => {
      if (data().snapshot()) return;
      const message = `No se pudieron cargar los datos (${data().status().error}). Pulsa Actualizar para reintentar.`;
      ['', 'ads-'].forEach(prefix => {
        const title = document.getElementById(`${prefix}period-title`);
        if (title) title.textContent = 'Sin datos de Meta';
        const sub = document.getElementById(`${prefix}period-sub`);
        if (sub) sub.textContent = message;
      });
      [['distribution-body', 13], ['campaigns-body', 14], ['history-body', 10]].forEach(([id, span]) => {
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

  window.TPObjectives = { show };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
