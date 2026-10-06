// Web App del tablero de Terminal Pesquero. Proyecto independiente de script.google.com.
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
const MANUAL_THROTTLE_MS = 60 * 1000;
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MONTH_PATTERNS = [
  /\bene(?:ro)?\b/, /\bfeb(?:rero)?\b/, /\bmar(?:zo)?\b/, /\babr(?:il)?\b/, /\bmay(?:o)?\b/, /\bjun(?:io)?\b/,
  /\bjul(?:io)?\b/, /\bago(?:sto)?\b/, /\bse(?:pt?|t)(?:iembre)?\b/, /\boct(?:ubre)?\b/, /\bnov(?:iembre)?\b/, /\bdic(?:iembre)?\b/,
];
// Cabeceras de la descarga de Meta (normalizadas: minusculas y sin tildes).
const RAW_COLUMNS = {
  day: 'dia',
  ad: 'nombre del anuncio',
  objective: 'objetivo',
  spend: 'importe gastado (pen)',
  impressions: 'impresiones',
  reach: 'alcance',
  clicks: 'clics en el enlace',
  interactions: 'interacciones con la publicacion',
  messages: 'conversaciones con mensajes iniciadas',
  resultType: 'tipo de resultado',
  results: 'resultados',
  campaign: 'nombre de la campana',
  adSet: 'nombre del conjunto de anuncios',
  preview: 'enlace de vista previa',
};
const REQUIRED_RAW = ['day', 'ad', 'spend', 'impressions', 'reach', 'results', 'campaign'];
const SUM_FIELDS = ['spend', 'impressions', 'reach', 'clicks', 'interactions', 'messages', 'results'];
// Filas que devuelve el Web App: una por dia x campana x conjunto x anuncio (se suman edad y sexo).
const OUTPUT_COLUMNS = ['day', 'campaign', 'adSet', 'ad', 'objective', 'resultType'].concat(SUM_FIELDS, ['preview']);

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
    const index = name => month.columns.indexOf(name);
    const spend = month.rows.reduce((sum, row) => sum + row[index('spend')], 0);
    const days = month.rows.map(row => row[index('day')]).sort();
    console.log(month.name + ' ' + month.year + ': ' + month.rows.length + ' filas, gasto S/ ' + spend.toFixed(2) +
      ', del ' + days[0] + ' al ' + days[days.length - 1] + (month.duplicates.length ? ' | duplicados: ' + month.duplicates.join(', ') : ''));
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
    const data = readMonths_();
    let reports;
    try {
      reports = readReports_();
    } catch (error) {
      console.error(error);
      reports = Object.assign({}, previous ? previous.reports : { folder: null, files: [] }, { error: 'No se pudo leer la carpeta de reportes.' });
    }
    const snapshot = { sweptAt: new Date().toISOString(), origin, months: data.months, ignored: data.ignored, reports };
    writeSnapshot_(snapshot);
    return snapshot;
  } finally {
    lock.releaseLock();
  }
}

// Un archivo por mes: si hay varios del mismo mes se usa el editado mas recientemente y se avisa.
function readMonths_() {
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
  const months = Object.keys(byMonth).sort().map(key => {
    const { period, file, duplicates } = byMonth[key];
    const entry = {
      name: MONTHS[period.month - 1], year: period.year, month: period.month,
      fileId: file.getId(), fileName: file.getName(), modifiedTime: file.getLastUpdated().toISOString(),
      duplicates, columns: OUTPUT_COLUMNS, rows: [], error: null,
    };
    try {
      const spreadsheet = SpreadsheetApp.openById(file.getId());
      entry.rows = aggregateRaw_(rawValues_(spreadsheet), spreadsheet.getSpreadsheetTimeZone());
    } catch (error) {
      entry.error = String((error && error.message) || error);
    }
    return entry;
  });
  return { months, ignored };
}

// La pestana con la descarga es la que tiene las cabeceras "Dia" e "Importe gastado (PEN)".
function rawValues_(spreadsheet) {
  const sheets = spreadsheet.getSheets();
  for (let i = 0; i < sheets.length; i += 1) {
    const values = sheets[i].getDataRange().getValues();
    const headerRow = values.findIndex(row => row.some(cell => normalize_(cell) === RAW_COLUMNS.day) && row.some(cell => normalize_(cell) === RAW_COLUMNS.spend));
    if (headerRow >= 0) return values.slice(headerRow);
  }
  throw new Error('No se encontro la descarga de Meta (columnas "Dia" e "Importe gastado (PEN)").');
}

// Suma edad y sexo. El alcance sumado es aproximado: Meta no permite sumar personas unicas entre filas.
function aggregateRaw_(values, timeZone) {
  const headers = values[0].map(normalize_);
  const col = {};
  Object.keys(RAW_COLUMNS).forEach(key => { col[key] = headers.indexOf(RAW_COLUMNS[key]); });
  const missing = REQUIRED_RAW.filter(key => col[key] < 0).map(key => RAW_COLUMNS[key]);
  if (missing.length) throw new Error('Faltan columnas: ' + missing.join(', '));

  const groups = {};
  values.slice(1).forEach(row => {
    const day = toDay_(row[col.day], timeZone);
    if (!day) return;
    const text = key => (col[key] < 0 ? '' : String(row[col[key]] || '').trim());
    const key = [day, text('campaign'), text('adSet'), text('ad')].join('|');
    let group = groups[key];
    if (!group) {
      group = groups[key] = { day, campaign: text('campaign'), adSet: text('adSet'), ad: text('ad'), objective: '', resultType: '', preview: '' };
      SUM_FIELDS.forEach(field => { group[field] = 0; });
    }
    if (!group.objective) group.objective = text('objective');
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
      createdTime: file.getDateCreated().toISOString(), modifiedTime: file.getLastUpdated().toISOString(),
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
