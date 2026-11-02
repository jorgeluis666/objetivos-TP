#!/usr/bin/env node
/* ============================================================
   scripts/alertas.js — Alerta semanal de Meta Ads.

   Sale los lunes a las 7:00 a. m. de Lima (ALERTA_MOTIVO=lunes) y a mano.

   Este guion es identico en Terminal Pesquero, Mr. Paleta y Mr. Sushi: lo que cambia de una marca a
   otra vive en data/alertas-config.json (nombre, enlace, color, el nombre del secreto del Web App y
   la copia local). Si corriges algo aqui, corrigelo en las tres.

   De donde salen los datos: el repositorio NO los tiene. Viven en el Web App del barrido y el build
   los incrusta en la pagina. Asi que aqui se piden igual que en scripts/build.js; si el secreto no
   esta, se usa la copia que el ultimo build dejo en disco. Sin ninguna de las dos no hay alerta, y
   se dice en voz alta en vez de mandar un correo en blanco.

   El barrido devuelve filas por dia, campana y anuncio: aqui se suman por mes y por tipo de
   resultado, que es como Meta nombra lo que conto en cada caso.

   Uso:
     node scripts/alertas.js --dry-run     simula y muestra el correo que saldria
     node scripts/alertas.js --preview x   escribe el HTML en un archivo, sin enviar
     node scripts/alertas.js --force       reenvia aunque la semana ya este registrada
   ============================================================ */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const readJson = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const ARGS = process.argv.slice(2);
const DRY_RUN = ARGS.includes('--dry-run') || process.env.DRY_RUN === 'true';
const FORCE = ARGS.includes('--force');
const PREVIEW = ARGS.includes('--preview') ? ARGS[ARGS.indexOf('--preview') + 1] : null;
const MOTIVO = process.env.ALERTA_MOTIVO || 'manual';

const limaDate = () => new Date(Date.now() - 5 * 3600 * 1000);

function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return `${date.getUTCFullYear()}-W${String(Math.ceil(((date - start) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

const money = v => `S/. ${Number(v || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const moneyCorto = v => `S/. ${Math.round(Number(v || 0)).toLocaleString('es-PE')}`;
const count = v => Number(v || 0).toLocaleString('es-PE');
const signedPct = v => (v > 0 ? '+' : '') + Math.round(v) + '%';
const ratio = (a, b) => (b ? a / b : null);
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const config = readJson('data/alertas-config.json');
if (process.env.DASHBOARD_URL) config.url_dashboard = config.url_dashboard || process.env.DASHBOARD_URL;
const enviosPath = path.join(ROOT, 'data/alertas-envios.json');
const enviosData = readJson('data/alertas-envios.json');

const lima = limaDate();
const weekKey = isoWeek(lima);
const fechaLabel = lima.toLocaleDateString('es-PE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

// Mismo contrato que scripts/build.js: dos intentos y, si falla, la copia local del ultimo build.
async function cargarBarrido() {
  const endpoint = (process.env[config.endpoint_env] || process.env.DATA_ENDPOINT || '').trim();
  if (endpoint) {
    for (let intento = 1; intento <= 2; intento += 1) {
      try {
        const res = await fetch(`${endpoint}?action=data`, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const payload = await res.json();
        if (payload.ok === false || !Array.isArray(payload.months)) throw new Error(payload.error || 'respuesta sin meses');
        return { payload, fuente: `Web App (barrido ${String(payload.sweptAt || '').slice(0, 10)})` };
      } catch (error) {
        console.warn(`  Intento ${intento}: no se pudo leer el barrido (${error.message})`);
      }
    }
  }
  if (fs.existsSync(path.join(ROOT, config.copia_local))) {
    return { payload: readJson(config.copia_local), fuente: `${config.copia_local} (copia del último build)` };
  }
  return { payload: null, fuente: null };
}

/* ── Que cuenta Meta en cada fila ────────────────────────────
   El barrido no trae el objetivo de la campana, trae `resultType`: el nombre con el que Meta conto
   el resultado. Son los que mandan, y no valen lo mismo — una conversacion no es un ThruPlay—, asi
   que cada uno lleva su nivel: 1 contacto directo, 2 intencion, 3 alcance. El correo pone delante
   los de nivel mas bajo, que son los que le importan al cliente. Un tipo que no este en la tabla
   entra como nivel 2 con su propio nombre, para que nunca desaparezca del correo.          */
const TIPOS = [
  { busca: 'compras', nivel: 1, unidad: 'compras', singular: 'compra' },
  { busca: 'contactos', nivel: 1, unidad: 'contactos', singular: 'contacto' },
  { busca: 'clientes potenciales', nivel: 1, unidad: 'clientes potenciales', singular: 'cliente potencial' },
  { busca: 'conversaciones', nivel: 1, unidad: 'conversaciones', singular: 'conversación' },
  { busca: 'busquedas de ubicaciones', nivel: 2, unidad: 'búsquedas de local', singular: 'búsqueda de local' },
  { busca: 'visitas al perfil', nivel: 2, unidad: 'visitas al perfil', singular: 'visita al perfil' },
  { busca: 'clics en el enlace', nivel: 2, unidad: 'clics', singular: 'clic' },
  { busca: 'interacciones', nivel: 3, unidad: 'interacciones', singular: 'interacción' },
  { busca: 'thruplay', nivel: 3, unidad: 'reproducciones', singular: 'reproducción' },
  { busca: 'reproducciones', nivel: 3, unidad: 'reproducciones', singular: 'reproducción' },
];
const sinTildes = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function tipoDe(resultType) {
  const texto = sinTildes(resultType);
  if (!texto) return { nombre: 'Sin resultado registrado', nivel: 4, unidad: 'resultados', singular: 'resultado' };
  const conocido = TIPOS.find(t => texto.indexOf(t.busca) >= 0);
  return conocido
    ? { nombre: String(resultType), nivel: conocido.nivel, unidad: conocido.unidad, singular: conocido.singular }
    : { nombre: String(resultType), nivel: 2, unidad: String(resultType).toLowerCase(), singular: String(resultType).toLowerCase() };
}
const plural = (valor, tipo) => (Number(valor) === 1 ? tipo.singular : tipo.unidad);

// ── Sumar las filas del mes ──────────────────────────────────
function resumir(mes) {
  const at = Object.fromEntries(mes.columns.map((name, i) => [name, i]));
  const cifras = ['spend', 'impressions', 'reach', 'clicks', 'results'].filter(c => at[c] != null);
  const total = Object.fromEntries(cifras.map(c => [c, 0]));
  const porTipo = new Map();
  const porCampana = new Map();
  const dias = new Set();

  for (const fila of mes.rows || []) {
    const dia = String(fila[at.day] || '');
    if (dia) dias.add(dia);
    const tipo = tipoDe(fila[at.resultType]);
    const campana = String(fila[at.campaign] || '').trim();
    const t = porTipo.get(tipo.nombre) || { ...tipo, spend: 0, results: 0 };
    const c = porCampana.get(campana) || { spend: 0, results: 0 };
    const gasto = Number(fila[at.spend]) || 0;
    const res = Number(fila[at.results]) || 0;
    for (const campo of cifras) total[campo] += Number(fila[at[campo]]) || 0;
    t.spend += gasto; t.results += res;
    c.spend += gasto; c.results += res;
    porTipo.set(tipo.nombre, t);
    if (campana) porCampana.set(campana, c);
  }
  const ordenados = [...dias].sort();
  // Nivel primero y, dentro del mismo nivel, lo que mas gasto se llevo.
  const tipos = [...porTipo.values()].sort((a, b) => (a.nivel - b.nivel) || (b.spend - a.spend));
  return {
    total,
    tipos,
    conResultado: tipos.filter(t => t.results > 0),
    campanas: [...porCampana.entries()].map(([nombre, v]) => ({ nombre, ...v })).sort((a, b) => b.spend - a.spend),
    ultimoDia: ordenados[ordenados.length - 1] || null,
    nDias: dias.size,
  };
}

(async () => {
  console.log(`\n▶ Alerta de Meta Ads ${weekKey}${DRY_RUN ? ' [DRY-RUN]' : ''}`);
  console.log(`  Marca      : ${config.marca}`);
  console.log(`  Fecha Lima : ${fechaLabel}`);

  const { payload, fuente } = await cargarBarrido();
  if (!payload) {
    console.error(`\n❌ Sin datos: no hay ${config.endpoint_env} ni copia local en ${config.copia_local}.`);
    console.error('   Este repositorio no guarda el barrido; hay que pasarle el endpoint.\n');
    process.exit(1);
  }
  console.log(`  Datos      : ${fuente}`);

  const meses = payload.months
    .filter(m => Array.isArray(m.columns) && Array.isArray(m.rows))
    .map(m => ({ meta: m, r: resumir(m) }))
    .filter(x => x.r.total.spend > 0)
    .sort((a, b) => (a.meta.year - b.meta.year) || (a.meta.month - b.meta.month));

  if (!meses.length) {
    console.log('\n⏭  Todavía no hay un mes con inversión: no hay alerta que enviar.\n');
    process.exit(0);
  }

  const { meta: mes, r } = meses[meses.length - 1];
  const anterior = meses.length > 1 ? meses[meses.length - 2] : null;
  const K = r.total;

  const diasMes = new Date(mes.year, mes.month, 0).getDate();
  const diaCorte = r.ultimoDia ? Number(r.ultimoDia.slice(8, 10)) : r.nDias;
  const completo = diaCorte >= diasMes;
  const proyectar = v => (completo ? Number(v || 0) : (Number(v || 0) / diaCorte) * diasMes);
  const gastoCierre = proyectar(K.spend);
  const nombreMes = `${mes.name} ${mes.year}`;

  // Los dos resultados que encabezan el correo: los de nivel mas bajo que de verdad ocurrieron.
  const titulares = r.conResultado.slice(0, 2);
  const principal = titulares[0] || null;
  const previo = principal && anterior ? anterior.r.conResultado.find(t => t.nombre === principal.nombre) : null;
  const costoAhora = principal ? ratio(principal.spend, principal.results) : null;
  const costoAntes = previo ? ratio(previo.spend, previo.results) : null;

  // ── Avisos y nivel ─────────────────────────────────────────
  const avisos = [];
  avisos.push({ tone: 'blue', titulo: `Semana ${Math.ceil(diaCorte / 7)} del mes`, cuerpo: `Datos al día ${diaCorte} de ${diasMes}. Al ritmo de ahora, ${mes.name} cierra en ${moneyCorto(gastoCierre)}.` });

  if (!principal) {
    avisos.push({ tone: 'red', titulo: 'El mes no registra ningún resultado', cuerpo: `${money(K.spend)} invertidos sin un solo resultado contado por Meta.` });
  } else if (costoAhora != null && costoAntes != null && costoAhora > costoAntes * 1.3) {
    avisos.push({ tone: 'amber', titulo: `El costo por ${principal.singular} sube ${signedPct((costoAhora / costoAntes - 1) * 100)}`, cuerpo: `De ${money(costoAntes)} en ${anterior.meta.name} a ${money(costoAhora)}.` });
  }

  // Una campana que se lleva mas del 10% del gasto y no devuelve nada es lo primero que hay que mirar.
  r.campanas
    .filter(c => c.spend > K.spend * 0.1 && !c.results)
    .forEach(c => avisos.push({ tone: 'red', titulo: `«${c.nombre}» gasta sin resultados`, cuerpo: `${money(c.spend)} sin un solo resultado contado.` }));

  const NIVELES = { red: { txt: '🚨 Riesgo', label: 'Riesgo' }, amber: { txt: '⚠️ Atención', label: 'Atención' }, blue: { txt: '✅ En marcha', label: 'En marcha' } };
  const nivel = avisos.some(a => a.tone === 'red') ? 'red' : avisos.some(a => a.tone === 'amber') ? 'amber' : 'blue';

  // ── Idempotencia ───────────────────────────────────────────
  const huella = crypto.createHash('sha256').update(JSON.stringify({ mes: nombreMes, dia: diaCorte, K, tipos: r.tipos.map(t => [t.nombre, t.results]) })).digest('hex').slice(0, 16);
  console.log(`  Mes        : ${nombreMes} · día ${diaCorte} de ${diasMes}${completo ? ' (completo)' : ''}`);
  console.log(`  Motivo     : ${MOTIVO}`);
  if (!FORCE && !DRY_RUN && !PREVIEW) {
    if (MOTIVO === 'datos' && enviosData.ultimaHuella === huella) {
      console.log('\n⏭  Las cifras del mes no cambiaron desde el último envío.\n');
      process.exit(0);
    }
    if (MOTIVO !== 'datos' && enviosData.enviados[weekKey]) {
      console.log(`\n⏭  Semana ${weekKey} ya registrada (${enviosData.enviados[weekKey]}). Usa --force para reenviar.\n`);
      process.exit(0);
    }
  }

  console.log(`\n📊 ${nombreMes}:`);
  console.log(`   Invertido   : ${money(K.spend)} → cierre ${money(gastoCierre)}`);
  r.tipos.forEach(t => console.log(`   ${t.nombre.padEnd(42)}: ${money(t.spend)} · ${count(t.results)} ${plural(t.results, t)}`));
  console.log(`   Nivel       : ${NIVELES[nivel].label}`);
  avisos.forEach(a => console.log(`   · [${a.tone}] ${a.titulo}`));

  // ── Email ──────────────────────────────────────────────────
  const C = { bg: '#f6fbff', card: '#ffffff', border: '#dbeafe', text: '#0f172a', muted: '#64748b', brand: config.color || '#2563eb', red: '#dc2626', amber: '#b45309' };
  const FONT = "Inter,-apple-system,'Segoe UI',sans-serif";
  // El tono de un aviso se dice con la tarjeta entera —fondo suave y borde fino del mismo color en
  // los cuatro lados—, como en el correo de Aquarius. Nada de barras de acento al costado: estan
  // prohibidas en Lima Retail.
  const TONO = {
    red:   { fg: '#b91c1c', bd: '#fecaca', box: '#fef2f2' },
    amber: { fg: '#b45309', bd: '#fde68a', box: '#fffbeb' },
    blue:  { fg: '#1d4ed8', bd: '#bfdbfe', box: '#eff6ff' },
  };
  const URL_TABLERO = String(config.url_dashboard).replace(/#.*$/, '').replace(/\/?$/, '/');

  const tarjeta = (rotulo, valor, sub) => `
    <td width="33%" valign="top" style="padding:0 6px;">
      <table role="presentation" width="100%" style="border:1px solid ${C.border};border-radius:12px;border-collapse:separate;background:${C.card};">
        <tr><td style="padding:14px 16px;font-family:${FONT};">
          <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${C.muted};font-weight:700;">${esc(rotulo)}</div>
          <div style="font-size:22px;font-weight:700;color:${C.text};padding-top:4px;">${esc(valor)}</div>
          <div style="font-size:11px;color:${C.muted};padding-top:2px;">${esc(sub)}</div>
        </td></tr>
      </table>
    </td>`;

  const tarjetasTitular = titulares.map(t => tarjeta(t.unidad, count(t.results), `${money(ratio(t.spend, t.results))} c/u`));
  while (tarjetasTitular.length < 2) tarjetasTitular.push('<td width="33%"></td>');

  const filaTipo = t => `<tr>
      <td style="padding:9px 12px;border-top:1px solid ${C.border};font-family:${FONT};font-size:13px;color:${C.text};font-weight:600;">${esc(t.nombre)}</td>
      <td align="right" style="padding:9px 12px;border-top:1px solid ${C.border};font-family:${FONT};font-size:13px;color:${C.text};">${money(t.spend)}</td>
      <td align="right" style="padding:9px 12px;border-top:1px solid ${C.border};font-family:${FONT};font-size:13px;color:${C.text};">${t.results ? `${count(t.results)} <span style="color:${C.muted};font-size:11px;">${esc(plural(t.results, t))}</span>` : `<span style="color:${C.muted};font-size:12px;">—</span>`}</td>
      <td align="right" style="padding:9px 12px;border-top:1px solid ${C.border};font-family:${FONT};font-size:13px;color:${C.muted};">${t.results ? money(ratio(t.spend, t.results)) : '—'}</td>
    </tr>`;

  const avisoHTML = a => {
    const t = TONO[a.tone] || TONO.blue;
    return `
    <tr><td style="padding:0 0 10px;">
      <table role="presentation" width="100%" style="border:1px solid ${t.bd};border-radius:10px;border-collapse:separate;background:${t.box};">
        <tr><td style="padding:12px 14px;font-family:${FONT};">
          <div style="font-size:13px;font-weight:700;color:${t.fg};">${esc(a.titulo)}</div>
          <div style="font-size:12px;color:${C.muted};padding-top:3px;line-height:1.5;">${esc(a.cuerpo)}</div>
        </td></tr>
      </table>
    </td></tr>`;
  };

  const htmlEmail = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:${C.bg};">
<table role="presentation" width="100%" style="background:${C.bg};"><tr><td align="center" style="padding:26px 12px;">
<table role="presentation" width="620" style="max-width:620px;">

  <tr><td style="padding:0 0 16px;font-family:${FONT};">
    <div style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:${C.muted};font-weight:700;">Lima Retail · Meta Ads</div>
    <div style="font-size:21px;font-weight:700;color:${C.text};padding-top:3px;">${esc(config.marca)} · ${esc(nombreMes)}</div>
    <div style="font-size:12px;color:${C.muted};padding-top:3px;">Datos al día ${diaCorte} de ${diasMes}${completo ? ' · mes completo' : ''} · ${esc(NIVELES[nivel].label)}</div>
  </td></tr>

  <tr><td style="padding:0 0 14px;"><table role="presentation" width="100%"><tr>
    ${tarjeta('Inversión', money(K.spend), completo ? 'mes cerrado' : `cierre ${moneyCorto(gastoCierre)}`)}
    ${tarjetasTitular.join('')}
  </tr></table></td></tr>

  <tr><td style="padding:0 0 16px;">
    <table role="presentation" width="100%" style="border:1px solid ${C.border};border-radius:12px;border-collapse:separate;background:${C.card};">
      <tr>
        <td style="padding:11px 12px;font-family:${FONT};font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${C.muted};font-weight:700;">Resultado</td>
        <td align="right" style="padding:11px 12px;font-family:${FONT};font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${C.muted};font-weight:700;">Inversión</td>
        <td align="right" style="padding:11px 12px;font-family:${FONT};font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${C.muted};font-weight:700;">Cuántos</td>
        <td align="right" style="padding:11px 12px;font-family:${FONT};font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:${C.muted};font-weight:700;">Costo</td>
      </tr>
      ${r.tipos.map(filaTipo).join('')}
    </table>
  </td></tr>

  ${avisos.map(avisoHTML).join('')}

  <tr><td align="center" style="padding:18px 0 8px;">
    <a href="${URL_TABLERO}" style="display:inline-block;background:${C.brand};color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:9px;font-size:14px;font-weight:600;font-family:${FONT};">Ver el tablero de ${esc(config.marca)}</a>
  </td></tr>
  <tr><td align="center" style="padding:8px 0 0;font-size:11px;line-height:1.6;color:${C.muted};font-family:${FONT};">
    ${esc(config.workspace)} · alerta automática (${weekKey}): los lunes a las 7:00 a. m.<br>
    Descargas de Meta Ads de la carpeta de Drive; el cierre proyectado usa el ritmo del mes.
  </td></tr>

</table></td></tr></table></body></html>`;

  if (PREVIEW) {
    fs.writeFileSync(PREVIEW, htmlEmail, 'utf8');
    console.log(`\n🖼  Vista previa escrita en ${PREVIEW} (sin envío).\n`);
    return;
  }

  const resumenTitular = titulares.length
    ? titulares.map(t => `${count(t.results)} ${plural(t.results, t)}`).join(' y ')
    : 'sin resultados';
  const subject = `${NIVELES[nivel].txt} · ${nombreMes} · ${resumenTitular} · ${moneyCorto(K.spend)} · Lima Retail`;

  const lista = config.destinatarios || [];
  const fuenteLista = 'data/alertas-config.json';
  const para = lista.map(d => (d.nombre ? `${d.nombre} <${d.email}>` : d.email)).join(', ');

  if (DRY_RUN) {
    console.log('\n─────────────────────────────────────────');
    console.log('[DRY-RUN] Email que se enviaría:');
    console.log('  Asunto :', subject);
    console.log('  Para   :', para || '(nadie)', `· ${fuenteLista}`);
    console.log('  Tamaño :', Math.round(htmlEmail.length / 1024), 'KB');
    console.log('[DRY-RUN] Sin envíos reales. FIN.\n');
    return;
  }

  if (!lista.length) {
    console.log(`\n⏭  La lista de destinatarios está vacía (${fuenteLista}): no se envía.\n`);
    return;
  }

  const toList = lista.map(d => d.email);
  const smtp = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'].every(name => process.env[name]);
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!smtp && !RESEND_KEY) {
    console.error('\n❌ Falta la configuración de envío: SMTP_HOST, SMTP_USER y SMTP_PASS, o RESEND_API_KEY.\n');
    process.exit(1);
  }

  console.log(`\n📧 Enviando a: ${para} (${fuenteLista})`);
  console.log(`   Asunto: ${subject}`);

  function registrarEnvio() {
    if (MOTIVO !== 'datos') enviosData.enviados[weekKey] = new Date().toISOString();
    enviosData.ultimaHuella = huella;
    enviosData.ultimoEnvio = { fecha: new Date().toISOString(), motivo: MOTIVO, mes: nombreMes };
    fs.writeFileSync(enviosPath, JSON.stringify(enviosData, null, 2) + '\n', 'utf8');
    console.log(`📝 Registrado en alertas-envios.json: ${MOTIVO === 'datos' ? 'datos actualizados' : weekKey}\n`);
  }

  if (smtp) {
    const nodemailer = require('nodemailer');
    const port = Number(process.env.SMTP_PORT) || 465;
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port, secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    // El remitente es la misma cuenta que se autentica: los hostings rechazan un "From" de otra cuenta.
    const from = /@/.test(process.env.SMTP_USER) ? process.env.SMTP_USER : config.from_email;
    const info = await transporter.sendMail({ from: `${config.from_name} <${from}>`, to: toList, subject, html: htmlEmail });
    console.log(`\n✅ Email enviado por el correo del hosting (${process.env.SMTP_HOST}). ID: ${info.messageId || '(sin id)'}`);
    registrarEnvio();
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: `${config.from_name} <${config.from_email}>`, to: toList, subject, html: htmlEmail }),
  });
  const body = await res.json().catch(() => res.text());
  if (!res.ok) {
    console.error(`\n❌ Error Resend ${res.status}:`, JSON.stringify(body, null, 2));
    process.exit(1);
  }
  console.log(`\n✅ Email enviado. Resend ID: ${body.id || '(desconocido)'}`);
  registrarEnvio();
})().catch(error => {
  console.error('\n❌ Error fatal:', error.message);
  process.exit(1);
});
