// Web App del tablero de Terminal Pesquero. Proyecto independiente de script.google.com.
// Al cambiar este archivo: pegarlo en el proyecto y Implementar > Administrar implementaciones > editar > Nueva version.
//
// Las carpetas que lee van en las propiedades del script (Configuracion del proyecto > Propiedades
// del script), no aqui: este repositorio es publico y un id deja ver que marcas atiende la agencia y
// como esta armado su Drive. Las cuatro propiedades, con el nombre exacto:
//
//   DATA_FOLDER_ID     01 Meta Ads. Una hoja de Google por mes, descarga directa de Meta Ads
//                      ("Raw Data Report": una fila por dia x edad x sexo x anuncio).
//                      Nombre del archivo: "Terminal Pesquero - Septiembre 2026".
//   REPORTS_FOLDER_ID  04 Reportes. Los PDF y videos del modulo Archivo de Reportes.
//   ARTES_FOLDER_ID    06 Artes. Una subcarpeta por campana y, dentro, la pieza de cada anuncio (un
//                      archivo suelto, o una subcarpeta "<anuncio> (Carrusel)" con una imagen por
//                      lamina). El tablero las pide a Drive con drive.google.com/thumbnail, asi que
//                      esa carpeta tiene que estar compartida por enlace.
//   REACH_SHEET_ID     La hoja de alcance unico. Opcional: sin ella se muestra el alcance sumado.
//
// Los ids estan en la hoja "Conexiones Drive Dashboard", pestaña Subcarpetas.
//
// GET ?action=data -> ultimo barrido | ?action=data&fresh=1 -> barrido en el momento (boton Actualizar).
const TIMEZONE = 'America/Lima';
const SWEEP_HOUR = 10;
const SWEEP_HANDLER = 'sweepScheduled';
const SNAPSHOT_PROPERTY = 'SNAPSHOT_FILE_ID';
const SNAPSHOT_NAME = 'Terminal Pesquero - barrido del tablero.json';
// Subirla al cambiar aggregateRaw_, toDay_, toNumber_, RAW_COLUMNS, OUTPUT_COLUMNS o TIMEZONE: los meses
// guardados con otra version se vuelven a leer aunque su archivo no haya cambiado.
const SWEEP_VERSION = 1;
const MANUAL_THROTTLE_MS = 60 * 1000;
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTH_PATTERNS = [
  /\bene(?:ro)?\b/, /\bfeb(?:rero)?\b/, /\bmar(?:zo)?\b/, /\babr(?:il)?\b/, /\bmay(?:o)?\b/, /\bjun(?:io)?\b/,
  /\bjul(?:io)?\b/, /\bago(?:sto)?\b/, /\bse(?:pt?|t)(?:iembre)?\b/, /\boct(?:ubre)?\b/, /\bnov(?:iembre)?\b/, /\bdic(?:iembre)?\b/,
];
// Cabeceras de la descarga de Meta (normalizadas: minusculas y sin tildes). Meta renombra algunas entre
// descargas (Octubre 2026: "Importe gastado" pasa a "Monto gastado"): se acepta cualquiera de la lista.
const RAW_COLUMNS = {
  day: ['dia'],
  ad: ['nombre del anuncio'],
  spend: ['importe gastado (pen)', 'monto gastado (pen)'],
  impressions: ['impresiones'],
  reach: ['alcance'],
  clicks: ['clics en el enlace'],
  resultType: ['tipo de resultado'],
  results: ['resultados'],
  campaign: ['nombre de la campana'],
  adSet: ['nombre del conjunto de anuncios'],
  preview: ['enlace de vista previa'],
};
const REQUIRED_RAW = ['day', 'ad', 'spend', 'impressions', 'reach', 'results', 'campaign'];
const SUM_FIELDS = ['spend', 'impressions', 'reach', 'clicks', 'results'];
// Filas que devuelve el Web App: una por dia x campana x conjunto x anuncio (se suman edad y sexo).
const OUTPUT_COLUMNS = ['day', 'campaign', 'adSet', 'ad', 'resultType'].concat(SUM_FIELDS, ['preview']);

// Las carpetas vienen de las propiedades del script, nunca del codigo (ver la cabecera). Si falta
// una obligatoria se para aqui con un mensaje claro, en vez de fallar mas adelante sin decir por que.
function carpetaId_(nombre, obligatoria) {
  const valor = (PropertiesService.getScriptProperties().getProperty(nombre) || '').trim();
  if (!valor && obligatoria) {
    throw new Error('Falta la propiedad de script ' + nombre + '. Configuracion del proyecto > Propiedades del script.');
  }
  return valor;
}

function doGet(event) {
  try {
    const params = (event && event.parameter) || {};
    if (params.action !== 'data') throw new Error('Accion no soportada.');
    const snapshot = params.fresh === '1' ? sweep_('manual') : (readSnapshot_() || sweep_('inicial'));
    return json_(Object.assign({ ok: true }, snapshot));
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: 'No se pudo leer la carpeta de datos.' });
  }
}

// Disparador diario.
function sweepScheduled() {
  sweep_('automatico');
}

// Ejecutar UNA vez a mano. Borra los disparadores anteriores del barrido para no duplicarlos.
function installSweepTriggers() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === SWEEP_HANDLER)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger(SWEEP_HANDLER).timeBased().everyDays(1).atHour(SWEEP_HOUR).inTimezone(TIMEZONE).create();
  logSnapshot_(sweep_('instalacion'));
}

// Barrido manual desde el editor, para revisar que los archivos se leen bien.
function probarBarrido() {
  logSnapshot_(sweep_('prueba'));
}

function logSnapshot_(snapshot) {
  console.log('Barrido ' + snapshot.origin + ' ' + snapshot.sweptAt + ' | diario ' + SWEEP_HOUR + ':00 (' + TIMEZONE + ')');
  snapshot.months.forEach(month => {
    if (month.error) {
      console.log(month.name + ' ' + month.year + ': ERROR ' + month.error);
      return;
    }
    const duplicates = month.duplicates.length ? ' | duplicados: ' + month.duplicates.join(', ') : '';
    if (!month.rows.length) {
      console.log(month.name + ' ' + month.year + ': sin filas con fecha valida' + duplicates);
      return;
    }
    const index = name => month.columns.indexOf(name);
    const spend = month.rows.reduce((sum, row) => sum + row[index('spend')], 0);
    const days = month.rows.map(row => row[index('day')]).sort();
    console.log(month.name + ' ' + month.year + ': ' + month.rows.length + ' filas, gasto S/ ' + spend.toFixed(2) +
      ', del ' + days[0] + ' al ' + days[days.length - 1] + duplicates);
  });
  snapshot.ignored.forEach(item => console.log('Ignorado: ' + item.fileName + ' -> ' + item.reason));
  console.log('Reportes en Drive: ' + snapshot.reports.files.length);
}

function sweep_(origin) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const previous = readSnapshot_();
    if (origin === 'manual' && previous && Date.now() - Date.parse(previous.sweptAt) < MANUAL_THROTTLE_MS) return previous;
    const data = readMonths_(previous);
    let reports;
    try {
      reports = readReports_();
    } catch (error) {
      console.error(error);
      reports = Object.assign({}, previous ? previous.reports : { folder: null, files: [] }, { error: 'No se pudo leer la carpeta de reportes.' });
    }
    // Las piezas son accesorias: si su carpeta falla, el barrido sigue con los meses y los reportes.
    let artes;
    try {
      artes = readArtes_();
    } catch (error) {
      console.error(error);
      artes = Object.assign({}, previous ? previous.artes : { folder: null, piezas: {} }, { error: 'No se pudo leer la carpeta de artes.' });
    }
    // El alcance unico tampoco tumba el barrido: sin el, el tablero muestra el sumado y lo advierte.
    let alcance;
    try {
      alcance = readReach_();
    } catch (error) {
      console.error(error);
      alcance = { ventanas: {}, error: 'No se pudo leer la hoja de alcance unico.' };
    }
    const snapshot = { version: SWEEP_VERSION, sweptAt: new Date().toISOString(), origin, months: data.months, ignored: data.ignored, reports, artes, alcance };
    writeSnapshot_(snapshot);
    return snapshot;
  } finally {
    lock.releaseLock();
  }
}

// Un archivo por mes: si hay varios del mismo mes se usa el editado mas recientemente y se avisa.
// Un mes ya cerrado cuyo archivo no cambio desde el barrido anterior reutiliza sus filas sin abrir la hoja.
function readMonths_(previous) {
  const files = DriveApp.getFolderById(carpetaId_('DATA_FOLDER_ID', true)).getFiles();
  const byMonth = {};
  const ignored = [];
  while (files.hasNext()) {
    const file = files.next();
    if (file.isTrashed()) continue;
    if (file.getMimeType() !== MimeType.GOOGLE_SHEETS) {
      ignored.push({ fileName: file.getName(), reason: 'No es un Google Sheet (Archivo > Guardar como Hojas de calculo de Google).' });
      continue;
    }
    const period = detectPeriod_(file.getName());
    if (!period) {
      ignored.push({ fileName: file.getName(), reason: 'El nombre no indica mes y ano.' });
      continue;
    }
    const current = byMonth[period.key];
    if (!current) byMonth[period.key] = { period, file, duplicates: [] };
    else if (file.getLastUpdated() > current.file.getLastUpdated()) {
      current.duplicates.push(current.file.getName());
      current.file = file;
    } else current.duplicates.push(file.getName());
  }
  // Meses del barrido anterior que se leyeron bien, por archivo.
  const before = {};
  ((previous && previous.months) || []).forEach(month => { if (!month.error) before[month.fileId] = month; });
  const sameVersion = Boolean(previous && previous.version === SWEEP_VERSION);
  const recentKey = previousMonthKey_();
  const months = Object.keys(byMonth).sort().map(key => {
    const { period, file, duplicates } = byMonth[key];
    const entry = {
      name: MONTHS[period.month - 1], year: period.year, month: period.month,
      fileId: file.getId(), fileName: file.getName(), modifiedTime: file.getLastUpdated().toISOString(),
      duplicates, columns: OUTPUT_COLUMNS, rows: [], error: null,
    };
    const old = before[entry.fileId];
    const unchanged = Boolean(old && old.modifiedTime === entry.modifiedTime && Array.isArray(old.rows) && Array.isArray(old.columns));
    // El mes en curso y el anterior se releen siempre: el anterior se completa los primeros dias del mes y
    // Drive tarda en actualizar la fecha de edicion de un Sheet.
    if (unchanged && sameVersion && key < recentKey && JSON.stringify(old.columns) === JSON.stringify(OUTPUT_COLUMNS)) {
      entry.rows = old.rows;
      return entry;
    }
    try {
      const spreadsheet = SpreadsheetApp.openById(file.getId());
      entry.rows = aggregateRaw_(rawValues_(spreadsheet), spreadsheet.getSpreadsheetTimeZone());
    } catch (error) {
      if (unchanged && old.rows.length) {
        // El archivo no cambio desde el barrido anterior: un fallo pasajero de Google no borra sus filas.
        console.error(entry.fileName + ': ' + error);
        entry.columns = old.columns;
        entry.rows = old.rows;
      } else {
        entry.error = String((error && error.message) || error);
      }
    }
    return entry;
  });
  return { months, ignored };
}

// Mes anterior al de hoy en Lima ('yyyy-MM'): ese y los siguientes no se reutilizan del barrido anterior.
function previousMonthKey_() {
  const [year, month] = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-M').split('-').map(Number);
  return month === 1 ? (year - 1) + '-12' : year + '-' + String(month - 1).padStart(2, '0');
}

// La pestana con la descarga es la que tiene las cabeceras "Dia" e "Importe gastado (PEN)" (o "Monto gastado").
function rawValues_(spreadsheet) {
  const sheets = spreadsheet.getSheets();
  for (let i = 0; i < sheets.length; i += 1) {
    const values = sheets[i].getDataRange().getValues();
    const headerRow = values.findIndex(row => row.some(cell => isColumn_('day', cell)) && row.some(cell => isColumn_('spend', cell)));
    if (headerRow >= 0) return values.slice(headerRow);
  }
  throw new Error('No se encontro la descarga de Meta (columnas "Dia" e "Importe gastado (PEN)" o "Monto gastado (PEN)").');
}

function isColumn_(key, cell) {
  return RAW_COLUMNS[key].indexOf(normalize_(cell)) >= 0;
}

// Suma edad y sexo. El alcance sumado es aproximado: Meta no permite sumar personas unicas entre filas.
function aggregateRaw_(values, timeZone) {
  const headers = values[0].map(cell => normalize_(cell));
  const col = {};
  Object.keys(RAW_COLUMNS).forEach(key => { col[key] = headers.findIndex(cell => RAW_COLUMNS[key].indexOf(cell) >= 0); });
  const missing = REQUIRED_RAW.filter(key => col[key] < 0).map(key => RAW_COLUMNS[key].join(' / '));
  if (missing.length) throw new Error('Faltan columnas: ' + missing.join(', '));

  // Cada fecha se repite en miles de filas (edad x sexo x anuncio): se formatea una sola vez.
  const days = new Map();
  const dayOf = value => {
    if (!(value instanceof Date)) return toDay_(value, timeZone);
    const time = value.getTime();
    if (!days.has(time)) days.set(time, toDay_(value, timeZone));
    return days.get(time);
  };

  const groups = {};
  values.slice(1).forEach(row => {
    const day = dayOf(row[col.day]);
    if (!day) return;
    const text = key => (col[key] < 0 ? '' : String(row[col[key]] || '').trim());
    const key = [day, text('campaign'), text('adSet'), text('ad')].join('|');
    let group = groups[key];
    if (!group) {
      group = groups[key] = { day, campaign: text('campaign'), adSet: text('adSet'), ad: text('ad'), resultType: '', preview: '' };
      SUM_FIELDS.forEach(field => { group[field] = 0; });
    }
    if (!group.resultType) group.resultType = text('resultType');
    if (!group.preview && /^https:\/\//.test(text('preview'))) group.preview = text('preview');
    SUM_FIELDS.forEach(field => { group[field] += col[field] < 0 ? 0 : toNumber_(row[col[field]]); });
  });

  return Object.keys(groups).sort().map(key => {
    const group = groups[key];
    group.spend = Math.round(group.spend * 100) / 100;
    return OUTPUT_COLUMNS.map(field => group[field]);
  });
}

// Una celda de fecha llega como Date: se formatea en la zona de la hoja para no correr el dia.
function toDay_(value, timeZone) {
  if (value instanceof Date) return Utilities.formatDate(value, timeZone || TIMEZONE, 'yyyy-MM-dd');
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
}

function toNumber_(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const number = Number(String(value || '').replace(/,/g, '').trim());
  return Number.isFinite(number) ? number : 0;
}

function readReports_() {
  const folder = DriveApp.getFolderById(carpetaId_('REPORTS_FOLDER_ID', true));
  const files = folder.getFiles();
  const list = [];
  while (files.hasNext()) {
    const file = files.next();
    if (file.isTrashed()) continue;
    list.push({
      id: file.getId(), title: file.getName(), mimeType: file.getMimeType(), sizeBytes: file.getSize(),
      modifiedTime: file.getLastUpdated().toISOString(),
    });
  }
  return { folder: { id: folder.getId(), name: folder.getName(), url: folder.getUrl() }, files: list };
}

// ── Alcance unico ────────────────────────────────────────────────────────────
// El export no lo trae: viene partido por dia, edad y sexo, y sumar esa columna cuenta varias veces
// a la misma persona (octubre: 388,322 sumado frente a 248,027 reales). Meta solo lo da sin duplicar
// por ventana completa, asi que se guarda en una hoja aparte, una fila por ventana y ambito, y el
// tablero la usa cuando encuentra la ventana exacta. Tampoco se puede recortar: el alcance del 1 al
// 11 no sale del alcance del 1 al 25.
//
// El id de esa hoja va en las propiedades del script (REACH_SHEET_ID), no aqui: este repositorio es
// publico. Sin la propiedad, el tablero sigue con el alcance sumado y lo dice.
// Columnas: Desde | Hasta | Ambito | Alcance | Frecuencia. Ambito es "(cuenta)" o el nombre exacto
// de la campaña.
function readReach_() {
  const id = carpetaId_('REACH_SHEET_ID', false);
  if (!id) return { ventanas: {} };
  const values = SpreadsheetApp.openById(id).getSheets()[0].getDataRange().getValues();
  const ventanas = {};
  for (let fila = 1; fila < values.length; fila += 1) {
    const desde = toDay_(values[fila][0], TIMEZONE);
    const hasta = toDay_(values[fila][1], TIMEZONE);
    const ambito = String(values[fila][2] || '').trim();
    const alcance = toNumber_(values[fila][3]);
    if (!desde || !hasta || !ambito || !alcance) continue;
    const clave = desde + '..' + hasta;
    if (!ventanas[clave]) ventanas[clave] = { cuenta: null, campanas: {} };
    const dato = { alcance: alcance, frecuencia: toNumber_(values[fila][4]) || null };
    if (ambito === '(cuenta)') ventanas[clave].cuenta = dato;
    else ventanas[clave].campanas[ambito] = dato;
  }
  return { ventanas: ventanas };
}

// ── Artes: la pieza de cada anuncio ──────────────────────────────────────────
// Devuelve { folder, piezas: { "<clave>": {tipo, nombre, campana, id | laminas} } }. La clave es el
// nombre del archivo sin extension, sin el "(Carrusel)" del final, sin tildes y sin signos: la misma
// que arteKey() del tablero, para que un anuncio encuentre su pieza aunque Meta escriba el nombre con
// otra puntuacion. Una pieza suelta en la raiz de la carpeta tambien vale.
const CARRUSEL_RE = /\s*\((carrusel|carousel)\)\s*$/i;

function arteKey_(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(CARRUSEL_RE, '')
    .replace(/\.[A-Za-z0-9]{2,5}$/, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// Los archivos sueltos de una carpeta, como piezas de un solo archivo.
function addArtesOf_(folder, campana, piezas) {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.isTrashed()) continue;
    const mime = String(file.getMimeType() || '');
    const tipo = mime.indexOf('video/') === 0 ? 'video' : mime.indexOf('image/') === 0 ? 'imagen' : '';
    if (!tipo) continue;
    const clave = arteKey_(file.getName());
    if (!clave || piezas[clave]) continue; // la primera que aparece se queda
    piezas[clave] = { tipo: tipo, nombre: file.getName(), campana: campana, id: file.getId() };
  }
}

function readArtes_() {
  const root = DriveApp.getFolderById(carpetaId_('ARTES_FOLDER_ID', true));
  const piezas = {};
  addArtesOf_(root, '', piezas);

  const campaigns = root.getFolders();
  while (campaigns.hasNext()) {
    const campaign = campaigns.next();
    if (campaign.isTrashed()) continue;
    const campana = campaign.getName();
    addArtesOf_(campaign, campana, piezas);

    // Solo una subcarpeta "(Carrusel)" es un anuncio; cualquier otra se ignora.
    const subs = campaign.getFolders();
    while (subs.hasNext()) {
      const sub = subs.next();
      if (sub.isTrashed() || !CARRUSEL_RE.test(sub.getName())) continue;
      const laminas = [];
      const images = sub.getFiles();
      while (images.hasNext()) {
        const image = images.next();
        if (image.isTrashed() || String(image.getMimeType() || '').indexOf('image/') !== 0) continue;
        laminas.push({ id: image.getId(), nombre: image.getName() });
      }
      // Las laminas no traen numero en el nombre: van alfabeticamente y el tablero lo advierte.
      laminas.sort(function (a, b) { return a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0; });
      const clave = arteKey_(sub.getName());
      if (!clave || piezas[clave]) continue;
      piezas[clave] = {
        tipo: 'carrusel', nombre: sub.getName().replace(CARRUSEL_RE, ''), campana: campana,
        laminas: laminas.map(function (lamina) { return lamina.id; }), ordenIncierto: true,
      };
    }
  }

  return { folder: { id: root.getId(), name: root.getName(), url: root.getUrl() }, piezas: piezas };
}

// Si el nombre no trae ano se asume el ano en curso; si ese mes aun no llega, el ano anterior.
function detectPeriod_(name) {
  const text = normalize_(name)
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[_.\-]+/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2');
  const monthIndex = earliestMonth_(text);
  if (monthIndex < 0) return null;
  const yearMatch = text.match(/\b(20\d{2})\b/);
  let year = yearMatch ? Number(yearMatch[1]) : null;
  if (!year) {
    const now = new Date();
    const currentYear = Number(Utilities.formatDate(now, TIMEZONE, 'yyyy'));
    const currentMonth = Number(Utilities.formatDate(now, TIMEZONE, 'M'));
    year = monthIndex + 1 > currentMonth ? currentYear - 1 : currentYear;
  }
  return { key: year + '-' + String(monthIndex + 1).padStart(2, '0'), year, month: monthIndex + 1 };
}

// Si el nombre trae varias palabras de mes, gana la que aparece primero en el texto. Acepta "Setiembre".
function earliestMonth_(text) {
  let best = -1;
  let position = Infinity;
  MONTH_PATTERNS.forEach((pattern, index) => {
    const match = text.match(pattern);
    if (match && match.index < position) {
      best = index;
      position = match.index;
    }
  });
  return best;
}

function snapshotFile_() {
  const id = PropertiesService.getScriptProperties().getProperty(SNAPSHOT_PROPERTY);
  if (!id) return null;
  try {
    const file = DriveApp.getFileById(id);
    return file.isTrashed() ? null : file;
  } catch (error) {
    return null;
  }
}

function readSnapshot_() {
  const file = snapshotFile_();
  if (!file) return null;
  try {
    const snapshot = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    // Un barrido guardado con el formato anterior (sin columnas) se descarta y se vuelve a leer.
    return snapshot.months && snapshot.months.every(month => month.columns) ? snapshot : null;
  } catch (error) {
    return null;
  }
}

// El JSON del barrido queda en Mi unidad de la cuenta que publica, fuera de las carpetas de datos y reportes.
function writeSnapshot_(snapshot) {
  const content = JSON.stringify(snapshot);
  const file = snapshotFile_();
  if (file) {
    file.setContent(content);
    return;
  }
  const created = DriveApp.createFile(SNAPSHOT_NAME, content, MimeType.PLAIN_TEXT);
  PropertiesService.getScriptProperties().setProperty(SNAPSHOT_PROPERTY, created.getId());
}

function normalize_(value) {
  return String(value == null ? '' : value).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function json_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
