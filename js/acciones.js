/**
 * acciones.js - Acciones sugeridas del mes para Meta Ads, con check.
 *
 * El Ciclo Mensual de Analisis y Optimizacion dice en que semana del mes vamos; las cifras reales
 * dicen que hacer. De las dos cosas sale la lista: cada accion lleva el numero exacto, el porque y
 * la ruta donde se toca en el Administrador de anuncios.
 *
 * Las palancas de Meta no son las de Google: aqui no se mueven keywords ni pujas, se mueve el arte,
 * el formato y la inversion de la campana. Por eso los cuatro hitos son los del ciclo de Meta
 * (calibracion, desgaste del arte, formato, escalar y repetir) y no los de Google.
 *
 * El hito que corre hoy pone sus acciones primero, pero no se esconde ninguna: una pieza que gasta
 * sin resultados no puede esperar a la semana que le toque.
 *
 * El id de cada accion es estable (tipo + objetivo o anuncio, nunca la cifra), de modo que lo
 * marcado sigue marcado aunque los numeros cambien al dia siguiente. El estado es por mes y, por
 * ahora, vive solo en este navegador: lo que marca una persona no lo ven las demas, y la tarjeta lo
 * dice. Compartirlo pide una hoja y un Web App propios, como el CRM de Tierra Films.
 */
(function () {
  const LOCAL_KEY = 'tp_acciones_v1';
  // Una pieza que la misma gente ya vio dos veces esta quemandose.
  const FRECUENCIA_ALTA = 2;
  // Por debajo de este gasto en el mes, una campana o una pieza no mueve la aguja: no se sugiere nada.
  const GASTO_MINIMO = 50;
  // Un costo que cambia menos que esto es ruido, no una tendencia.
  const CAMBIO_MINIMO = 0.15;

  const data = () => window.TPData;

  // Los cuatro hitos del ciclo de Meta, en el orden en que corren. El dia del mes elige uno.
  const HITOS = [
    { key: 'calibracion', hasta: 7, titulo: 'Calibración', semana: 'Semana 1' },
    { key: 'desgaste', hasta: 14, titulo: 'Desgaste del arte', semana: 'Semana 2' },
    { key: 'formato', hasta: 21, titulo: 'Formato', semana: 'Semana 3' },
    { key: 'escalar', hasta: 31, titulo: 'Escalar y repetir', semana: 'Semana 4' },
  ];
  const ORDEN = HITOS.map(hito => hito.key);

  const state = { hechas: {}, cargado: false, local: true };

  // ── Guardado ───────────────────────────────────────────────────────────────
  function cargar() {
    if (state.cargado) return;
    state.cargado = true;
    try {
      const guardado = JSON.parse(window.localStorage.getItem(LOCAL_KEY) || '{}');
      if (guardado && typeof guardado === 'object') state.hechas = guardado;
    } catch {
      // Sin localStorage las marcas duran lo que dure la pestana.
    }
  }

  function guardar() {
    try {
      window.localStorage.setItem(LOCAL_KEY, JSON.stringify(state.hechas));
    } catch {
      // Igual que arriba: no se pierde nada mas que la persistencia.
    }
  }

  const marcada = (mes, id) => Boolean(state.hechas[`${mes}|${id}`]);

  function marcar(mes, id, valor) {
    const clave = `${mes}|${id}`;
    if (valor) state.hechas[clave] = true;
    else delete state.hechas[clave];
    guardar();
  }

  // ── Utilidades ─────────────────────────────────────────────────────────────
  // El id tiene que ser corto y legible, pero sobre todo unico: dos anuncios pueden compartir los
  // primeros caracteres, asi que al cortar se le pega un resumen del nombre completo.
  function clave(texto) {
    const plano = String(texto || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (plano.length <= 32) return plano;
    let suma = 5381;
    for (let i = 0; i < plano.length; i += 1) suma = ((suma * 33) ^ plano.charCodeAt(i)) >>> 0;
    return `${plano.slice(0, 32)}-${suma.toString(36)}`;
  }

  const finite = valor => valor != null && Number.isFinite(Number(valor));
  const money = valor => data().fmt.money(valor);
  // Un costo por resultado de branding son centavos: con dos decimales todo queda en «S/. 0.01» y
  // la frase pierde sentido («bajó 34%: S/. 0.01 → S/. 0.01»).
  const costo = valor => data().fmt.unitCost(valor);
  const count = valor => data().fmt.count(valor);
  const pct = valor => `${valor > 0 ? '+' : ''}${Math.round(valor * 100)}%`;

  // El hito que corre segun el dia: un mes cerrado se lee con su ultimo dia, que es el final del
  // ciclo, y no con la fecha de quien esta mirando.
  function hitoDe(period) {
    // limaParts devuelve el mes en base 0, como Date.
    const hoy = data().limaParts(new Date());
    const enCurso = !period.closed && period.month.month === hoy.month + 1 && period.month.year === hoy.year;
    const dia = enCurso ? hoy.day : period.to;
    return { hito: HITOS.find(item => dia <= item.hasta) || HITOS[HITOS.length - 1], dia, enCurso };
  }

  // Por que cambio el costo: si la inversion subio mas que los resultados, el problema es de
  // presupuesto; si los resultados cayeron con la misma inversion, es de creatividad.
  function causa(cur, prev) {
    const gasto = prev.spend > 0 ? cur.spend / prev.spend - 1 : 0;
    const res = prev.results > 0 ? cur.results / prev.results - 1 : 0;
    if (res < 0 && gasto >= -0.05) return 'los resultados cayeron con la misma inversión: es la creatividad, no el presupuesto';
    if (gasto > 0.1 && res <= gasto) return 'la inversión subió más rápido que los resultados';
    return 'el costo por resultado se movió sin que cambiara la inversión';
  }

  // ── El calculo ─────────────────────────────────────────────────────────────
  function acciones(period) {
    if (!period) return [];
    const metrics = data().metrics;
    const lista = [];
    const objetivos = metrics.objectives(period.rows);
    const anuncios = metrics.ads(period.rows);
    const previos = period.compare ? new Map(metrics.ads(period.compare.rows).map(ad => [ad.key, ad])) : new Map();
    const piezas = data().snapshot()?.artes?.piezas || {};

    // 1 · Calibración. El costo por resultado de cada objetivo contra el mismo tramo del mes
    //     anterior. Es la lectura que abre el mes y la que dice si hay que mirar dinero o arte.
    if (period.compare) {
      objetivos.forEach(objetivo => {
        const cur = metrics.summarize(period.rows.filter(row => row.group === objetivo.key));
        const prev = metrics.summarize(period.compare.rows.filter(row => row.group === objetivo.key));
        if (cur.spend < GASTO_MINIMO || !finite(cur.costPerResult) || !finite(prev.costPerResult)) return;
        const cambio = cur.costPerResult / prev.costPerResult - 1;
        if (cambio < CAMBIO_MINIMO) return;
        lista.push({
          id: `calibracion:${clave(objetivo.key)}`,
          hito: 'calibracion',
          tono: cambio >= 0.3 ? 'red' : 'amber',
          titulo: `Revisar ${objetivo.label}: cada resultado cuesta ${costo(cur.costPerResult)}`,
          porque: `${pct(cambio)} contra el mismo tramo de ${period.compare.month.name.toLowerCase()} (${costo(prev.costPerResult)}); ${causa(cur, prev)}.`,
          donde: `Administrador de anuncios › Campañas › ${objetivo.campaigns[0] || objetivo.label}`,
        });
      });
    }

    // 2 · Desgaste del arte. La pieza que cuesta más y llega a menos gente es la misma pieza
    //     quemándose; la que gasta sin resultado no es desgaste, es dinero tirado.
    anuncios.forEach(ad => {
      if (ad.spend < GASTO_MINIMO) return;
      if (ad.results === 0) {
        lista.push({
          id: `seca:${clave(ad.key)}`,
          hito: 'desgaste',
          tono: 'red',
          titulo: `Pausar «${ad.ad}» o cambiar su pieza`,
          porque: `Lleva ${money(ad.spend)} del mes sin un solo resultado.`,
          donde: `Administrador de anuncios › Anuncios › ${ad.ad}`,
        });
        return;
      }
      const prev = previos.get(ad.key);
      if (prev && finite(ad.costPerResult) && finite(prev.costPerResult) && prev.reach > 0) {
        const masCaro = ad.costPerResult / prev.costPerResult - 1;
        const menosAlcance = ad.reach / prev.reach - 1;
        if (masCaro >= CAMBIO_MINIMO && menosAlcance <= -0.1) {
          lista.push({
            id: `desgaste:${clave(ad.key)}`,
            hito: 'desgaste',
            tono: 'amber',
            titulo: `Renovar «${ad.ad}»: cuesta ${pct(masCaro)} y llega a ${pct(menosAlcance)} de gente`,
            porque: `${costo(prev.costPerResult)} → ${costo(ad.costPerResult)} por resultado con ${count(ad.reach)} de alcance (antes ${count(prev.reach)}): la misma pieza llegando a menos gente y más cara.`,
            donde: `Administrador de anuncios › Anuncios › ${ad.ad}`,
          });
          return;
        }
      }
      if (finite(ad.frequency) && ad.frequency >= FRECUENCIA_ALTA) {
        lista.push({
          id: `frecuencia:${clave(ad.key)}`,
          hito: 'desgaste',
          tono: 'amber',
          titulo: `Renovar «${ad.ad}»: la misma gente ya la vio ${ad.frequency.toFixed(1)} veces`,
          porque: `${count(ad.impressions)} impresiones sobre ${count(ad.reach)} personas. Pasada la segunda vez, la pieza deja de sumar y empieza a cansar.`,
          donde: `Administrador de anuncios › Anuncios › ${ad.ad}`,
        });
      }
    });

    // 3 · Formato. Dentro de un objetivo, video contra imagen: si uno rinde claramente mejor, la
    //     inversión se mueve ahí. El formato sale de la pieza de «06 Artes», que el barrido trae.
    objetivos.forEach(objetivo => {
      const suyos = anuncios.filter(ad => ad.group === objetivo.key && ad.results > 0 && finite(ad.costPerResult));
      if (suyos.length < 2) return;
      const porFormato = new Map();
      suyos.forEach(ad => {
        const arte = piezas[claveArte(ad.ad)];
        const formato = arte?.tipo === 'video' ? 'video' : arte ? 'imagen' : '';
        if (!formato) return;
        const actual = porFormato.get(formato) || { spend: 0, results: 0, ads: [] };
        actual.spend += ad.spend;
        actual.results += ad.results;
        actual.ads.push(ad);
        porFormato.set(formato, actual);
      });
      if (porFormato.size < 2) return;
      const ranking = [...porFormato.entries()]
        .map(([formato, item]) => ({ formato, ...item, costo: item.spend / item.results }))
        .sort((left, right) => left.costo - right.costo);
      const mejor = ranking[0];
      const peor = ranking[ranking.length - 1];
      // Mover S/ 13 de un formato a otro no es una accion, es ruido.
      if (peor.costo < mejor.costo * (1 + CAMBIO_MINIMO) || peor.spend < GASTO_MINIMO) return;
      lista.push({
        id: `formato:${clave(objetivo.key)}`,
        hito: 'formato',
        tono: 'amber',
        titulo: `Mover inversión de ${peor.formato} a ${mejor.formato} en ${objetivo.label}`,
        porque: `En ${mejor.formato} cada resultado sale ${costo(mejor.costo)} y en ${peor.formato} ${costo(peor.costo)}; hoy ${peor.formato} se lleva ${money(peor.spend)}.`,
        donde: `Administrador de anuncios › Conjuntos de ${objetivo.campaigns[0] || objetivo.label} › Presupuesto`,
      });
      const lider = mejor.ads.sort((left, right) => left.costPerResult - right.costPerResult)[0];
      if (lider) {
        lista.push({
          id: `variaciones:${clave(lider.key)}`,
          hito: 'formato',
          tono: 'green',
          titulo: `Producir variaciones de «${lider.ad}»`,
          porque: `Es la pieza más barata de ${objetivo.label}: ${costo(lider.costPerResult)} por resultado.`,
          donde: `Administrador de anuncios › Anuncios › ${lider.ad}`,
        });
      }
    });

    // 4 · Escalar y repetir. La campaña que bajó su costo con el mes es donde el dinero rinde más
    //     hoy: se le sube la inversión con un número, no con un «subirle un poco».
    if (period.compare) {
      objetivos.forEach(objetivo => {
        const cur = metrics.summarize(period.rows.filter(row => row.group === objetivo.key));
        const prev = metrics.summarize(period.compare.rows.filter(row => row.group === objetivo.key));
        if (cur.spend < GASTO_MINIMO || !finite(cur.costPerResult) || !finite(prev.costPerResult)) return;
        const cambio = cur.costPerResult / prev.costPerResult - 1;
        if (cambio > -CAMBIO_MINIMO) return;
        const dias = Math.max(period.to - period.from + 1, 1);
        const diario = cur.spend / dias;
        lista.push({
          id: `escalar:${clave(objetivo.key)}`,
          hito: 'escalar',
          tono: 'green',
          titulo: `Subir la inversión de ${objetivo.label} de ${money(diario)} a ${money(diario * 1.2)} por día`,
          // «bajó -34%» es una doble negación: el verbo ya dice el sentido, el número va en absoluto.
          porque: `Su costo por resultado bajó ${Math.round(Math.abs(cambio) * 100)}% (${costo(prev.costPerResult)} → ${costo(cur.costPerResult)}): es donde el dinero rinde mejor este mes.`,
          donde: `Administrador de anuncios › Campañas › ${objetivo.campaigns[0] || objetivo.label} › Presupuesto`,
        });
      });
    }

    return lista;
  }

  // Misma clave que arteKey_() del Apps Script: sin extension, sin «(Carrusel)», sin tildes ni signos.
  const claveArte = nombre => String(nombre || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s*\((carrusel|carousel)\)\s*$/i, '')
    .replace(/\.[A-Za-z0-9]{2,5}$/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');

  // ── Pintado ────────────────────────────────────────────────────────────────
  function render() {
    const host = document.getElementById('acciones-lista');
    if (!host) return;
    const sub = document.getElementById('acciones-sub');
    const nota = document.getElementById('acciones-nota');
    const estado = document.getElementById('acciones-estado');
    cargar();

    const period = data().metrics.period(data().latestMonth());
    if (!period) {
      host.innerHTML = '<p class="acciones-vacio">Sin datos del mes para sugerir acciones.</p>';
      if (sub) sub.textContent = 'Lo que toca hacer en Meta Ads, con las cifras del mes.';
      return;
    }

    const { hito, dia, enCurso } = hitoDe(period);
    const mes = `${period.month.year}-${String(period.month.month).padStart(2, '0')}`;
    const lista = acciones(period).sort((left, right) => {
      // El hito que corre va primero; dentro de cada hito, lo urgente antes que lo que puede esperar.
      const suyo = (item) => (item.hito === hito.key ? -1 : ORDEN.indexOf(item.hito));
      const tono = { red: 0, amber: 1, green: 2 };
      return suyo(left) - suyo(right) || tono[left.tono] - tono[right.tono];
    });

    if (sub) {
      sub.textContent = `${hito.semana} · ${hito.titulo}. ${enCurso ? `Día ${dia} de ${period.month.daysInMonth}` : `${period.month.name} ya cerró: se lee con su último día`}.`;
    }
    if (estado) {
      const hechas = lista.filter(item => marcada(mes, item.id)).length;
      estado.textContent = lista.length ? `${hechas} de ${lista.length} hechas` : '';
    }
    if (nota) {
      nota.textContent = 'Lo marcado se guarda solo en este navegador: otra persona no lo ve. Las acciones del hito de esta semana van primero, pero no se esconde ninguna.';
    }

    if (!lista.length) {
      host.innerHTML = `<p class="acciones-vacio">Nada que corregir con las cifras de ${period.label}: ningún objetivo se salió de su costo y ninguna pieza muestra desgaste.</p>`;
      return;
    }

    const esc = data().esc;
    host.innerHTML = lista.map(item => {
      const hecha = marcada(mes, item.id);
      const suHito = HITOS.find(h => h.key === item.hito);
      return `
        <label class="accion ${esc(item.tono)}${hecha ? ' hecha' : ''}">
          <input type="checkbox" data-accion="${esc(item.id)}"${hecha ? ' checked' : ''}>
          <span class="accion-cuerpo">
            <span class="accion-titulo">${esc(item.titulo)}</span>
            <span class="accion-porque">${esc(item.porque)}</span>
            <span class="accion-donde">${esc(item.donde)}</span>
          </span>
          <span class="accion-hito">${esc(suHito ? suHito.titulo : item.hito)}</span>
        </label>`;
    }).join('');

    host.querySelectorAll('[data-accion]').forEach(input => {
      input.addEventListener('change', () => {
        marcar(mes, input.dataset.accion, input.checked);
        input.closest('.accion')?.classList.toggle('hecha', input.checked);
        if (estado) {
          const hechas = lista.filter(item => marcada(mes, item.id)).length;
          estado.textContent = `${hechas} de ${lista.length} hechas`;
        }
      });
    });
  }

  window.TPAcciones = { render, acciones };
})();
