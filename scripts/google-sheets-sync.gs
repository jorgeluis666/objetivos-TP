// Web App del tablero de Terminal Pesquero. Proyecto independiente de script.google.com.
// Al cambiar este archivo: pegarlo en el proyecto y Implementar > Administrar implementaciones > editar > Nueva version.
// DATA_FOLDER_ID: un Google Sheet por mes, descarga directa de Meta Ads ("Raw Data Report": una fila por
// dia x edad x sexo x anuncio). Nombre: "Terminal Pesquero - Septiembre 2026".
// REPORTS_FOLDER_ID: reportes (PDF / video) del modulo Archivo de Reportes.
// GET ?action=data -> ultimo barrido | ?action=data&fresh=1 -> barrido en el momento (boton Actualizar).
const DATA_FOLDER_ID = '1EVeILJ9UBCMpbe5DUyiyoSOSsJ8woLx7';
const REPORTS_FOLDER_ID = '19IDo_fygI4JRfHvs665wGmAZ7egbDeiO';
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
    const snapshot = { version: SWEEP_VERSION, sweptAt: new Date().toISOString(), origin, months: data.months, ignored: data.ignored, reports };
    writeSnapshot_(snapshot);
    return snapshot;
  } finally {
    lock.releaseLock();
  }
}

// Un archivo por mes: si hay varios del mismo mes se usa el editado mas recientemente y se avisa.
// Un mes ya cerrado cuyo archivo no cambio desde el barrido anterior reutiliza sus filas sin abrir la hoja.
function readMonths_(previous) {
  const files = DriveApp.getFolderById(DATA_FOLDER_ID).getFiles();
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
  const folder = DriveApp.getFolderById(REPORTS_FOLDER_ID);
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
