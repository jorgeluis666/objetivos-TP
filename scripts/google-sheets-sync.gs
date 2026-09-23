const SPREADSHEET_ID = ''; // PENDIENTE: ID del Google Sheet de Terminal Pesquero
const DEFAULT_SHEET_NAME = 'Agosto';
// Solo se escribe en las pestañas mensuales de SPREADSHEET_ID. La peticion ya no puede elegir otro
// spreadsheet: antes cualquiera con la URL del Web App podia escribir en cualquier Sheet del propietario.
const ALLOWED_SHEETS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function doPost(event) {
  try {
    const payload = JSON.parse(event.postData.contents || '{}');
    if (payload.action !== 'updateReservationGoal') {
      throw new Error('Accion no soportada.');
    }
    const result = updateReservationGoal_(payload);
    return json_({ ok: true, result });
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: 'No se pudo actualizar el objetivo.' });
  }
}

function updateReservationGoal_(payload) {
  if (!SPREADSHEET_ID) throw new Error('Falta configurar SPREADSHEET_ID.');
  const sheetName = payload.sheetName || DEFAULT_SHEET_NAME;
  if (ALLOWED_SHEETS.indexOf(sheetName) < 0) throw new Error('Hoja no permitida.');
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) throw new Error('No se encontro la hoja solicitada.');

  const values = sheet.getDataRange().getDisplayValues();
  const headerRow = values.findIndex(row => row.some(cell => normalize_(cell) === 'tipo') && row.some(cell => normalize_(cell) === 'estado'));
  if (headerRow < 0) throw new Error('No se encontro la fila de cabeceras.');

  const headers = values[headerRow].map(normalize_);
  const campaignCol = headers.indexOf('campana');
  const adCol = headers.indexOf('anuncio');
  const goalCol = headers.indexOf('objetivo reservas');
  const typeCol = headers.indexOf('tipo');
  if (campaignCol < 0 || adCol < 0 || goalCol < 0 || typeCol < 0) throw new Error('Cabeceras requeridas incompletas.');

  const campaign = String(payload.campaign || '').trim();
  const ad = String(payload.ad || '').trim();
  const campaignRows = [];
  let currentCampaign = '';
  values.forEach((row, index) => {
    if (index <= headerRow) return;
    if (normalize_(row[typeCol]).startsWith('total')) return;
    const rowCampaign = String(row[campaignCol] || '').trim();
    if (rowCampaign) currentCampaign = rowCampaign;
    if (currentCampaign === campaign) campaignRows.push({ row, index });
  });
  if (!campaignRows.length) throw new Error('No se encontro la campana en el sheet.');

  const cleanValue = payload.value === '' || payload.value == null ? '' : Number(payload.value);
  if (cleanValue !== '' && !(Number.isInteger(cleanValue) && cleanValue >= 0 && cleanValue <= 100000)) {
    throw new Error('Valor de objetivo invalido.');
  }
  let rowIndex;
  if (payload.campaignLevel || ad === '__campaign__') {
    rowIndex = campaignRows[0].index;
    sheet.getRange(rowIndex + 1, goalCol + 1).setValue(cleanValue);
    campaignRows.slice(1).forEach(item => sheet.getRange(item.index + 1, goalCol + 1).setValue(''));
  } else {
    const match = campaignRows.find(item => String(item.row[adCol] || '').trim() === ad);
    if (!match) throw new Error('No se encontro la fila de campana/anuncio en el sheet.');
    rowIndex = match.index;
    sheet.getRange(rowIndex + 1, goalCol + 1).setValue(cleanValue);
  }

  const totalRow = values.findIndex((row, index) => index > headerRow && normalize_(row[typeCol]).startsWith('total'));
  if (totalRow >= 0) {
    const freshValues = sheet.getDataRange().getDisplayValues();
    const total = freshValues.reduce((sum, row, index) => {
      if (index <= headerRow || index === totalRow) return sum;
      const number = Number(String(row[goalCol] || '').replace(/,/g, '').trim());
      return Number.isFinite(number) ? sum + number : sum;
    }, 0);
    sheet.getRange(totalRow + 1, goalCol + 1).setValue(total);
  }

  SpreadsheetApp.flush();
  return { campaign, ad, value: cleanValue };
}

function normalize_(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
