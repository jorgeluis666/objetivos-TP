(function () {
  // Generacion de Reporte: el PDF de publicidad con el diseño del modelo de la agencia ("Modelo Reporte
  // Terminal Pesquero"): laminas 16:9 con portada, contenido, comparativa, una pagina por objetivo,
  // conclusiones y cierre. No trae datos nuevos: usa las mismas filas del barrido de Meta que ya tiene el
  // tablero (<Marca>Data.snapshot(), una fila por dia, campaña, conjunto y anuncio).
  //
  // Se elige el mes arriba y el reporte lo compara con el mismo tramo del mes anterior ("Octubre (1–18) vs
  // Septiembre (1–18)", como el modelo). La lectura, el analisis de cada objetivo y las conclusiones vienen
  // propuestos con lo que dicen los numeros; el equipo los reescribe sobre la misma lamina y quedan
  // guardados por mes en este navegador.
  //
  // El template es propio de Terminal Pesquero: cada tablero de marca tiene el suyo, adaptado por la marca.
  const CONFIG = {
    brand: 'Terminal Pesquero',
    slug: 'Terminal-Pesquero',
    data: () => window.TPData,
    updatedEvent: 'tp:data-updated',
    notesKey: 'tp-report-notes-v2',
  };

  const MAX_ADS = 4;
  const PAGE_WIDTH = 1280;
  const LOGO = 'assets/logo-lima-retail.png';
  const AGENCY_LINE = 'Lima Retail · Data Driven Marketing · Power KPI · Digital Analytics';

  // Cada objetivo del barrido va a una seccion del reporte, en el orden del embudo y con el nombre, el
  // resultado y el costo que usa el modelo. Las dos campañas de WhatsApp van separadas, como alli:
  // Pedidos cuenta contactos y Mensajes conversaciones, y sus costos no son comparables entre si.
  // El orden importa dos veces: ordena las laminas y decide que patron gana (pedidos antes que el
  // /whatsapp/ generico).
  const SECTIONS = [
    { key: 'reconocimiento', match: /notoriedad|thruplay|reconoc/, title: 'Reconocimiento', short: 'Reconocimiento', noun: 'ThruPlays', one: 'ThruPlay', fem: false, toc: 'ThruPlays, evolución, conjuntos y mejores anuncios.', icon: 'play' },
    { key: 'trafico-ig', match: /trafico-ig|perfil/, title: 'Tráfico al perfil', short: 'Tráfico al perfil', noun: 'visitas al perfil', one: 'visita', fem: true, toc: 'Visitas al perfil, conjuntos y mejores anuncios.', icon: 'pointer' },
    { key: 'interaccion', match: /interacc/, title: 'Interacción', short: 'Interacción', noun: 'interacciones', one: 'interacción', fem: true, toc: 'Interacciones, evolución, formatos y mejores anuncios.', icon: 'heart' },
    { key: 'trafico-web', match: /trafico-web/, title: 'Tráfico web', short: 'Tráfico web', noun: 'visitas a la web', one: 'visita', fem: true, toc: 'Visitas a la web, conjuntos y mejores anuncios.', icon: 'globe' },
    { key: 'pedidos', match: /pedidos/, title: 'Pedidos WhatsApp', short: 'Pedidos WhatsApp', noun: 'contactos', one: 'contacto', fem: false, toc: 'Contactos de pedidos, conjuntos y anuncios.', icon: 'chat' },
    { key: 'mensajes', match: /whatsapp|mensaje/, title: 'Mensajes WhatsApp', short: 'Mensajes WhatsApp', noun: 'conversaciones', one: 'conversación', fem: true, toc: 'Conversaciones iniciadas, conjuntos y formatos.', icon: 'chat' },
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
  const cap = value => String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1);

  // ── Formatos ("S/. 685", "S/. 0.0063", "66,692", "−36%"): la moneda y los miles como en el resto del tablero ──
  const integer = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
  // Montos con separador de miles es-PE y decimales fijos (un Intl.NumberFormat por cantidad de decimales).
  const decimalFormats = new Map();
  const decimals = (value, digits) => {
    if (!decimalFormats.has(digits)) decimalFormats.set(digits, new Intl.NumberFormat('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits }));
    return decimalFormats.get(digits).format(Number(value));
  };
  const finite = value => value != null && Number.isFinite(Number(value));
  const num = value => (finite(value) ? integer.format(Math.round(value)) : '—');
  const money = value => (finite(value) ? `S/. ${integer.format(Math.round(value))}` : '—');
  const money2 = value => (finite(value) ? `S/. ${decimals(value, 2)}` : '—');
  // Los costos por resultado de branding son centavos: bajo S/. 1 van con cuatro decimales.
  const cost = value => (finite(value) && value > 0 ? `S/. ${decimals(value, value < 1 ? 4 : 2)}` : '—');
  const pct = value => (Math.round(value) === 0 ? '0%' : `${value > 0 ? '+' : '−'}${Math.abs(Math.round(value))}%`);
  // Flecha y color de una variacion; la que redondea a 0% va sin flecha y en gris.
  const trendClass = (value, inverse) => (Math.round(value) === 0 ? 'muted' : (inverse ? value < 0 : value > 0) ? 'good' : 'bad');
  const arrow = value => (Math.round(value) === 0 ? '' : `${value > 0 ? '▲' : '▼'}&nbsp; `);
  const compact = value => (value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1000 ? `${(value / 1000).toFixed(1)}k` : integer.format(Math.round(value)));
  const pageNumber = value => String(value).padStart(2, '0');
  const list = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}` : items[0] || '');
  const change = (current, previous) => api().metrics.change(current, previous);

  // La diferencia en valores absolutos que acompaña a cada variacion: "+37,088", "−S/. 49",
  // "−S/. 0.0049". Un costo lleva los decimales del mayor de los dos valores, como cost().
  function absDiff(current, previous, kind = 'num') {
    if (!finite(current) || !finite(previous)) return '';
    const value = Number(current) - Number(previous);
    const size = Math.abs(value);
    let text;
    if (kind === 'cost') text = `S/. ${decimals(size, Math.max(Math.abs(current), Math.abs(previous)) < 1 ? 4 : 2)}`;
    else if (kind === 'money2') text = `S/. ${decimals(size, 2)}`;
    else if (kind === 'money') text = `S/. ${integer.format(Math.round(size))}`;
    else text = integer.format(Math.round(size));
    // Lo que redondea a cero va sin signo ("S/. 0", no "−S/. 0").
    const sign = /[1-9]/.test(text) ? (value > 0 ? '+' : '−') : '';
    return `${sign}${text}`;
  }

  // "+49%, +37,088": la variacion porcentual con su diferencia absoluta.
  const pctAbs = (current, previous, kind) => {
    const value = change(current, previous);
    if (value == null) return '';
    const abs = absDiff(current, previous, kind);
    return abs ? `${pct(value)}, ${abs}` : pct(value);
  };

  // ── Fechas en hora de Lima ─────────────────────────────────────────────
  const pad = value => String(value).padStart(2, '0');
  const isoOf = (year, month, day) => `${year}-${pad(month)}-${pad(day)}`;

  function todayIso() {
    const { year, month, day } = api().limaParts(new Date());
    return isoOf(year, month + 1, day);
  }

  function issuedLabel() {
    const [year, month, day] = todayIso().split('-');
    return `${Number(day)} ${api().SHORT_MONTHS[Number(month) - 1].toLowerCase()}. ${year}`;
  }

  // ── Meses del selector ─────────────────────────────────────────────────
  const activity = row => Number(row.spend) > 0 || Number(row.impressions) > 0;

  // Un mes, o un tramo acumulado suyo, contra el mismo tramo de dias del mes anterior. El periodo
  // base es el que ya usa Gasto publicitario (metrics.period: el mes en curso hasta el ultimo dia
  // con datos, un mes cerrado completo).
  function monthPeriods() {
    const { metrics } = api();
    return (api().snapshot()?.months || [])
      .filter(month => month.hasData && !month.error)
      .reverse()
      .flatMap(month => {
        const period = metrics.period(month);
        if (!period) return [];
        // El primer mes con datos empieza el dia que arranco la pauta (Junio, desde el 15).
        const from = Math.max(period.from, month.firstDay || 1);
        return cutsOf(month, from, period.to)
          .map(to => cutPeriod(month, period, from, to))
          .filter(Boolean)
          .reverse();
      });
  }

  // Los cortes de un mes: cada domingo, que es el cierre de semana, y el ultimo dia con datos si no
  // cae en domingo. Siempre acumulados desde el primer dia: en octubre de 2026 salen 1–4, 1–11,
  // 1–18 y 1–25. Cada uno se compara con el mismo tramo de dias del mes anterior.
  function cutsOf(month, from, last) {
    const cuts = [];
    for (let day = from; day <= last; day += 1) {
      if (new Date(month.year, month.month - 1, day).getDay() === 0) cuts.push(day);
    }
    if (!cuts.length || cuts[cuts.length - 1] !== last) cuts.push(last);
    return cuts;
  }

  const diaIso = (month, day) => `${month.year}-${String(month.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const ventanaIso = (month, from, to) => `${diaIso(month, from)}..${diaIso(month, to)}`;

  function cutPeriod(month, period, from, to) {
    const rows = month.rows.filter(row => row.d >= from && row.d <= to);
    if (!rows.some(activity)) return null;
    const compare = period.compare;
    const prevFrom = compare ? Math.max(compare.from, compare.month.firstDay || 1) : 1;
    const prevTo = compare ? Math.min(to, compare.month.daysInMonth) : 0;
    const prevRows = compare ? compare.month.rows.filter(row => row.d >= prevFrom && row.d <= prevTo) : null;
    // Sin entregas en el mismo tramo del mes anterior no hay con que comparar: el corte va solo.
    const prev = prevRows && prevRows.some(activity) ? compare : null;
    {
      const range = `${from}–${to}`;
      const prevRange = prev ? `${prevFrom}–${prevTo}` : '';
      const cur = month.name;
      const before = prev ? prev.month.name : '';
      const curTag = month.shortName.toLowerCase();
      const prevTag = prev ? prev.month.shortName.toLowerCase() : '';
      const same = prev && range === prevRange;
      const whole = to === period.to;
      return {
        id: `m:${month.key}:${to}`,
        group: `${cur} ${month.year}`,
        option: `${range}${whole ? ' · hasta el último día' : ''}${prev ? ` vs ${before} ${prevRange}` : ''}`,
        rows,
        prevRows: prev ? prevRows : null,
        // Los dias del corte y los del tramo equivalente del mes anterior, para el acumulado diario. Los
        // cierres de semana (cutsOf) son los dias que el grafico etiqueta a lo largo del periodo.
        span: { from, to, prevFrom: prev ? prevFrom : null, prevTo: prev ? prevTo : null, cuts: cutsOf(month, from, to) },
        // La ventana en fechas, que es como la hoja de alcance unico identifica cada medicion.
        ventana: ventanaIso(month, from, to),
        ventanaPrev: prev ? ventanaIso(prev.month, prevFrom, prevTo) : '',
          labels: {
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
            chartSub: `Acumulado del día ${from} al ${to} de cada mes, con la cifra al cierre de cada semana.`,
            chartRange: prev ? `${prevFrom}-${prevTo} ${before.toLowerCase()} vs ${from}-${to} ${cur.toLowerCase()}` : `${from}-${to} ${cur.toLowerCase()}`,
            source: `Fuente: Meta Ads · ${curTag} ${range}${prev ? ` vs ${prevTag} ${prevRange}` : ''}, ${month.year}`,
            footer: `${brandName()} · Reporte Meta Ads · ${prev ? `${cur} vs ${before}` : `${cur} ${month.year}`}`,
            contentsSub: 'Qué encontrarás en cada sección de este informe mensual.',
            conclusionsSub: 'Cómo evolucionó frente al mes anterior y qué priorizar.',
            conclusionsSource: `Fuente: análisis Lima Retail · ${brandName()} · ${cur.toLowerCase()} ${month.year}`,
            windowNote: prev && same
              ? `**Comparación de ventanas equivalentes:** ${cur.toLowerCase()} y ${before.toLowerCase()}, ambos del ${from} al ${to}. Las variaciones son indicativas del ritmo.`
              : '',
            file: `${cur}${month.year}_${from}-${to}`,
          },
      };
    }
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

  // Todos los anuncios de una seccion, de mas a menos resultados. Un anuncio es su nombre dentro de la
  // seccion: si la misma pieza corre en las dos campañas de WhatsApp, se suma. Cada uno lleva su pieza
  // de "06 Artes", su formato y su parte de la inversion, que es lo que el analisis compara.
  function adStats(rows, section) {
    const byName = new Map();
    api().metrics.ads(rows || []).forEach(ad => {
      const key = normalize(ad.ad);
      const hit = byName.get(key);
      if (!hit) {
        byName.set(key, {
          key, name: ad.ad, spend: ad.spend, results: ad.results, impressions: ad.impressions,
          // El primer dia con entrega: en el modelo acompaña al formato ("desde el 4").
          preview: ad.preview, sets: new Set(ad.adSets || []), firstDay: ad.firstDay,
        });
      } else {
        hit.spend += ad.spend;
        hit.results += ad.results;
        hit.impressions += ad.impressions;
        hit.preview = hit.preview || ad.preview;
        hit.firstDay = Math.min(hit.firstDay ?? ad.firstDay, ad.firstDay ?? hit.firstDay);
        (ad.adSets || []).forEach(set => hit.sets.add(set));
      }
    });
    const total = [...byName.values()].reduce((sum, ad) => sum + ad.spend, 0);
    return [...byName.values()]
      .map(ad => {
        const arte = arteDe(ad.name);
        return {
          ...ad,
          sets: [...ad.sets],
          arte,
          format: formatOf(arte, section),
          share: total > 0 ? ad.spend / total : 0,
          costPerResult: ad.results > 0 ? ad.spend / ad.results : null,
        };
      })
      .sort((left, right) => right.results - left.results || right.spend - left.spend);
  }

  // Costo por formato de la seccion, del mas barato al mas caro. Sin pieza no se sabe el formato y
  // va al final.
  function formatsOf(ads) {
    const groups = new Map();
    ads.forEach(ad => {
      if (!groups.has(ad.format)) groups.set(ad.format, { format: ad.format, count: 0, spend: 0, results: 0, share: 0 });
      const group = groups.get(ad.format);
      group.count += 1;
      group.spend += ad.spend;
      group.results += ad.results;
      group.share += ad.share;
    });
    return [...groups.values()]
      .map(group => ({ ...group, cost: group.results > 0 ? group.spend / group.results : null }))
      .sort((left, right) => (left.format === 'Sin pieza') - (right.format === 'Sin pieza')
        || (left.cost ?? Infinity) - (right.cost ?? Infinity));
  }

  // ── Alcance unico ──────────────────────────────────────────────────────
  // Meta lo da sin duplicar solo por ventana completa y vive en su propia hoja (ver readReach_ del
  // Apps Script). Si no hay fila para esta ventana exacta, se usa el alcance sumado y se dice.
  function alcanceDe(ventana, ambito) {
    if (!ventana) return null;
    const datos = api().snapshot()?.alcance?.ventanas?.[ventana];
    if (!datos) return null;
    return (ambito === '(cuenta)' ? datos.cuenta : datos.campanas?.[ambito]) || null;
  }

  // Una seccion solo puede usarlo si es una sola campaña: el alcance de dos no se suma, las mismas
  // personas pueden haber visto las dos.
  function alcanceSeccion(section, ventana) {
    return section.campaigns && section.campaigns.length === 1 ? alcanceDe(ventana, section.campaigns[0]) : null;
  }

  // Las dos tarjetas de alcance y frecuencia, con el dato real si lo hay.
  function alcanceKpis(unico, unicoPrev, cur, prev, labels) {
    if (!unico) {
      return `${kpi('Alcance sumado', num(cur.reach), note('No son personas únicas'))}
        ${kpi('Impresiones', num(cur.impressions), deltaHtml(cur.impressions, prev?.impressions, labels, { versus: false }))}`;
    }
    const pie = unicoPrev && unicoPrev.frecuencia
      ? `${labels.prevTag}: ${unicoPrev.frecuencia.toFixed(2)}`
      : 'Impresiones ÷ personas';
    return `${kpi('Alcance', num(unico.alcance), unicoPrev ? deltaHtml(unico.alcance, unicoPrev.alcance, labels, { versus: false }) : note('Personas únicas'))}
      ${kpi('Frecuencia', unico.frecuencia ? unico.frecuencia.toFixed(2) : '—', note(pie))}`;
  }

  // La variacion de una celda de tabla: "▲ +49% · +37,088", sin el "vs sep" que ya dice la cabecera.
  function cellDelta(current, previous, { inverse = false, kind = 'num' } = {}) {
    const value = change(current, previous);
    if (value == null) return '<span class="rp-delta muted">—</span>';
    const abs = absDiff(current, previous, kind);
    return `<span class="rp-delta ${trendClass(value, inverse)}">${arrow(value)}${pct(value)}${abs ? ` · ${abs}` : ''}</span>`;
  }

  // ── La pieza de cada anuncio ("06 Artes", del barrido) ─────────────────
  // Misma clave que el resto del tablero: sin extension, sin "(Carrusel)", sin tildes ni signos.
  const arteKey = name => normalize(name)
    .replace(/\s*\((carrusel|carousel)\)\s*$/, '')
    .replace(/\.[a-z0-9]{2,5}$/, '')
    .replace(/[^a-z0-9]+/g, '');

  function arteDe(name) {
    const piezas = api().snapshot()?.artes?.piezas;
    return piezas ? piezas[arteKey(name)] || null : null;
  }

  // El formato sale de la pieza. Sin pieza en "06 Artes" no se sabe, salvo en Reconocimiento: un
  // ThruPlay solo lo da un video.
  function formatOf(arte, section) {
    if (arte) return arte.tipo === 'carrusel' ? 'Carrusel' : arte.tipo === 'video' ? 'Video' : 'Imagen';
    return section?.key === 'reconocimiento' ? 'Video' : 'Sin pieza';
  }

  const formatName = format => ({ Video: 'video', Imagen: 'imagen', Carrusel: 'carrusel' }[format] || 'sin pieza');
  const formatArticle = format => ({ Video: 'el video', Imagen: 'la imagen', Carrusel: 'el carrusel' }[format] || 'lo que no tiene pieza');

  const formatoDe = ad => (ad.firstDay ? `${ad.format} · desde el ${ad.firstDay}` : ad.format);

  // Una pieza con menos de esta parte de la inversion de su objetivo no alcanza para juzgarla.
  const MIN_SHARE = 0.08;
  // Una pieza es para replicar si cuesta al menos 3% menos que el promedio del objetivo, y para
  // descartar o ajustar si cuesta 10% mas o mas. Los margenes son chicos a proposito: en Reconocimiento
  // los costos de las piezas se separan pocas decimas y aun asi hay que decir cual conviene.
  const CHEAP = 0.97;
  const EXPENSIVE = 1.1;

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
        const campaigns = [...new Set(rows.map(row => row.campaign).filter(Boolean))];
        const allAds = adStats(rows, section);
        return {
          ...section, noun, rows, prevRows, campaigns, cur, prev,
          allAds,
          ads: allAds.slice(0, MAX_ADS),
          prevAds: prev ? adStats(prevRows, section) : [],
          formats: formatsOf(allAds),
          resultChange: prev ? change(cur.results, prev.results) : null,
        };
      })
      .filter(section => activity(section.cur))
      .sort((left, right) => order(left.key) - order(right.key) || right.cur.spend - left.cur.spend);

    const overall = metrics.summarize(period.rows);
    const prevOverall = period.prevRows ? metrics.summarize(period.prevRows) : null;
    const messages = sections.find(section => section.key === 'mensajes');
    const orders = sections.find(section => section.key === 'pedidos');
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
    return { period, labels: period.labels, span: period.span, sections, totals, prevTotals, messages, orders };
  }

  // ── Textos propuestos (el equipo los reescribe sobre la lamina) ─────────
  // "costo S/. 0.0135 → S/. 0.0086 (−36%, −S/. 0.0049)": el costo anterior, el actual y las dos
  // diferencias, que es como el equipo lee un cambio de costo.
  const costMove = (current, previous) => `${cost(previous)} → ${cost(current)}${change(current, previous) == null ? '' : ` (${pctAbs(current, previous, 'cost')})`}`;

  // Una linea por objetivo con su resultado y su costo, antes y ahora. La inversion va primero porque
  // es lo unico que se suma entre objetivos: los resultados no (un ThruPlay no es una conversacion).
  function suggestLectura(report) {
    const { totals, prevTotals, sections, labels } = report;
    if (!prevTotals) return `No hay ${labels.prevRef || 'período anterior'} con datos para comparar. El detalle por objetivo está en las siguientes páginas.`;
    const lines = [`**Inversión:** ${money(prevTotals.spend)} → ${money(totals.spend)} (${pctAbs(totals.spend, prevTotals.spend, 'money')}).`];
    sections.forEach(section => {
      const { cur, prev, noun } = section;
      if (!prev) {
        lines.push(`**${section.short}:** ${section.fem ? 'nueva' : 'nuevo'} en ${labels.curRef}, ${num(cur.results)} ${noun} a ${cost(cur.costPerResult)}.`);
        return;
      }
      lines.push(`**${section.short}:** ${noun} ${num(prev.results)} → ${num(cur.results)} (${pctAbs(cur.results, prev.results)}); costo ${costMove(cur.costPerResult, prev.costPerResult)}.`);
    });
    return lines.join('\n');
  }

  // ── El analisis de cada objetivo: que paso, que lo ocasiono, que replicar y que descartar ──
  // El costo por resultado es el CPM dividido entre los resultados que da cada 1,000 impresiones, asi
  // que todo cambio de costo sale de esos dos factores: pagar mas o menos por llegar a la gente, o que
  // las piezas conviertan mejor o peor lo que se muestra.
  const ratePer1000 = totals => (totals && totals.impressions > 0 ? (totals.results / totals.impressions) * 1000 : null);
  const rateNum = value => (value < 10 ? decimals(value, 1) : num(value));
  // "45x" o "1.8x" veces el promedio.
  const times = value => (value >= 10 ? integer.format(Math.round(value)) : decimals(value, 1));
  const quote = ad => `"${ad.name}"`;
  const adFact = ad => `${quote(ad)} (${formatName(ad.format)}, ${ad.costPerResult == null ? 'sin resultados' : cost(ad.costPerResult)})`;

  function causeLine(section) {
    const { cur, prev, noun } = section;
    const costChange = change(cur.costPerResult, prev.costPerResult);
    const cpmChange = change(cur.cpm, prev.cpm);
    const curRate = ratePer1000(cur);
    const prevRate = ratePer1000(prev);
    const rateChange = change(curRate, prevRate);
    const cpmText = cpmChange == null ? '' : `el CPM ${cpmChange < 0 ? 'bajó' : 'subió'} ${Math.abs(Math.round(cpmChange))}% (${money2(prev.cpm)} → ${money2(cur.cpm)})`;
    const rateText = rateChange == null ? '' : `cada 1,000 impresiones dieron ${rateNum(curRate)} ${noun} frente a ${rateNum(prevRate)} (${pct(rateChange)})`;
    const helps = [];
    const hurts = [];
    if (cpmText && Math.abs(cpmChange) >= 3) (cpmChange < 0 ? helps : hurts).push(cpmText);
    if (rateText && Math.abs(rateChange) >= 3) (rateChange > 0 ? helps : hurts).push(rateText);
    let sentence;
    if (costChange == null) sentence = list([cpmText, rateText].filter(Boolean));
    else if (costChange <= -3) sentence = `el costo bajó porque ${list(helps.length ? helps : [cpmText, rateText].filter(Boolean))}${helps.length && hurts.length ? `, aunque ${list(hurts)}` : ''}`;
    else if (costChange >= 3) sentence = `el costo subió porque ${list(hurts.length ? hurts : [cpmText, rateText].filter(Boolean))}${hurts.length && helps.length ? `, aunque ${list(helps)}` : ''}`;
    else if (helps.length && hurts.length) sentence = `${list([...helps, ...hurts])}: se compensaron y el costo quedó estable`;
    else sentence = `el CPM y los ${noun} por cada 1,000 impresiones casi no cambiaron`;
    return `**Qué lo ocasionó:** ${sentence}.${formatSentence(section)}`;
  }

  // Lo que dice el formato de la pieza en este periodo: el mas barato contra el mas caro.
  function formatSentence(section) {
    const known = section.formats.filter(group => group.format !== 'Sin pieza' && group.cost != null);
    if (known.length < 2) return '';
    const best = known[0];
    const worst = known[known.length - 1];
    const ratio = worst.cost / best.cost;
    const thin = worst.share < MIN_SHARE ? ', con poca inversión' : '';
    return ` ${cap(formatArticle(best.format))} costó ${cost(best.cost)} por ${section.one || 'resultado'} (${Math.round(best.share * 100)}% de la inversión) y ${formatArticle(worst.format)} ${cost(worst.cost)}${ratio >= 1.5 ? `, ${times(ratio)} veces más` : ''}${thin}.`;
  }

  // Los anuncios que repitieron del periodo anterior, con su costo, su CPM y su tasa de antes: el
  // desgaste de una pieza se ve en el costo que sube mes a mes, y los dos factores dicen si es la pieza
  // (convierte menos) o el publico (llegar cuesta mas).
  function repeatedAds(section) {
    const before = new Map(section.prevAds.map(ad => [ad.key, ad]));
    const cpm = ad => (ad.impressions > 0 ? (ad.spend / ad.impressions) * 1000 : null);
    return section.allAds
      .filter(ad => before.has(ad.key) && ad.share >= MIN_SHARE)
      .map(ad => {
        const prev = before.get(ad.key);
        return {
          ad,
          prev,
          costChange: change(ad.costPerResult, prev.costPerResult),
          cpmChange: change(cpm(ad), cpm(prev)),
          rate: ratePer1000(ad),
          prevRate: ratePer1000(prev),
          rateChange: change(ratePer1000(ad), ratePer1000(prev)),
        };
      })
      .filter(item => item.costChange != null);
  }

  // Las dos piezas mas baratas bajo el promedio, y las dos mas caras sobre el (o sin resultados), entre
  // las que tienen inversion suficiente para juzgarlas. Las usan el analisis y las conclusiones.
  function cheapAds(section) {
    const average = section.cur.costPerResult;
    if (!finite(average)) return [];
    return section.allAds
      .filter(ad => ad.share >= MIN_SHARE && ad.costPerResult != null && ad.costPerResult <= average * CHEAP)
      .sort((left, right) => left.costPerResult - right.costPerResult)
      .slice(0, 2);
  }

  function expensiveAds(section) {
    const average = section.cur.costPerResult;
    return section.allAds
      .filter(ad => ad.share >= MIN_SHARE && (ad.results === 0 || (finite(average) && ad.costPerResult >= average * EXPENSIVE)))
      .sort((left, right) => (right.costPerResult ?? Infinity) - (left.costPerResult ?? Infinity))
      .slice(0, 2);
  }

  function replicateLine(section, labels) {
    const average = section.cur.costPerResult;
    if (!finite(average)) return '';
    const cheap = cheapAds(section);
    const repeated = repeatedAds(section).filter(item => !cheap.includes(item.ad));
    const better = repeated
      .filter(item => item.costChange <= -10)
      .slice(0, 1)
      .map(item => `${quote(item.ad)} repite de ${labels.prevRef} y bajó su costo ${costMove(item.ad.costPerResult, item.prev.costPerResult)}`);
    // Una pieza que encarece puede tener igual un mensaje que funciona: si convierte mejor que antes,
    // eso es lo que se replica aunque el costo haya subido por el CPM.
    const message = repeated
      .filter(item => item.costChange > -10 && item.rateChange >= 10)
      .slice(0, 1)
      .map(item => `el mensaje de ${quote(item.ad)}, que convierte mejor que en ${labels.prevRef} (${rateNum(item.rate)} ${section.noun} por cada 1,000 impresiones frente a ${rateNum(item.prevRate)})`);
    const parts = [];
    if (cheap.length) parts.push(`${list(cheap.map(adFact))}, bajo el promedio (${cost(average)})`);
    parts.push(...better, ...message);
    return parts.length ? `**Replicar:** ${parts.join('; ')}.` : '';
  }

  function reviewLine(section, labels) {
    const average = section.cur.costPerResult;
    const expensive = expensiveAds(section);
    const parts = [];
    if (expensive.length) {
      // Lejos del promedio se dice en veces ("23 veces"); cerca, en porcentaje ("24% sobre").
      const ratios = expensive.filter(ad => ad.costPerResult != null).map(ad => ad.costPerResult / average);
      const low = Math.min(...ratios);
      const high = Math.max(...ratios);
      const over = value => `${Math.round((value - 1) * 100)}%`;
      let range = '';
      if (ratios.length && high >= 2) range = ratios.length === 1 || times(low) === times(high) ? `: ${times(high)} veces el promedio (${cost(average)})` : `: entre ${times(low)} y ${times(high)} veces el promedio (${cost(average)})`;
      else if (ratios.length) range = ratios.length === 1 || over(low) === over(high) ? `: ${over(high)} sobre el promedio (${cost(average)})` : `: entre ${over(low)} y ${over(high)} sobre el promedio (${cost(average)})`;
      parts.push(`${list(expensive.map(adFact))}${range}`);
    }
    // Una pieza que repite y encarece se esta gastando, aunque siga siendo la unica. Si convierte menos,
    // el problema es la pieza; si convierte igual o mejor y el CPM subio, es llegar al publico.
    repeatedAds(section)
      .filter(item => item.costChange >= 15 && !expensive.includes(item.ad))
      .slice(0, 1)
      .forEach(item => {
        const action = item.rateChange != null && item.rateChange <= -10
          ? 'convierte menos que antes: renovar la pieza'
          : `su CPM ${(item.cpmChange ?? 0) >= 0 ? 'subió' : 'bajó'} ${Math.abs(Math.round(item.cpmChange ?? 0))}%: ampliar el público o rotar la pieza con una nueva`;
        parts.push(`${quote(item.ad)} (${formatName(item.ad.format)}) repite de ${labels.prevRef} y su costo subió ${costMove(item.ad.costPerResult, item.prev.costPerResult)}; ${action}`);
      });
    return parts.length ? `**Descartar o ajustar:** ${parts.join('; ')}.` : '';
  }

  function suggestAnalysis(section, labels) {
    const { cur, prev, noun } = section;
    const per = section.one || 'resultado';
    let what;
    let why = '';
    if (!prev) {
      what = `**Qué pasó:** ${section.short} no tuvo entrega en ${labels.prevRef || 'el período anterior'}; ahora invirtió ${money(cur.spend)} y logró ${num(cur.results)} ${noun} a ${cost(cur.costPerResult)} por ${per}.`;
      const formats = formatSentence(section).trim();
      if (formats) why = `**Qué lo ocasionó:** ${formats}`;
    } else {
      what = `**Qué pasó:** inversión ${money(prev.spend)} → ${money(cur.spend)} (${pctAbs(cur.spend, prev.spend, 'money')}); ${noun} ${num(prev.results)} → ${num(cur.results)} (${pctAbs(cur.results, prev.results)}); costo por ${per} ${costMove(cur.costPerResult, prev.costPerResult)}.`;
      why = causeLine(section);
    }
    return [what, why, replicateLine(section, labels), reviewLine(section, labels)].filter(Boolean).join('\n');
  }

  // El "Destacado" del modelo: un dato con gancho, distinto del analisis. Se propone el peso del
  // anuncio que lidera; si un solo anuncio lo lleva todo ("el 100% con el 100%" no dice nada), el dia
  // pico frente al promedio diario, que es el que marca el grafico.
  function suggestDestacado(section, span) {
    const best = section.ads[0];
    const articulo = section.fem ? 'las' : 'los';
    const alone = best && best.share >= 0.95;
    if (alone && span && span.to >= span.from && section.cur.results > 0) {
      const daily = dailySeries(section.rows, span.from, span.to);
      const top = Math.max(...daily);
      const day = span.from + daily.indexOf(top);
      const average = section.cur.results / daily.length;
      return `Su mejor día fue el ${day}, con ${num(top)} ${section.noun}: ${times(top / average)} veces el promedio diario (${rateNum(average)}). Todo salió de "${best.name}"${best.format === 'Sin pieza' ? '' : ` (${formatName(best.format)})`}.`;
    }
    if (best && best.results > 0 && section.cur.results > 0) {
      const share = Math.round((best.results / section.cur.results) * 100);
      const spendShare = section.cur.spend > 0 ? Math.round((best.spend / section.cur.spend) * 100) : null;
      const costLine = finite(best.costPerResult) && finite(section.cur.costPerResult) && best.costPerResult < section.cur.costPerResult
        ? ` Su costo, ${cost(best.costPerResult)}, está por debajo del promedio del objetivo (${cost(section.cur.costPerResult)}).`
        : '';
      const format = best.format === 'Sin pieza' ? '' : ` (${formatName(best.format)})`;
      return `"${best.name}"${format} concentra el ${share}% de ${articulo} ${section.noun}${spendShare != null ? ` con el ${spendShare}% de la inversión` : ''}.${costLine}`;
    }
    const days = span && span.to >= span.from ? span.to - span.from + 1 : 0;
    if (days > 0 && section.cur.results > 0) {
      return `Promedio de ${num(Math.round(section.cur.results / days))} ${section.noun} al día en los ${days} días del período.`;
    }
    return '';
  }

  // El "Destacado" de la comparativa: la campaña que mas se movio y por que.
  function suggestDestacadoTotal(report) {
    const moved = report.sections.filter(section => section.resultChange != null);
    if (!moved.length) return 'Primer período con datos: todavía no hay un mes anterior con el que contrastar.';
    const top = moved.reduce((best, section) => (Math.abs(section.resultChange) > Math.abs(best.resultChange) ? section : best));
    const spendChange = change(top.cur.spend, top.prev.spend);
    const causa = causeOf(top).toLowerCase();
    const spendLine = spendChange != null ? ` con ${pct(spendChange)} de inversión (${absDiff(top.cur.spend, top.prev.spend, 'money')})` : '';
    return `${top.short} es ${top.resultChange >= 0 ? 'la que más creció' : 'la que más cayó'}: ${pct(top.resultChange)} en ${top.noun} (${absDiff(top.cur.results, top.prev.results)})${spendLine}, por ${causa}. Costo por ${top.one || 'resultado'}: ${costMove(top.cur.costPerResult, top.prev.costPerResult)}.`;
  }

  // Al pie de cada conclusion, lo accionable del analisis en una linea por lado: que piezas replicar y
  // cuales descartar o ajustar, solo por nombre y formato.
  function actionsOf(section) {
    const name = ad => `${quote(ad)}${ad.format === 'Sin pieza' ? '' : ` (${formatName(ad.format)})`}`;
    const lines = [];
    const cheap = cheapAds(section);
    const expensive = expensiveAds(section);
    if (cheap.length) lines.push(`**Replicar:** ${list(cheap.map(name))}.`);
    if (expensive.length) lines.push(`**Descartar o ajustar:** ${list(expensive.map(name))}.`);
    return lines.length ? `\n${lines.join('\n')}` : '';
  }

  function suggestConclusion(section) {
    const { cur, prev, noun } = section;
    const best = section.ads[0];
    const bestLine = best ? ` "${best.name}"${best.format === 'Sin pieza' ? '' : ` (${formatName(best.format)})`} es el anuncio más fuerte: ${num(best.results)} ${noun} a ${cost(best.costPerResult)}.` : '';
    const actions = actionsOf(section);
    if (!prev) return { title: `${section.short} arranca`, text: `Primer período con entrega: ${num(cur.results)} ${noun} a ${cost(cur.costPerResult)}.${bestLine}${actions}` };
    const resultsChange = change(cur.results, prev.results) ?? 0;
    const spendChange = change(cur.spend, prev.spend) ?? 0;
    const costChange = change(cur.costPerResult, prev.costPerResult);
    const costLine = costChange == null ? '' : ` y su costo por resultado ${costChange <= 0 ? 'bajó' : 'subió'} de ${cost(prev.costPerResult)} a ${cost(cur.costPerResult)} (${pctAbs(cur.costPerResult, prev.costPerResult, 'cost')})`;
    if (resultsChange > -5) {
      return {
        title: `${section.short} ${resultsChange >= 5 ? 'crece' : 'se mantiene'}`,
        text: `Con ${spendChange < 0 ? 'menos' : 'más'} inversión (${pct(spendChange)}), ${section.fem ? 'las' : 'los'} ${noun} ${resultsChange >= 0 ? 'subieron' : 'casi no cayeron'} (${pct(resultsChange)})${costLine}.${bestLine}${actions}`,
      };
    }
    if (spendChange <= -15) {
      return {
        title: `Sostener ${section.short}`,
        text: `${section.short} cayó ${pct(resultsChange)} al reducir su inversión (${pct(spendChange)}). Mantener una base de inversión que sostenga el alcance y el resto del embudo.${actions}`,
      };
    }
    // Que recomendar depende de que encarecio el resultado: si las piezas convierten igual o mejor y
    // subio el CPM, el problema es llegar al publico, no la pieza.
    const rateChange = change(ratePer1000(cur), ratePer1000(prev));
    const cpmChange = change(cur.cpm, prev.cpm);
    const advice = rateChange != null && rateChange >= 0 && cpmChange != null && cpmChange >= 10
      ? ` Las piezas convierten mejor (${pct(rateChange)} ${noun} por cada 1,000 impresiones), pero llegar al público costó ${Math.round(cpmChange)}% más: ampliar el público o rotar la pieza para bajar el CPM.`
      : ' Conviene renovar los anuncios con piezas nuevas para recuperar el volumen.';
    return {
      title: `Recuperar ${section.short}`,
      text: `${section.fem ? 'Las' : 'Los'} ${noun} bajaron ${pct(resultsChange)}${costLine}.${advice}${actions}`,
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
  // La variacion con su diferencia absoluta: "▲ +8% · +7,432 vs sep". kind da el formato de la diferencia.
  // En la lamina de objetivo las seis tarjetas no tienen ancho para el "vs sep", que ya dice el subtitulo.
  function deltaHtml(current, previous, labels, { inverse = false, kind = 'num', versus = true } = {}) {
    if (!labels.prevTag) return '';
    const value = previous == null ? null : change(current, previous);
    if (value == null) return `<span class="rp-delta muted">Sin datos en ${api().esc(labels.prevTag)}</span>`;
    const abs = absDiff(current, previous, kind);
    return `<span class="rp-delta ${trendClass(value, inverse)}">${arrow(value)}${pct(value)}${abs ? ` · ${abs}` : ''}${versus ? ` vs ${api().esc(labels.prevTag)}` : ''}</span>`;
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

  // Los resultados de cada dia del tramo (indice 0 = dia from).
  function dailySeries(rows, from, to) {
    if (!(to >= from)) return [];
    const perDay = new Array(to - from + 1).fill(0);
    (rows || []).forEach(row => {
      const index = row.d - from;
      if (index >= 0 && index < perDay.length) perDay[index] += Number(row.results) || 0;
    });
    return perDay;
  }

  const accumulate = values => {
    let total = 0;
    return values.map(value => (total += value));
  };

  // Un paso redondo para el eje (40k, 80k, 120k), no tercios del maximo.
  function niceStep(max, steps = 3) {
    const raw = Math.max(max, 1) / steps;
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    return Math.max(1, [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(size => size >= raw));
  }

  // Los dias de mas resultados, si se despegan del resto: hasta tres en un mes, nunca dos pegados.
  function peakDays(daily) {
    const positive = daily.filter(value => value > 0);
    if (positive.length < 3) return [];
    const mean = positive.reduce((sum, value) => sum + value, 0) / positive.length;
    const picked = [];
    daily
      .map((value, index) => ({ value, index }))
      .filter(day => day.value >= mean * 1.3)
      .sort((left, right) => right.value - left.value)
      .forEach(day => {
        if (picked.length < (daily.length > 20 ? 3 : 2) && picked.every(index => Math.abs(index - day.index) > 1)) picked.push(day.index);
      });
    return picked;
  }

  // El acumulado de cada dia dentro del tramo: el valor del dia 11 es todo lo que lleva el mes hasta
  // el 11. Es la forma del modelo, y deja ver en que dia se despego una curva de la otra. Las dos
  // lineas llevan su cifra al cierre de cada semana (los cortes del reporte) y al final; el mes en
  // curso, tambien en sus dias pico. Debajo, una franja con los resultados de cada dia muestra esos
  // picos con su cifra. Cada etiqueta busca lugar arriba o abajo de su punto y, si choca con otra, no
  // se dibuja: ninguna cifra tapa a otra.
  function progressChart(section, labels, span) {
    const { esc } = api();
    const from = span?.from || 1;
    const to = span?.to || from;
    const daily = dailySeries(section.rows, from, to);
    const current = accumulate(daily);
    // Un objetivo que no corrio el mes anterior no lleva su linea en cero: no hay con que comparar.
    const previous = span?.prevFrom && section.prev ? accumulate(dailySeries(section.prevRows, span.prevFrom, span.prevTo)) : [];
    if (!current.length || !current[current.length - 1]) return '<p class="rp-empty">Sin resultados en el período.</p>';

    const width = 620;
    const height = 272;
    const left = 46;
    const right = 598;
    const top = 58;
    const bottom = 186;
    const stripTop = 222;
    const stripBottom = 258;
    const highest = Math.max(...current, ...previous, 0) * 1.06;
    const step = niceStep(highest);
    const max = step * Math.ceil(highest / step);
    const x = index => left + (current.length < 2 ? (right - left) / 2 : (index / (current.length - 1)) * (right - left));
    const y = value => bottom - (value / max) * (bottom - top);
    const tick = value => compact(value).replace(/\.0(?=[kM])/, '');

    const grid = [];
    for (let value = 0; value <= max + step / 2; value += step) {
      grid.push(`<line x1="${left}" x2="${right}" y1="${y(value).toFixed(1)}" y2="${y(value).toFixed(1)}" class="rp-grid"/><text x="${left - 6}" y="${(y(value) + 3).toFixed(1)}" text-anchor="end" class="rp-tick">${value ? tick(value) : 0}</text>`);
    }
    const path = (values, className) => (values.length
      ? `<polyline class="rp-line ${className}" points="${values.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ')}"/>`
      : '');

    // Etiquetas sin superponerse: cada una ocupa una caja y solo se dibuja si su caja esta libre.
    const boxes = [];
    const free = box => box.x1 >= 2 && box.x2 <= width - 2 && box.y1 >= 38 && box.y2 <= bottom + 3
      && boxes.every(other => box.x1 > other.x2 + 2 || box.x2 < other.x1 - 2 || box.y1 > other.y2 + 1 || box.y2 < other.y1 - 1);
    const marks = [];
    const texts = [];
    const labeled = new Set();
    function label(values, index, className, side, peak = false) {
      if (index < 0 || index >= values.length || !values[index] || labeled.has(`${className}:${index}`)) return;
      labeled.add(`${className}:${index}`);
      const text = compact(values[index]);
      const textWidth = text.length * 5.3 + 2;
      const px = x(index);
      const py = y(values[index]);
      for (const where of [side, side === 'above' ? 'below' : 'above']) {
        const base = where === 'above' ? py - 6 : py + 13;
        // Pegada a un borde, la etiqueta se alinea hacia adentro para no salirse del grafico.
        const anchor = px + textWidth / 2 > width - 4 ? 'end' : px - textWidth / 2 < left ? 'start' : 'middle';
        const x1 = anchor === 'end' ? px - textWidth + 2 : anchor === 'start' ? px - 2 : px - textWidth / 2;
        const box = { x1, x2: x1 + textWidth, y1: base - 9, y2: base + 2 };
        if (!free(box)) continue;
        boxes.push(box);
        marks.push(`<circle class="rp-dot ${className}${peak ? ' peak' : ''}" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${peak ? 3.6 : 2.6}"/>`);
        texts.push(`<text x="${px.toFixed(1)}" y="${base.toFixed(1)}" text-anchor="${anchor}" class="rp-point-value ${className}">${text}</text>`);
        return;
      }
    }
    // La linea de arriba en ese dia lleva su cifra encima y la de abajo, debajo: asi ninguna cruza la otra linea.
    const sideOf = (values, other, index) => (other[index] != null && other[index] > values[index] ? 'below' : 'above');
    const cuts = (span?.cuts || []).map(day => day - from);
    const days = current.length <= 10
      ? current.map((value, index) => index)
      : [...new Set([...cuts, current.length - 1])].filter(index => index >= 0 && index < current.length);
    const peaks = peakDays(daily);
    const lastCur = current.length - 1;
    const lastPrev = previous.length - 1;
    // El orden es la prioridad: si dos chocan, queda la primera.
    label(current, lastCur, 'cur', sideOf(current, previous, lastCur));
    if (previous.length) label(previous, lastPrev, 'prev', sideOf(previous, current, lastPrev));
    peaks.forEach(index => label(current, index, 'cur', sideOf(current, previous, index), true));
    days.forEach(index => label(current, index, 'cur', sideOf(current, previous, index)));
    days.forEach(index => label(previous, index, 'prev', sideOf(previous, current, index)));

    // Con muchos dias el eje marca uno de cada tres, para que no se amontonen.
    const every = current.length > 16 ? 3 : current.length > 9 ? 2 : 1;
    const axis = current.map((value, index) => {
      if (index % every && index !== current.length - 1) return '';
      return `<text x="${x(index).toFixed(1)}" y="${bottom + 14}" text-anchor="middle" class="rp-axis">${from + index}</text>`;
    }).join('');

    // La franja de cada dia: barras del mes en curso, en rojo las de los picos con su cifra encima.
    const dayMax = Math.max(...daily, 1);
    const barWidth = Math.max(3, Math.min(12, ((right - left) / Math.max(current.length - 1, 1)) * 0.62));
    const barHeight = value => (value / dayMax) * (stripBottom - stripTop);
    const bars = daily.map((value, index) => (value > 0
      ? `<rect class="rp-day${peaks.includes(index) ? ' peak' : ''}" x="${(x(index) - barWidth / 2).toFixed(1)}" y="${(stripBottom - barHeight(value)).toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(barHeight(value), 1).toFixed(1)}" rx="1.5"/>`
      : '')).join('');
    const peakValues = peaks.map(index => `<text x="${x(index).toFixed(1)}" y="${(stripBottom - barHeight(daily[index]) - 3).toFixed(1)}" text-anchor="middle" class="rp-peak-value">${compact(daily[index])}</text>`).join('');

    // Leyenda arriba a la derecha: el trazo de cada mes y su nombre.
    let cursor = right;
    const legend = [[labels.barCur, 'cur'], previous.length ? [labels.barPrev, 'prev'] : null]
      .filter(Boolean)
      .reverse()
      .map(([name, className]) => {
        cursor -= name.length * 5 + 26;
        return `<line x1="${cursor.toFixed(1)}" x2="${(cursor + 16).toFixed(1)}" y1="13" y2="13" class="rp-line ${className}"/><text x="${(cursor + 20).toFixed(1)}" y="16" class="rp-legend">${esc(name)}</text>`;
      })
      .join('');

    return `
      <svg class="rp-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(section.short)}: acumulado ${esc(labels.chartRange)}">
        <text x="${left}" y="16" class="rp-chart-title">${esc(cap(section.noun))} ${section.fem ? 'acumuladas' : 'acumulados'} por día</text>
        <text x="${left}" y="31" class="rp-chart-sub">${esc(labels.chartSub)}</text>
        ${legend}
        ${grid.join('')}
        ${path(previous, 'prev')}
        ${path(current, 'cur')}
        ${marks.join('')}
        ${texts.join('')}
        ${axis}
        <text x="${left - 6}" y="${stripBottom}" text-anchor="end" class="rp-tick">por día</text>
        <line x1="${left}" x2="${right}" y1="${stripBottom}" y2="${stripBottom}" class="rp-grid"/>
        ${bars}
        ${peakValues}
      </svg>`;
  }

  // Verde si la pieza cuesta menos que el promedio del objetivo (para replicar), rojo si cuesta mucho
  // mas (para descartar o ajustar): el mismo criterio del analisis.
  function costClass(ad, average) {
    if (ad.costPerResult == null || !finite(average)) return '';
    if (ad.costPerResult <= average * CHEAP) return 'good';
    return ad.costPerResult >= average * EXPENSIVE ? 'bad' : '';
  }

  // Las tarjetas del modelo: la pieza arriba y, debajo, el conjunto, el formato y las tres cifras.
  // La miniatura la sirve Drive y la pide el navegador, por eso la carpeta de artes va compartida
  // por enlace; Drive la rechaza si la peticion lleva el referer del tablero. No lleva loading="lazy":
  // las laminas de abajo no se veian al imprimir y el PDF salia con el recuadro vacio.
  function adsTable(section) {
    const { esc, safeUrl } = api();
    if (!section.ads.length) return '<p class="rp-empty">Sin anuncios con entrega en el período.</p>';
    const titulo = cap(section.noun);
    return `<div class="rp-ad-cards">${section.ads.map(ad => {
      const url = safeUrl(ad.preview);
      const { arte } = ad;
      const id = arte ? (arte.tipo === 'carrusel' ? (arte.laminas || [])[0] : arte.id) : '';
      const art = id
        ? `<img class="rp-ad-art" src="https://drive.google.com/thumbnail?id=${encodeURIComponent(id)}&amp;sz=w320" alt="" referrerpolicy="no-referrer">`
        : '<div class="rp-ad-art is-empty"><span>Sin arte</span></div>';
      // El "Ver »" va sobre la pieza, que es el enlace a la vista previa: una linea menos por tarjeta.
      return `
        <article class="rp-ad-card">
          ${url ? `<a class="rp-ad-thumb" href="${url}" target="_blank" rel="noopener">${art}<span class="rp-ad-link">Ver »</span></a>` : `<div class="rp-ad-thumb">${art}</div>`}
          <div class="rp-ad-name" title="${esc(ad.name)}">${esc(ad.name)}</div>
          <div class="rp-ad-meta" title="${esc(ad.sets.join(' / ') || 'Sin conjunto')}">${esc(formatoDe(ad))} · ${esc(ad.sets.join(' / ') || 'Sin conjunto')}</div>
          <dl class="rp-ad-figures">
            <div><dt>Inversión</dt><dd>${money(ad.spend)}</dd></div>
            <div><dt>${esc(titulo)}</dt><dd>${num(ad.results)}</dd></div>
            <div><dt>Costo</dt><dd class="${costClass(ad, section.cur.costPerResult)}">${cost(ad.costPerResult)}</dd></div>
          </dl>
        </article>`;
    }).join('')}</div>`;
  }

  // Costo por formato de todos los anuncios del objetivo, no solo de los cuatro de arriba. El mas
  // barato con inversion suficiente va marcado.
  function formatsStrip(section) {
    const { esc } = api();
    const groups = section.formats.filter(group => group.spend > 0);
    if (!groups.length) return '';
    const best = groups.find(group => group.format !== 'Sin pieza' && group.cost != null && group.share >= MIN_SHARE);
    return `
      <div class="rp-formats">
        <span class="rp-formats-title">Costo por formato</span>
        ${groups.map(group => `
          <div class="rp-format${group === best && groups.length > 1 ? ' best' : ''}">
            <b>${esc(group.format)} · ${cost(group.cost)}</b>
            <span>${group.count} ${group.count === 1 ? 'anuncio' : 'anuncios'} · ${Math.round(group.share * 100)}% inv.</span>
          </div>`).join('')}
      </div>`;
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
      ...report.sections.map((section, index) => ({ title: section.short, desc: section.toc || 'KPIs, comparación y mejores anuncios.', icon: section.icon, page: pages.firstSection + index })),
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

  // La ultima columna del modelo: que explica mejor el cambio de resultados de una campaña, si lo
  // que movio la aguja fue la inversion o el costo por resultado. Gana el que mas vario.
  function causeOf(section) {
    if (!section.prev) return 'Campaña nueva';
    if (section.resultChange == null) return '—';
    const spendChange = change(section.cur.spend, section.prev.spend);
    const costChange = change(section.cur.costPerResult, section.prev.costPerResult);
    if (costChange == null && spendChange == null) return '—';
    if (costChange != null && Math.abs(costChange) >= Math.abs(spendChange ?? 0)) {
      return costChange < 0 ? 'Menor costo' : 'Mayor costo';
    }
    return (spendChange ?? 0) < 0 ? 'Menor inversión' : 'Mayor inversión';
  }

  function comparisonPage(report, notes, page, total) {
    const { esc } = api();
    const { labels, totals, prevTotals, sections, messages, orders } = report;
    // Como en el modelo: las dos campañas de WhatsApp comparten la cuarta tarjeta, porque cuentan
    // cosas distintas (contactos y conversaciones) y sumarlas no diria nada.
    // Como en el modelo: la inversion, el alcance y el titular de cada objetivo. Los resultados de
    // objetivos distintos no se suman en una sola cifra, porque un ThruPlay y una conversacion no
    // son lo mismo; las dos campañas de WhatsApp comparten tarjeta por la misma razon.
    const juntas = Boolean(orders && messages);
    const titulares = sections
      .filter(section => !(juntas && (section.key === 'pedidos' || section.key === 'mensajes')))
      .map(section => kpi(cap(section.noun), num(section.cur.results), deltaHtml(section.cur.results, section.prev ? section.prev.results : null, labels)));
    if (juntas) {
      titulares.push(kpi('WhatsApp', `${num(orders.cur.results)} + ${num(messages.cur.results)}`, note('Contactos + conversaciones')));
    }
    const ranked = sections.filter(section => section.resultChange != null);
    const leader = ranked.length > 1 ? ranked.reduce((best, section) => (section.resultChange > best.resultChange ? section : best)) : null;
    // Cada variacion va con su diferencia absoluta, y el costo con la suya: el anterior, el actual y
    // cuanto se movio, en porcentaje y en soles.
    const rows = sections.map(section => `
      <tr${section === leader ? ' class="rp-top"' : ''}>
        <td class="rp-name" title="${esc(section.short)}">${esc(section.short)}</td>
        ${labels.prevTag ? `<td class="num">${section.prev ? money(section.prev.spend) : '—'}</td>` : ''}
        <td class="num">${money(section.cur.spend)}</td>
        ${labels.prevTag ? `<td class="num">${section.prev ? num(section.prev.results) : '—'}</td>` : ''}
        <td class="num"><b>${num(section.cur.results)}</b></td>
        ${labels.prevTag ? `<td class="num">${section.prev ? cellDelta(section.cur.results, section.prev.results) : '<span class="rp-delta muted">Nuevo</span>'}</td>` : ''}
        ${labels.prevTag ? `<td class="num">${section.prev ? cost(section.prev.costPerResult) : '—'}</td>` : ''}
        <td class="num">${cost(section.cur.costPerResult)}</td>
        ${labels.prevTag ? `<td class="num">${section.prev ? cellDelta(section.cur.costPerResult, section.prev.costPerResult, { inverse: true, kind: 'cost' }) : '<span class="rp-delta muted">—</span>'}</td>` : ''}
        ${labels.prevTag ? `<td>${esc(causeOf(section))}</td>` : ''}
      </tr>`).join('');
    const lectura = notes.lectura != null ? notes.lectura : suggestLectura(report);
    const destacado = notes.destacado != null ? notes.destacado : suggestDestacadoTotal(report);
    return `
      <section class="rp-page">
        ${head(labels.compTitle, labels.compSub)}
        <div class="rp-body">
          <div class="rp-grid-kpis">
            ${kpi('Inversión total', money(totals.spend), deltaHtml(totals.spend, prevTotals?.spend, labels, { kind: 'money' }))}
            ${(() => {
              const unico = alcanceDe(report.period.ventana, '(cuenta)');
              const unicoPrev = alcanceDe(report.period.ventanaPrev, '(cuenta)');
              if (!unico) return kpi('Alcance sumado', num(totals.reach), note('No son personas únicas'));
              return kpi('Alcance', num(unico.alcance), unicoPrev
                ? deltaHtml(unico.alcance, unicoPrev.alcance, labels)
                : note(`Personas únicas · frec. ${unico.frecuencia ? unico.frecuencia.toFixed(2) : '—'}`));
            })()}
            ${titulares.join('')}
          </div>
          <div class="rp-card rp-table-card">
            <div class="rp-card-title">Resultados por objetivo · ${esc(labels.versus)}</div>
            <table class="rp-table rp-compare">
              ${labels.prevTag ? '<colgroup><col class="c-name"><col span="2" class="c-money"><col span="2" class="c-count"><col class="c-var"><col span="2" class="c-cost"><col class="c-var-cost"><col class="c-cause"></colgroup>' : ''}
              <thead><tr>
                <th>Campaña</th>
                ${labels.prevTag ? `<th class="num">Inv. ${esc(labels.prevTag)}</th>` : ''}
                <th class="num">Inv. ${esc(labels.curTag)}</th>
                ${labels.prevTag ? `<th class="num">Result. ${esc(labels.prevTag)}</th>` : ''}
                <th class="num">Result. ${esc(labels.curTag)}</th>
                ${labels.prevTag ? '<th class="num">Var. result.</th>' : ''}
                ${labels.prevTag ? `<th class="num">Costo ${esc(labels.prevTag)}</th>` : ''}
                <th class="num">Costo ${esc(labels.curTag)}</th>
                ${labels.prevTag ? '<th class="num">Var. costo</th>' : ''}
                ${labels.prevTag ? '<th>Causa principal</th>' : ''}
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
            <div class="rp-table-foot">Inversión total: ${money(totals.spend)} (${esc(labels.curTag)})${prevTotals ? ` vs ${money(prevTotals.spend)} (${esc(labels.prevTag)}), ${esc(pctAbs(totals.spend, prevTotals.spend, 'money'))}` : ''}.</div>
          </div>
          <div class="rp-duo${destacado ? ' rp-duo-wide' : ''}">
            ${destacado ? insight('Destacado', 'destacado', destacado) : ''}
            ${insight('Análisis', 'lectura', lectura)}
          </div>
        </div>
        ${footer(labels.source, report, page, total)}
      </section>`;
  }

  function sectionPage(section, report, notes, page, total) {
    const { labels } = report;
    const { cur, prev } = section;
    const key = `analisis:${section.key}`;
    const analysis = notes[key] != null ? notes[key] : suggestAnalysis(section, labels);
    const destacadoKey = `destacado:${section.key}`;
    const destacado = notes[destacadoKey] != null ? notes[destacadoKey] : suggestDestacado(section, report.span);
    return `
      <section class="rp-page">
        ${head(section.title, labels.sectionSub)}
        <div class="rp-body">
          <div class="rp-grid-3 rp-section-kpis">
            ${kpi('Inversión', money(cur.spend), deltaHtml(cur.spend, prev?.spend, labels, { kind: 'money', versus: false }))}
            ${kpi(cap(section.noun), num(cur.results), deltaHtml(cur.results, prev?.results, labels, { versus: false }))}
            ${kpi(`Costo/${section.one || 'result.'}`, cost(cur.costPerResult), deltaHtml(cur.costPerResult, prev?.costPerResult, labels, { inverse: true, kind: 'cost', versus: false }))}
            ${kpi('CPM', money2(cur.cpm), deltaHtml(cur.cpm, prev?.cpm, labels, { inverse: true, kind: 'money2', versus: false }))}
            ${alcanceKpis(alcanceSeccion(section, report.period.ventana), alcanceSeccion(section, report.period.ventanaPrev), cur, prev, labels)}
          </div>
          <div class="rp-split">
            <div class="rp-card rp-chart-card">
              ${progressChart(section, labels, report.span)}
            </div>
            <div class="rp-card rp-table-card rp-ads-card">
              <div class="rp-card-title">Mejores anuncios</div>
              ${adsTable(section)}
              ${formatsStrip(section)}
            </div>
          </div>
          <div class="rp-duo${destacado ? ' rp-duo-wide' : ''}">
            ${destacado ? insight('Destacado', destacadoKey, destacado) : ''}
            ${insight('Análisis', key, analysis)}
          </div>
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
      node.addEventListener('blur', () => {
        node.innerHTML = rich(node.dataset.raw);
        fitPage(node.closest('.rp-page'));
      });
    });
  }

  function render() {
    const host = document.getElementById('week-report');
    if (!host || !api()) return;
    const { esc } = api();

    const available = monthPeriods();
    const select = document.getElementById('week-select');
    if (!available.length) {
      if (select) select.innerHTML = '<option value="">Sin periodos con datos</option>';
      host.innerHTML = '<div class="panel"><div class="empty-state"><strong>Todavía no hay datos para el reporte</strong><span>El reporte se arma con las descargas de Meta Ads de la carpeta de Drive. En cuanto haya un mes con entregas, aparece aquí.</span></div></div>';
      return;
    }

    if (!available.some(period => period.id === selectedPeriod)) selectedPeriod = available[0].id;
    const period = available.find(item => item.id === selectedPeriod);

    if (select) {
      // Un grupo por mes y, dentro, sus cortes acumulados: 1–4, 1–11, 1–18, 1–25.
      const groups = [];
      available.forEach(item => {
        const last = groups[groups.length - 1];
        if (last && last.label === item.group) last.items.push(item);
        else groups.push({ label: item.group, items: [item] });
      });
      select.innerHTML = groups.map(group => `<optgroup label="${esc(group.label)}">${group.items
        .map(item => `<option value="${esc(item.id)}"${item.id === selectedPeriod ? ' selected' : ''}>${esc(item.option)}</option>`)
        .join('')}</optgroup>`).join('');
    }

    const model = modelReport();
    const modelHost = document.getElementById('week-model');
    if (modelHost) {
      modelHost.innerHTML = model
        ? `Modelo: <a href="https://drive.google.com/file/d/${esc(model.id)}/view" target="_blank" rel="noopener">${esc(model.title)}</a>`
        : 'Modelo: el último reporte de la carpeta Reportes de Drive';
    }

    const report = buildReport(period);
    const notes = readNotes()[period.id] || {};
    const pages = { comparison: 3, firstSection: 4, conclusions: 4 + report.sections.length };
    const total = pages.conclusions + 1;
    host.innerHTML = `
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
    wireArt(host);
    host.querySelectorAll('.rp-page').forEach(fitPage);
  }

  // El analisis cambia de largo con cada periodo y le quita alto a la fila del grafico y los anuncios.
  // Si la tarjeta de anuncios no entra, la lamina pasa a letra compacta en vez de cortar las cifras.
  // El alto de las piezas lo fija el CSS (aspect-ratio y tope), asi que se puede medir antes de que lleguen.
  // Se mide a escala 1, como sale en el PDF: con el zoom de pantalla el texto parte distinto.
  function fitPage(page) {
    const card = page?.querySelector('.rp-ads-card');
    if (!card) return;
    page.classList.remove('rp-dense');
    page.style.zoom = '1';
    if (card.scrollHeight > card.clientHeight + 1) page.classList.add('rp-dense');
    page.style.zoom = '';
  }

  // Una miniatura que Drive no entrega (pieza borrada, carpeta sin compartir) queda como recuadro con
  // texto, no como un bloque oscuro en el PDF.
  function wireArt(host) {
    host.querySelectorAll('img.rp-ad-art').forEach(img => {
      const fallback = () => {
        const empty = document.createElement('div');
        empty.className = 'rp-ad-art is-empty';
        empty.innerHTML = '<span>Sin vista previa</span>';
        img.replaceWith(empty);
      };
      if (img.complete && !img.naturalWidth) fallback();
      else img.addEventListener('error', fallback, { once: true });
    });
  }

  // Las piezas llegan de Drive: el PDF espera a que terminen de cargar (o fallen), con un tope para no
  // quedarse colgado si Drive no responde.
  function artReady(timeout = 12000) {
    const pending = [...document.querySelectorAll('#week-report img.rp-ad-art')].filter(img => !img.complete);
    if (!pending.length) return Promise.resolve();
    const loaded = Promise.all(pending.map(img => new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    })));
    return Promise.race([loaded, new Promise(resolve => window.setTimeout(resolve, timeout))]);
  }

  // El ultimo PDF de la carpeta Reportes: se enlaza arriba como referencia del diseño.
  function modelReport() {
    const files = (api()?.snapshot()?.reports?.files || [])
      .filter(file => file.mimeType === 'application/pdf')
      .sort((left, right) => String(right.modifiedTime || '').localeCompare(String(left.modifiedTime || '')));
    return files.find(file => /reporte|meta.?ads/i.test(file.title || '')) || files[0] || null;
  }

  // El nombre del PDF lo pone el navegador con el titulo del documento: se cambia solo mientras imprime.
  async function printReport() {
    const period = monthPeriods().find(item => item.id === selectedPeriod);
    if (!period) return;
    document.activeElement?.blur?.();
    const button = document.getElementById('week-print');
    const label = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = 'Preparando PDF…';
    }
    await artReady();
    if (button) {
      button.disabled = false;
      button.textContent = label;
    }
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
      // Sin dialogo de confirmacion: el boton vuelve directo a los textos propuestos del mes.
      if (!selectedPeriod) return;
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
