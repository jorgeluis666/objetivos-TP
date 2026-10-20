(function () {
  // Generacion de Reporte: el PDF de publicidad con el diseño del modelo de la agencia ("Modelo Reporte
  // Terminal Pesquero"): laminas 16:9 con portada, contenido, comparativa, una pagina por objetivo,
  // conclusiones y cierre. No trae datos nuevos: usa las mismas filas del barrido de Meta que ya tiene el
  // tablero (<Marca>Data.snapshot(), una fila por dia, campaña, conjunto y anuncio).
  //
  // Se elige el periodo arriba: un mes contra el mismo tramo del mes anterior ("Octubre (1–18) vs
  // Septiembre (1–18)", como el modelo) o una semana de lunes a domingo contra la anterior. La lectura, el
  // analisis de cada objetivo y las conclusiones vienen propuestos con lo que dicen los numeros; el equipo
  // los reescribe sobre la misma lamina y quedan guardados por periodo en este navegador.
  //
  // Este archivo es el mismo en todos los tableros de marca: lo unico que cambia es CONFIG.
  const CONFIG = {
    brand: 'Terminal Pesquero',
    slug: 'Terminal-Pesquero',
    data: () => window.TPData,
    updatedEvent: 'tp:data-updated',
    notesKey: 'tp-report-notes-v2',
  };

  const WEEKS_IN_LIST = 12;
  const MAX_ADS = 4;
  const PAGE_WIDTH = 1280;
  const LOGO = 'assets/logo-lima-retail.png';
  const AGENCY_LINE = 'Lima Retail · Data Driven Marketing · Power KPI · Digital Analytics';

  // Cada objetivo del barrido va a una seccion del reporte, en el orden del embudo y con el nombre del
  // modelo. Las dos campañas de WhatsApp (clics al boton y conversaciones) son una sola: Mensajes.
  const SECTIONS = [
    { key: 'reconocimiento', match: /notoriedad|thruplay|reconoc/, title: 'Reconocimiento', short: 'Reconocimiento', noun: 'reproducciones', icon: 'play' },
    { key: 'trafico-ig', match: /trafico-ig|perfil/, title: 'Tráfico al perfil', short: 'Tráfico al perfil', noun: 'visitas al perfil', icon: 'pointer' },
    { key: 'interaccion', match: /interacc/, title: 'Interacción', short: 'Interacción', noun: 'interacciones', icon: 'heart' },
    { key: 'trafico-web', match: /trafico-web/, title: 'Tráfico web', short: 'Tráfico web', noun: 'visitas a la web', icon: 'globe' },
    { key: 'mensajes', match: /whatsapp|mensaje/, title: 'Mensajes WhatsApp', short: 'Mensajes', noun: 'conversaciones', icon: 'chat' },
  ];

  // Iconos de linea (24x24) de las tarjetas de contenido y conclusiones.
  const ICONS = {
    chart: '<path d="M3 3v18h18"/><path d="M8 17v-5"/><path d="M13 17V8"/><path d="M18 17v-3"/>',
    play: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m10 8 6 4-6 4z"/>',
    heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
    flag: '<path d="M4 22V4"/><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1"/>',
    pointer: '<path d="m4 4 7.07 17 2.51-7.39L21 11.07z"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    pulse: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.target}</svg>`;

  let selectedPeriod = '';
  let wired = false;
  let resizeObserver = null;

  const api = () => CONFIG.data() || null;
  // Un tablero con sub-marcas (ExcambiareData.brandLabel) nombra en la portada la que se esta viendo.
  const brandName = () => (api()?.brandLabel ? `${CONFIG.brand} · ${api().brandLabel()}` : CONFIG.brand);
  const brandSlug = () => (api()?.brandLabel ? `${CONFIG.slug}-${api().brandLabel().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-')}` : CONFIG.slug);
  const normalize = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);

  // ── Formatos del modelo ("S/ 685", "S/ 0.0063", "66,692", "-36%") ───────
  const integer = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
  const finite = value => value != null && Number.isFinite(Number(value));
  const num = value => (finite(value) ? integer.format(Math.round(value)) : '—');
  const money = value => (finite(value) ? `S/ ${integer.format(Math.round(value))}` : '—');
  const money2 = value => (finite(value) ? `S/ ${Number(value).toFixed(2)}` : '—');
  // Los costos por resultado de branding son centavos: bajo S/ 1 van con cuatro decimales.
  const cost = value => (finite(value) && value > 0 ? `S/ ${Number(value).toFixed(value < 1 ? 4 : 2)}` : '—');
  const pct = value => (Math.round(value) === 0 ? '0%' : `${value > 0 ? '+' : '-'}${Math.abs(Math.round(value))}%`);
  // Flecha y color de una variacion; la que redondea a 0% va sin flecha y en gris.
  const trendClass = (value, inverse) => (Math.round(value) === 0 ? 'muted' : (inverse ? value < 0 : value > 0) ? 'good' : 'bad');
  const arrow = value => (Math.round(value) === 0 ? '' : `${value > 0 ? '▲' : '▼'}&nbsp; `);
  const compact = value => (value >= 1000 ? `${(value / 1000).toFixed(1)}k` : integer.format(Math.round(value)));
  const pageNumber = value => String(value).padStart(2, '0');
  const list = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items[0] || '');
  const change = (current, previous) => api().metrics.change(current, previous);

  // ── Fechas en hora de Lima ─────────────────────────────────────────────
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

  const shortMonth = day => api().SHORT_MONTHS[Number(day.split('-')[1]) - 1].toLowerCase();
  const dayLabel = day => `${Number(day.split('-')[2])} ${shortMonth(day)}`;

  // "13–19 oct"; entre dos meses, "29 sep–5 oct".
  function weekLabel(monday) {
    const sunday = shiftDays(monday, 6);
    const start = shortMonth(monday) === shortMonth(sunday) ? String(Number(monday.split('-')[2])) : dayLabel(monday);
    return `${start}–${dayLabel(sunday)}`;
  }

  function issuedLabel() {
    const [year, month, day] = todayIso().split('-');
    return `${Number(day)} ${api().SHORT_MONTHS[Number(month) - 1].toLowerCase()}. ${year}`;
  }

  // ── Periodos del selector ──────────────────────────────────────────────
  function allRows() {
    const months = api()?.snapshot()?.months || [];
    return months.filter(month => !month.error).flatMap(month => month.rows || []);
  }

  const activity = row => Number(row.spend) > 0 || Number(row.impressions) > 0;

  // Un mes contra el mismo tramo del mes anterior, con el periodo que ya usa Gasto publicitario
  // (metrics.period: el mes en curso hasta el ultimo dia con datos, un mes cerrado completo).
  function monthPeriods() {
    const { metrics } = api();
    return (api().snapshot()?.months || [])
      .filter(month => month.hasData && !month.error)
      .reverse()
      .map(month => {
        const period = metrics.period(month);
        if (!period) return null;
        const prev = period.compare;
        // El primer mes con datos empieza el dia que arranco la pauta (Junio, desde el 15).
        const from = Math.max(period.from, month.firstDay || 1);
        const range = `${from}–${period.to}`;
        const prevFrom = prev ? Math.max(prev.from, prev.month.firstDay || 1) : 1;
        const prevRange = prev ? `${prevFrom}–${prev.to}` : '';
        const cur = month.name;
        const before = prev ? prev.month.name : '';
        const curTag = month.shortName.toLowerCase();
        const prevTag = prev ? prev.month.shortName.toLowerCase() : '';
        const same = prev && range === prevRange;
        return {
          id: `m:${month.key}`,
          option: `${cur} ${month.year} · ${range}${prev ? ` vs ${before} ${prevRange}` : ''}`,
          rows: period.rows,
          prevRows: prev ? prev.rows : null,
          missingDays: [],
          labels: {
            kind: 'mensual',
            cover: prev ? `${cur} (${range}) vs ${before} (${prevRange})` : `${cur} (${range})`,
            compTitle: 'Comparativa mes a mes',
            compSub: prev
              ? (same ? `${cur} (${range}) frente al mismo período de ${before.toLowerCase()}.` : `${cur} (${range}) frente a ${before.toLowerCase()} (${prevRange}).`)
              : `${cur} (${range}). Es el primer mes con datos: no hay mes anterior para comparar.`,
            compDesc: prev ? `Totales ${curTag} vs ${prevTag} por objetivo.` : `Totales de ${curTag} por objetivo.`,
            versus: prev ? `${cur.toLowerCase()} vs ${before.toLowerCase()}` : cur.toLowerCase(),
            sectionSub: prev
              ? (same ? `Comparación ${cur.toLowerCase()} vs ${before.toLowerCase()} (${range}) · su resultado propio.` : `Comparación ${cur.toLowerCase()} (${range}) vs ${before.toLowerCase()} (${prevRange}) · su resultado propio.`)
              : `${cur} (${range}) · su resultado propio.`,
            curTag,
            prevTag,
            curRef: cur.toLowerCase(),
            prevRef: before.toLowerCase(),
            barCur: cur,
            barPrev: before,
            chartSub: period.closed ? 'Meses completos.' : 'Mismo período comparado.',
            chartRange: prev ? `${prevFrom}-${prev.to} ${before.toLowerCase()} vs ${from}-${period.to} ${cur.toLowerCase()}` : `${from}-${period.to} ${cur.toLowerCase()}`,
            source: `Fuente: Meta Ads · ${curTag} ${range}${prev ? ` vs ${prevTag} ${prevRange}` : ''}, ${month.year}`,
            footer: `${brandName()} · Reporte Meta Ads · ${prev ? `${cur} vs ${before}` : `${cur} ${month.year}`}`,
            contentsSub: 'Qué encontrarás en cada sección de este informe mensual.',
            conclusionsSub: 'Cómo evolucionó frente al mes anterior y qué priorizar.',
            conclusionsSource: `Fuente: análisis Lima Retail · ${brandName()} · ${cur.toLowerCase()} ${month.year}`,
            windowNote: prev && same && !period.closed
              ? `**Comparación de ventanas equivalentes:** ${cur.toLowerCase()} y ${before.toLowerCase()}, ambos del ${from} al ${period.to}. Las variaciones son indicativas del ritmo.`
              : '',
            file: `${cur}${month.year}_${from}-${period.to}`,
          },
        };
      })
      .filter(Boolean);
  }

  // Semanas cerradas con actividad, de la mas reciente a la mas antigua. La semana en curso no se lista:
  // el reporte semanal es de lunes a domingo completo.
  function weekPeriods() {
    const rowsAll = allRows();
    const currentMonday = mondayOf(todayIso());
    const byWeek = new Map();
    rowsAll.forEach(row => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.day || '')) return;
      const monday = mondayOf(row.day);
      if (monday >= currentMonday) return;
      if (!byWeek.has(monday)) byWeek.set(monday, []);
      byWeek.get(monday).push(row);
    });
    // Un dia sin filas despues del ultimo dia del barrido: la descarga del mes todavia no llega hasta ahi.
    const dataEnd = api()?.snapshot()?.dataEnd || rowsAll.map(row => row.day).sort().pop() || '';
    return [...byWeek.entries()]
      .filter(([, rows]) => rows.some(activity))
      .sort((left, right) => right[0].localeCompare(left[0]))
      .slice(0, WEEKS_IN_LIST)
      .map(([monday, rows]) => {
        const prevMonday = shiftDays(monday, -7);
        const prevRows = rowsAll.filter(row => row.day >= prevMonday && row.day < monday);
        const hasPrev = prevRows.some(activity);
        const curTag = weekLabel(monday);
        const prevTag = weekLabel(prevMonday);
        const year = shiftDays(monday, 6).slice(0, 4);
        const missingDays = Array.from({ length: 7 }, (_, index) => shiftDays(monday, index))
          .filter(day => day > dataEnd && !rows.some(row => row.day === day));
        return {
          id: `w:${monday}`,
          option: `Semana ${curTag} ${year}`,
          rows,
          prevRows: hasPrev ? prevRows : null,
          missingDays,
          dataEnd,
          labels: {
            kind: 'semanal',
            cover: hasPrev ? `Semana ${curTag} vs semana ${prevTag}` : `Semana ${curTag}`,
            compTitle: 'Comparativa semana a semana',
            compSub: hasPrev ? `Semana del ${curTag} frente a la semana anterior (${prevTag}).` : `Semana del ${curTag}. No hay semana anterior con datos para comparar.`,
            compDesc: hasPrev ? 'Totales de la semana vs la anterior por objetivo.' : 'Totales de la semana por objetivo.',
            versus: hasPrev ? `${curTag} vs ${prevTag}` : curTag,
            sectionSub: hasPrev ? `Comparación semana ${curTag} vs ${prevTag} · su resultado propio.` : `Semana ${curTag} · su resultado propio.`,
            curTag,
            prevTag,
            curRef: 'esta semana',
            prevRef: 'la semana anterior',
            barCur: `Semana ${curTag}`,
            barPrev: `Semana ${prevTag}`,
            chartSub: 'Semanas de lunes a domingo.',
            chartRange: hasPrev ? `${prevTag} vs ${curTag}` : curTag,
            source: `Fuente: Meta Ads · ${curTag}${hasPrev ? ` vs ${prevTag}` : ''}, ${year}`,
            footer: `${brandName()} · Reporte Meta Ads · Semana ${curTag}`,
            contentsSub: 'Qué encontrarás en cada sección de este informe semanal.',
            conclusionsSub: 'Cómo evolucionó frente a la semana anterior y qué priorizar.',
            conclusionsSource: `Fuente: análisis Lima Retail · ${brandName()} · semana ${curTag} ${year}`,
            windowNote: '',
            file: `Semana_${curTag.replace(/\s+/g, '').replace('–', '-')}${year}`,
          },
        };
      });
  }

  // ── Secciones por objetivo ─────────────────────────────────────────────
  function sectionOf(row) {
    const key = normalize(row.group || row.groupLabel);
    const known = SECTIONS.find(section => section.match.test(key));
    if (known) return known;
    return { key: row.group || 'otro', title: row.groupLabel || 'Otro objetivo', short: row.groupLabel || 'Otro objetivo', noun: '', icon: 'target' };
  }

  function bySection(rows) {
    const groups = new Map();
    (rows || []).forEach(row => {
      const section = sectionOf(row);
      if (!groups.has(section.key)) groups.set(section.key, { section, rows: [] });
      groups.get(section.key).rows.push(row);
    });
    return groups;
  }

  // Un anuncio es su nombre dentro de la seccion: si la misma pieza corre en las dos campañas de WhatsApp,
  // se suma. Gana el de mas resultados.
  function bestAds(rows) {
    const byName = new Map();
    api().metrics.ads(rows).forEach(ad => {
      const key = normalize(ad.ad);
      const hit = byName.get(key);
      if (!hit) byName.set(key, { name: ad.ad, spend: ad.spend, results: ad.results, preview: ad.preview });
      else {
        hit.spend += ad.spend;
        hit.results += ad.results;
        hit.preview = hit.preview || ad.preview;
      }
    });
    return [...byName.values()]
      .sort((left, right) => right.results - left.results || right.spend - left.spend)
      .slice(0, MAX_ADS);
  }

  function buildReport(period) {
    const { metrics } = api();
    const previous = bySection(period.prevRows);
    const order = key => {
      const index = SECTIONS.findIndex(section => section.key === key);
      return index < 0 ? SECTIONS.length : index;
    };
    const sections = [...bySection(period.rows).values()]
      .map(({ section, rows }) => {
        const cur = metrics.summarize(rows);
        const prevRows = previous.get(section.key)?.rows || [];
        const prev = period.prevRows && prevRows.some(activity) ? metrics.summarize(prevRows) : null;
        const noun = section.noun || (metrics.objectives(rows)[0]?.resultLabel || 'resultados').toLowerCase();
        return { ...section, noun, rows, cur, prev, ads: bestAds(rows), resultChange: prev ? change(cur.results, prev.results) : null };
      })
      .filter(section => activity(section.cur))
      .sort((left, right) => order(left.key) - order(right.key) || right.cur.spend - left.cur.spend);

    const overall = metrics.summarize(period.rows);
    const prevOverall = period.prevRows ? metrics.summarize(period.prevRows) : null;
    const messages = sections.find(section => section.key === 'mensajes');
    // Como en el modelo: el resultado y el alcance de la cuenta son la suma de los de cada objetivo.
    const totals = {
      spend: overall.spend,
      results: sections.reduce((sum, section) => sum + section.cur.results, 0),
      reach: overall.reach,
      impressions: overall.impressions,
    };
    const prevTotals = prevOverall ? {
      spend: prevOverall.spend,
      results: prevOverall.results,
      reach: prevOverall.reach,
      impressions: prevOverall.impressions,
    } : null;
    return { period, labels: period.labels, sections, totals, prevTotals, messages };
  }

  // ── Textos propuestos (el equipo los reescribe sobre la lamina) ─────────
  function trend(value) {
    if (Math.abs(value) < 5) return 'se mantuvo casi igual';
    return value > 0 ? 'creció' : 'bajó';
  }

  function suggestLectura(report) {
    const { totals, prevTotals, sections, labels } = report;
    if (!prevTotals) return `No hay ${labels.prevRef || 'período anterior'} con datos para comparar. El detalle por objetivo está en las siguientes páginas.`;
    const parts = [];
    const spendChange = change(totals.spend, prevTotals.spend);
    const resultsChange = change(totals.results, prevTotals.results);
    if (spendChange != null && resultsChange != null) {
      parts.push(`Con ${spendChange < 0 ? 'menos' : 'más'} inversión (${pct(spendChange)}), los resultados ${resultsChange < 0 ? 'bajaron' : 'subieron'} ${pct(resultsChange)} frente a ${labels.prevRef}.`);
    }
    const compared = sections.filter(section => section.resultChange != null).sort((left, right) => right.resultChange - left.resultChange);
    if (compared.length) {
      const [best, ...rest] = compared;
      const costChange = change(best.cur.costPerResult, best.prev.costPerResult);
      let sentence = `${best.short} ${trend(best.resultChange)} (${pct(best.resultChange)})`;
      if (costChange != null) sentence += ` y ${costChange <= 0 ? 'mejoró' : 'encareció'} su costo (${pct(costChange)})`;
      if (rest.length) sentence += `; ${list(rest.map(section => `${section.short.toLowerCase()} (${pct(section.resultChange)})`))} ${rest.length > 1 ? 'quedaron' : 'quedó'} por debajo`;
      parts.push(`${sentence}.`);
    }
    parts.push('El detalle por objetivo está en las siguientes páginas.');
    return parts.join(' ');
  }

  function suggestAnalysis(section, labels) {
    const { cur, prev, noun } = section;
    const best = section.ads[0];
    if (!prev) {
      return `**Qué pasó:** ${section.short.toLowerCase()} no tuvo entrega en ${labels.prevRef || 'el período anterior'}; ahora invirtió ${money(cur.spend)} y logró ${num(cur.results)} ${noun} a ${cost(cur.costPerResult)} cada una.${best ? ` El anuncio con más ${noun} fue "${best.name}".` : ''}`;
    }
    const spendChange = change(cur.spend, prev.spend);
    const resultsChange = change(cur.results, prev.results);
    const costChange = change(cur.costPerResult, prev.costPerResult);
    const what = `**Qué pasó:** la inversión ${spendChange == null || spendChange >= 0 ? 'subió' : 'bajó'} de ${money(prev.spend)} a ${money(cur.spend)}${spendChange == null ? '' : ` (${pct(spendChange)})`} y las ${noun} ${resultsChange == null || resultsChange >= 0 ? 'subieron' : 'bajaron'}${resultsChange == null ? '' : ` ${pct(resultsChange)}`}.`;
    let why;
    if (spendChange != null && resultsChange != null && Math.abs(spendChange) >= 15 && Math.sign(spendChange) === Math.sign(resultsChange) && (costChange == null || Math.abs(costChange) < 25)) {
      why = `**Qué lo ocasionó:** el volumen siguió a la inversión: el CPM pasó de ${money2(prev.cpm)} a ${money2(cur.cpm)} y el costo por resultado quedó en ${cost(cur.costPerResult)}${costChange == null ? '' : ` (${pct(costChange)})`}.`;
    } else if (costChange != null && costChange <= -10) {
      why = `**Qué lo ocasionó:** cada resultado salió ${Math.abs(Math.round(costChange))}% más barato (${cost(prev.costPerResult)} → ${cost(cur.costPerResult)})${best ? `; el anuncio más fuerte fue "${best.name}" con ${num(best.results)} ${noun}` : ''}.`;
    } else if (costChange != null && costChange >= 10) {
      why = `**Qué lo ocasionó:** cada resultado costó ${Math.round(costChange)}% más (${cost(prev.costPerResult)} → ${cost(cur.costPerResult)}), con CPM de ${money2(cur.cpm)} y frecuencia de ${finite(cur.frequency) ? cur.frequency.toFixed(2) : '—'}.${cur.frequency >= 1.2 ? ' **Acción:** renovar las piezas para frenar el desgaste del creativo.' : ''}`;
    } else {
      why = `**Qué lo ocasionó:** el costo por resultado se mantuvo estable (${cost(prev.costPerResult)} → ${cost(cur.costPerResult)}).`;
    }
    return `${what} ${why}`;
  }

  function suggestConclusion(section) {
    const { cur, prev, noun } = section;
    const best = section.ads[0];
    const bestLine = best ? ` "${best.name}" es el anuncio más fuerte (${num(best.results)} ${noun}).` : '';
    if (!prev) return { title: `${section.short} arranca`, text: `Primer período con entrega: ${num(cur.results)} ${noun} a ${cost(cur.costPerResult)}.${bestLine}` };
    const resultsChange = change(cur.results, prev.results) ?? 0;
    const spendChange = change(cur.spend, prev.spend) ?? 0;
    const costChange = change(cur.costPerResult, prev.costPerResult);
    const costLine = costChange == null ? '' : ` y su costo por resultado ${costChange <= 0 ? 'bajó' : 'subió'} (${pct(costChange)})`;
    if (resultsChange > -5) {
      return {
        title: `${section.short} ${resultsChange >= 5 ? 'crece' : 'se mantiene'}`,
        text: `Con ${spendChange < 0 ? 'menos' : 'más'} inversión (${pct(spendChange)}), las ${noun} ${resultsChange >= 0 ? 'subieron' : 'casi no cayeron'} (${pct(resultsChange)})${costLine}.${bestLine}`,
      };
    }
    if (spendChange <= -15) {
      return {
        title: `Sostener ${section.short.toLowerCase()}`,
        text: `${section.short} cayó ${pct(resultsChange)} al reducir su inversión (${pct(spendChange)}). Mantener una base de inversión que sostenga el alcance y el resto del embudo.`,
      };
    }
    return {
      title: `Recuperar ${section.short.toLowerCase()}`,
      text: `Las ${noun} bajaron ${pct(resultsChange)}${costLine}. Conviene renovar los anuncios con piezas nuevas para recuperar el volumen.`,
    };
  }

  // ── Textos guardados por periodo ───────────────────────────────────────
  function readNotes() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(CONFIG.notesKey) || '{}');
      return saved && typeof saved === 'object' ? saved : {};
    } catch {
      return {};
    }
  }

  function writeNotes(notes) {
    try {
      window.localStorage.setItem(CONFIG.notesKey, JSON.stringify(notes));
    } catch {
      // Sin localStorage el texto dura hasta recargar; el PDF se descarga igual.
    }
  }

  function saveNote(periodId, key, value) {
    const notes = readNotes();
    notes[periodId] = { ...(notes[periodId] || {}), [key]: value };
    writeNotes(notes);
  }

  function resetNotes(periodId) {
    const notes = readNotes();
    delete notes[periodId];
    writeNotes(notes);
  }

  // **texto** va en negrita, como "Qué pasó:" en el modelo.
  const rich = text => api().esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

  // Texto editable sobre la lamina: al hacer clic se ve el texto con sus ** y al salir vuelve a negrita.
  function editable(key, text, tag = 'p', className = '') {
    return `<${tag} class="rp-edit ${className}" data-note="${api().esc(key)}" data-raw="${api().esc(text)}" title="Clic para editar · **texto** va en negrita">${rich(text)}</${tag}>`;
  }

  // ── Piezas de las laminas ──────────────────────────────────────────────
  function deltaHtml(current, previous, labels, { inverse = false } = {}) {
    if (!labels.prevTag) return '';
    const value = previous == null ? null : change(current, previous);
    if (value == null) return `<span class="rp-delta muted">Sin datos en ${api().esc(labels.prevTag)}</span>`;
    return `<span class="rp-delta ${trendClass(value, inverse)}">${arrow(value)}${pct(value)} vs ${api().esc(labels.prevTag)}</span>`;
  }

  const kpi = (label, value, foot) => `
    <div class="rp-card rp-kpi">
      <span class="rp-kpi-label">${api().esc(label)}</span>
      <strong>${value}</strong>
      ${foot}
    </div>`;

  const note = text => `<span class="rp-delta muted">${api().esc(text)}</span>`;

  function footer(left, report, page, total) {
    const { esc } = api();
    return `
      <footer class="rp-foot">
        <span>${esc(left)}</span>
        <span class="rp-foot-right"><img src="${LOGO}" alt=""><b>Lima Retail</b>${esc(report.labels.footer)} · ${pageNumber(page)} / ${pageNumber(total)}</span>
      </footer>`;
  }

  const head = (title, sub) => `<header class="rp-head"><h2>${api().esc(title)}</h2><p>${api().esc(sub)}</p></header>`;

  function insight(label, key, text) {
    return `
      <div class="rp-insight">
        <span class="rp-insight-icon">${icon('pulse')}</span>
        <div>
          <span class="rp-insight-label">${label}</span>
          ${editable(key, text)}
        </div>
      </div>`;
  }

  // Barras del resultado: periodo anterior en gris y el actual en rojo, con el valor encima.
  function barChart(section, labels) {
    const { esc } = api();
    const current = section.cur.results;
    const previous = section.prev ? section.prev.results : null;
    const top = 50;
    const bottom = 178;
    const left = 46;
    const right = 600;
    const max = Math.max(current, previous || 0) * 1.25 || 1;
    const y = value => bottom - (value / max) * (bottom - top);
    const grid = [0, 1 / 3, 2 / 3, 1].map(step => {
      const value = max * step;
      return `<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" class="rp-grid"/><text x="${left - 6}" y="${y(value) + 3}" text-anchor="end" class="rp-tick">${step ? compact(value) : 0}</text>`;
    }).join('');
    const bar = (value, center, className, label) => {
      if (value == null) return `<text x="${center}" y="${bottom - 8}" text-anchor="middle" class="rp-bar-value prev">Sin datos</text><text x="${center}" y="${bottom + 15}" text-anchor="middle" class="rp-axis">${esc(label)}</text>`;
      const height = Math.max(bottom - y(value), value > 0 ? 2 : 0);
      return `
        <rect x="${center - 76}" y="${bottom - height}" width="152" height="${height}" rx="3" class="rp-bar ${className}"/>
        <text x="${center}" y="${bottom - height - 8}" text-anchor="middle" class="rp-bar-value ${className}">${compact(value)}</text>
        <text x="${center}" y="${bottom + 15}" text-anchor="middle" class="rp-axis">${esc(label)}</text>`;
    };
    return `
      <svg class="rp-chart" viewBox="0 0 620 196" role="img" aria-label="${esc(section.short)}: ${esc(labels.barPrev || '')} ${previous == null ? '' : num(previous)} vs ${esc(labels.barCur)} ${num(current)}">
        <text x="${left}" y="14" class="rp-chart-title">${esc(section.short)} · resultados</text>
        <text x="${left}" y="27" class="rp-chart-sub">${esc(labels.chartRange)} (${esc(section.noun)})</text>
        ${grid}
        ${labels.prevTag ? bar(previous, left + (right - left) * .25, 'prev', labels.barPrev) : ''}
        ${bar(current, left + (right - left) * (labels.prevTag ? .75 : .5), 'cur', labels.barCur)}
      </svg>`;
  }

  function adsTable(section) {
    const { esc, safeUrl } = api();
    if (!section.ads.length) return '<p class="rp-empty">Sin anuncios con entrega en el período.</p>';
    return `
      <table class="rp-table rp-ads">
        <colgroup><col><col style="width:16%"><col style="width:27%"><col style="width:13%"></colgroup>
        <thead><tr><th>Anuncio</th><th class="num">Gasto</th><th class="num">${esc(section.noun)}</th><th class="num">Ver</th></tr></thead>
        <tbody>${section.ads.map((ad, index) => {
          const url = safeUrl(ad.preview);
          return `<tr${index === 0 ? ' class="rp-top"' : ''}><td class="rp-name" title="${esc(ad.name)}">${esc(ad.name)}</td><td class="num">${money(ad.spend)}</td><td class="num">${num(ad.results)}</td><td class="num">${url ? `<a href="${url}" target="_blank" rel="noopener">Ver »</a>` : '—'}</td></tr>`;
        }).join('')}</tbody>
      </table>`;
  }

  // ── Laminas ────────────────────────────────────────────────────────────
  function coverPage(report) {
    const { esc } = api();
    return `
      <section class="rp-page rp-cover">
        <div class="rp-brand"><img src="${LOGO}" alt="Lima Retail"><div><b>Lima Retail</b><span>Data Driven Marketing</span></div></div>
        <div class="rp-cover-body">
          <h1>Reporte de Publicidad</h1>
          <p class="rp-cover-client">Cliente: <b>${esc(brandName())}</b></p>
          <p class="rp-cover-period">${esc(report.labels.cover)}&nbsp; | &nbsp;Meta Ads</p>
        </div>
        <footer class="rp-foot">
          <span>${AGENCY_LINE}</span>
          <span class="rp-foot-right"><img src="${LOGO}" alt=""><b>Lima Retail</b>Emitido el ${esc(issuedLabel())}</span>
        </footer>
      </section>`;
  }

  function contentsPage(report, pages, total) {
    const { esc } = api();
    const items = [
      { title: 'Comparativa', desc: report.labels.compDesc, icon: 'chart', page: pages.comparison },
      ...report.sections.map((section, index) => ({ title: section.short, desc: 'KPIs, comparación y mejores anuncios.', icon: section.icon, page: pages.firstSection + index })),
      { title: 'Conclusiones', desc: 'Evolución y prioridades.', icon: 'flag', page: pages.conclusions },
    ];
    return `
      <section class="rp-page">
        ${head('Contenido del reporte', report.labels.contentsSub)}
        <div class="rp-body rp-contents">
          ${items.map((item, index) => `
            <div class="rp-card rp-toc">
              <div class="rp-toc-top"><span class="rp-icon">${icon(item.icon)}</span><span class="rp-toc-num">${pageNumber(index + 1)}</span></div>
              <h3>${esc(item.title)}</h3>
              <p>${esc(item.desc)}</p>
              <span class="rp-toc-page">Página ${pageNumber(item.page)}</span>
            </div>`).join('')}
        </div>
        ${footer(report.labels.source, report, 2, total)}
      </section>`;
  }

  function comparisonPage(report, notes, page, total) {
    const { esc } = api();
    const { labels, totals, prevTotals, sections, messages } = report;
    const fourth = messages
      ? kpi('Conversaciones', num(messages.cur.results), deltaHtml(messages.cur.results, messages.prev ? messages.prev.results : null, labels))
      : kpi('Impresiones', num(totals.impressions), deltaHtml(totals.impressions, prevTotals?.impressions, labels));
    const ranked = sections.filter(section => section.resultChange != null);
    const leader = ranked.length > 1 ? ranked.reduce((best, section) => (section.resultChange > best.resultChange ? section : best)) : null;
    const rows = sections.map(section => `
      <tr${section === leader ? ' class="rp-top"' : ''}>
        <td class="rp-name">${esc(section.short)}</td>
        ${labels.prevTag ? `<td class="num">${section.prev ? num(section.prev.results) : '—'}</td>` : ''}
        <td class="num"><b>${num(section.cur.results)}</b></td>
        ${labels.prevTag ? `<td class="num">${section.resultChange == null ? '<span class="rp-delta muted">Nuevo</span>' : `<span class="rp-delta ${trendClass(section.resultChange)}">${arrow(section.resultChange)}${pct(section.resultChange)}</span>`}</td>` : ''}
        <td class="num">${cost(section.cur.costPerResult)}</td>
      </tr>`).join('');
    const lectura = notes.lectura != null ? notes.lectura : suggestLectura(report);
    return `
      <section class="rp-page">
        ${head(labels.compTitle, labels.compSub)}
        <div class="rp-body">
          <div class="rp-grid-4">
            ${kpi('Inversión', money(totals.spend), deltaHtml(totals.spend, prevTotals?.spend, labels))}
            ${kpi('Resultados', num(totals.results), deltaHtml(totals.results, prevTotals?.results, labels))}
            ${kpi('Alcance', num(totals.reach), deltaHtml(totals.reach, prevTotals?.reach, labels))}
            ${fourth}
          </div>
          <div class="rp-card rp-table-card">
            <div class="rp-card-title">Resultados por objetivo · ${esc(labels.versus)}</div>
            <table class="rp-table">
              <thead><tr><th>Objetivo</th>${labels.prevTag ? `<th class="num">${esc(labels.prevTag)}</th>` : ''}<th class="num">${esc(labels.curTag)}</th>${labels.prevTag ? '<th class="num">Variación</th>' : ''}<th class="num">Costo/result. ${esc(labels.curTag)}</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
            <div class="rp-table-foot">Inversión total: ${money(totals.spend)} (${esc(labels.curTag)})${prevTotals ? ` vs ${money(prevTotals.spend)} (${esc(labels.prevTag)})` : ''}.</div>
          </div>
          ${insight('Lectura', 'lectura', lectura)}
        </div>
        ${footer(labels.source, report, page, total)}
      </section>`;
  }

  function sectionPage(section, report, notes, page, total) {
    const { labels } = report;
    const { cur, prev } = section;
    const key = `analisis:${section.key}`;
    const analysis = notes[key] != null ? notes[key] : suggestAnalysis(section, labels);
    return `
      <section class="rp-page">
        ${head(section.title, labels.sectionSub)}
        <div class="rp-body">
          <div class="rp-grid-3">
            ${kpi('Inversión', money(cur.spend), deltaHtml(cur.spend, prev?.spend, labels))}
            ${kpi(section.key === 'mensajes' ? 'Conversaciones' : 'Resultados', num(cur.results), deltaHtml(cur.results, prev?.results, labels))}
            ${kpi('Costo/result.', cost(cur.costPerResult), deltaHtml(cur.costPerResult, prev?.costPerResult, labels, { inverse: true }))}
            ${kpi('CPM', money2(cur.cpm), deltaHtml(cur.cpm, prev?.cpm, labels, { inverse: true }))}
            ${kpi('Alcance', num(cur.reach), note('Personas únicas'))}
            ${kpi('Frecuencia', finite(cur.frequency) ? cur.frequency.toFixed(2) : '—', note('Impr. ÷ alcance'))}
          </div>
          <div class="rp-split">
            <div class="rp-card rp-chart-card">
              <div class="rp-card-title">Resultados: ${api().esc(labels.prevTag ? `${labels.curTag} vs ${labels.prevTag}` : labels.curTag)}</div>
              <div class="rp-card-sub">${api().esc(labels.chartSub)}</div>
              ${barChart(section, labels)}
            </div>
            <div class="rp-card rp-table-card">
              <div class="rp-card-title">Mejores anuncios</div>
              ${adsTable(section)}
            </div>
          </div>
          ${insight('Análisis', key, analysis)}
        </div>
        ${footer(labels.source, report, page, total)}
      </section>`;
  }

  function conclusionsPage(report, notes, page, total) {
    const { labels } = report;
    // Una conclusion por objetivo, los tres con mas inversion, en el orden del reporte.
    const picked = [...report.sections].sort((left, right) => right.cur.spend - left.cur.spend).slice(0, 3);
    const cards = report.sections.filter(section => picked.includes(section)).map((section, index) => {
      const suggested = suggestConclusion(section);
      const title = notes[`concl:${index}:title`] != null ? notes[`concl:${index}:title`] : suggested.title;
      const text = notes[`concl:${index}:text`] != null ? notes[`concl:${index}:text`] : suggested.text;
      return `
        <div class="rp-card rp-conclusion">
          <div class="rp-toc-top"><span class="rp-icon framed">${icon(section.icon)}</span><span class="rp-concl-num">${pageNumber(index + 1)}</span></div>
          ${editable(`concl:${index}:title`, title, 'h3')}
          ${editable(`concl:${index}:text`, text)}
        </div>`;
    }).join('');
    return `
      <section class="rp-page">
        ${head('Conclusiones', labels.conclusionsSub)}
        <div class="rp-body">
          <div class="rp-grid-3 rp-conclusions">${cards}</div>
          ${labels.windowNote ? `<div class="rp-note">${rich(labels.windowNote)}</div>` : ''}
        </div>
        ${footer(labels.conclusionsSource, report, page, total)}
      </section>`;
  }

  function closingPage() {
    return `
      <section class="rp-page rp-closing">
        <img src="${LOGO}" alt="Lima Retail">
        <b>Lima Retail</b>
        <span class="rp-closing-tag">Data Driven Marketing</span>
        <span>Power KPI · Digital Analytics</span>
      </section>`;
  }

  // ── Pintado ────────────────────────────────────────────────────────────
  function periods() {
    return [...monthPeriods(), ...weekPeriods()];
  }

  function fitDeck() {
    const host = document.getElementById('week-report');
    if (!host || !host.clientWidth) return;
    host.style.setProperty('--rp-scale', String(Math.min(1, host.clientWidth / PAGE_WIDTH)));
  }

  function wireEditables(host, periodId) {
    host.querySelectorAll('[data-note]').forEach(node => {
      try {
        node.contentEditable = 'plaintext-only';
      } catch {
        node.contentEditable = 'true';
      }
      node.spellcheck = false;
      node.addEventListener('focus', () => { node.textContent = node.dataset.raw; });
      node.addEventListener('input', () => {
        node.dataset.raw = node.innerText.replace(/\n+$/, '');
        saveNote(periodId, node.dataset.note, node.dataset.raw);
      });
      node.addEventListener('blur', () => { node.innerHTML = rich(node.dataset.raw); });
    });
  }

  function render() {
    const host = document.getElementById('week-report');
    if (!host || !api()) return;
    const { esc } = api();

    const available = periods();
    const select = document.getElementById('week-select');
    if (!available.length) {
      if (select) select.innerHTML = '<option value="">Sin periodos con datos</option>';
      host.innerHTML = '<div class="panel"><div class="empty-state"><strong>Todavia no hay datos para el reporte</strong><span>El reporte se arma con las descargas de Meta Ads de la carpeta de Drive. En cuanto haya un mes o una semana con entregas, aparece aqui.</span></div></div>';
      return;
    }

    if (!available.some(period => period.id === selectedPeriod)) selectedPeriod = available[0].id;
    const period = available.find(item => item.id === selectedPeriod);

    if (select) {
      const options = kind => available.filter(item => item.id.startsWith(kind))
        .map(item => `<option value="${esc(item.id)}"${item.id === selectedPeriod ? ' selected' : ''}>${esc(item.option)}</option>`).join('');
      select.innerHTML = `<optgroup label="Mes contra el mes anterior">${options('m:')}</optgroup><optgroup label="Semana de lunes a domingo">${options('w:')}</optgroup>`;
    }

    const model = modelReport();
    const modelHost = document.getElementById('week-model');
    if (modelHost) {
      modelHost.innerHTML = model
        ? `Modelo: <a href="https://drive.google.com/file/d/${esc(model.id)}/view" target="_blank" rel="noopener">${esc(model.title)}</a>`
        : 'Modelo: el ultimo reporte de la carpeta Reportes de Drive';
    }

    const report = buildReport(period);
    const notes = readNotes()[period.id] || {};
    const pages = { comparison: 3, firstSection: 4, conclusions: 4 + report.sections.length };
    const total = pages.conclusions + 1;
    host.innerHTML = `
      ${period.missingDays.length ? `<div class="week-warning">La descarga de Meta llega hasta el ${esc(dayLabel(period.dataEnd))}: ${esc(period.missingDays.map(dayLabel).join(', '))} todavia no estan en la hoja del mes, asi que los totales pueden subir.</div>` : ''}
      <div class="rp-deck" id="week-doc">
        ${coverPage(report)}
        ${contentsPage(report, pages, total)}
        ${comparisonPage(report, notes, pages.comparison, total)}
        ${report.sections.map((section, index) => sectionPage(section, report, notes, pages.firstSection + index, total)).join('')}
        ${conclusionsPage(report, notes, pages.conclusions, total)}
        ${closingPage()}
      </div>`;

    fitDeck();
    wireEditables(host, period.id);
  }

  // El ultimo PDF de la carpeta Reportes: se enlaza arriba como referencia del diseño.
  function modelReport() {
    const files = (api()?.snapshot()?.reports?.files || [])
      .filter(file => file.mimeType === 'application/pdf')
      .sort((left, right) => String(right.modifiedTime || '').localeCompare(String(left.modifiedTime || '')));
    return files.find(file => /reporte|meta.?ads/i.test(file.title || '')) || files[0] || null;
  }

  // El nombre del PDF lo pone el navegador con el titulo del documento: se cambia solo mientras imprime.
  function printReport() {
    const period = periods().find(item => item.id === selectedPeriod);
    if (!period) return;
    document.activeElement?.blur?.();
    const title = document.title;
    document.title = `Reporte_${brandSlug()}_${period.labels.file}`;
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
      selectedPeriod = event.target.value;
      render();
    });
    document.getElementById('week-print')?.addEventListener('click', printReport);
    document.getElementById('week-reset')?.addEventListener('click', () => {
      if (!selectedPeriod || !window.confirm('Se reemplazan la lectura, los analisis y las conclusiones de este periodo por los textos propuestos. ¿Continuar?')) return;
      resetNotes(selectedPeriod);
      render();
    });
    const host = document.getElementById('week-report');
    if (host && typeof window.ResizeObserver === 'function') {
      resizeObserver = new window.ResizeObserver(fitDeck);
      resizeObserver.observe(host);
    }
    // El barrido se relee al abrir el tablero y con Actualizar: si los numeros cambian, el reporte se repinta.
    window.addEventListener(CONFIG.updatedEvent, () => {
      if (document.getElementById('view-week')?.classList.contains('visible')) render();
    });
  }

  window.ReporteSemanal = { init };
})();
