#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_HTML = path.join(DIST_DIR, 'index.html');

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

// El logo y el favicon se referencian por URL, no se inlinean: sin esta copia
// dist/ sale sin marca. La ruta del CSS se reescribe en main() porque al
// inlinearlo el '../assets/' dejaria de resolver dentro de dist/.
function copyBrandAssets() {
  const source = path.join(ROOT, 'assets');
  if (!fs.existsSync(source)) {
    console.warn('[build] falta assets/; dist quedara sin logo ni favicon');
    return;
  }
  fs.cpSync(source, path.join(DIST_DIR, 'assets'), { recursive: true });
  for (const asset of ['logo-terminal-pesquero.png', 'favicon.png']) {
    if (!fs.existsSync(path.join(source, asset))) {
      console.warn(`[build] falta assets/${asset}`);
    }
  }
}

// GitHub Pages no tiene Basic Auth: con TP_PAGE_PASSWORD el tablero se cifra (AES-256-GCM, llave
// PBKDF2-SHA256) dentro de deploy/pages-gate.html, que lo descifra en el navegador con la clave.
// La salida es compatible con WebCrypto: el tag de GCM va pegado al final del texto cifrado.
const PBKDF2_ITERATIONS = 600000;

function encryptPage(html, password) {
  // Sal fija por marca (no es secreta): la llave que recuerda el navegador sigue sirviendo despues de cada
  // deploy y solo deja de servir cuando cambia la clave. El iv si es nuevo en cada build.
  const salt = crypto.createHash('sha256').update('lr-gate:terminal-pesquero').digest().subarray(0, 16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(password.normalize('NFC'), salt, PBKDF2_ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(html, 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const payload = JSON.stringify({
    iterations: PBKDF2_ITERATIONS,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    data: data.toString('base64'),
  });
  const template = readFile('deploy/pages-gate.html');
  if (template.split('__PAYLOAD__').length !== 2) throw new Error('deploy/pages-gate.html debe contener __PAYLOAD__ exactamente una vez');
  return template.replace('__PAYLOAD__', () => payload).replace(/\r\n?/g, '\n');
}

const DATA_ENDPOINT_RE =/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
const SNAPSHOT_FILE = path.join(ROOT, 'data', 'tp-meta-2026.json');

// El repo es publico: la URL del Web App (secret TP_DATA_ENDPOINT) y los datos del cliente solo viven en
// dist/, que se sirve con clave. El build baja el ultimo barrido y lo incrusta como copia de respaldo; si
// Google no responde usa la copia local de data/ (gitignored) de un build anterior.
async function loadSnapshot(endpoint) {
  if (endpoint) {
    try {
      const response = await fetch(`${endpoint}?action=data`, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || payload.ok === false || !Array.isArray(payload.months)) throw new Error('respuesta sin meses');
      const text = JSON.stringify(payload);
      fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
      fs.writeFileSync(SNAPSHOT_FILE, text, 'utf8');
      return text;
    } catch (error) {
      console.warn(`[build] no se pudo bajar el barrido del Web App (${error.message}); se usa la copia local`);
    }
  }
  if (fs.existsSync(SNAPSHOT_FILE)) return fs.readFileSync(SNAPSHOT_FILE, 'utf8');
  console.warn('[build] sin copia de datos: el tablero dependera solo de la lectura en vivo');
  return 'null';
}

async function main() {
  const endpoint = (process.env.TP_DATA_ENDPOINT || '').trim();
  if (endpoint && !DATA_ENDPOINT_RE.test(endpoint)) throw new Error('TP_DATA_ENDPOINT no es una URL /exec de script.google.com');
  if (!endpoint) console.warn('[build] falta TP_DATA_ENDPOINT; el tablero no podra leer Google en vivo');

  let html = readFile('index.html');
  // Al inlinear el CSS la ruta pasa a resolverse desde dist/index.html,
  // asi que '../assets/' tiene que quedar como 'assets/'.
  const css = readFile('css/dashboard.css').replace(/\.\.\/assets\//g, 'assets/');
  // '\\u003c' es el texto \u003c (no el caracter <): un "</script>" en los datos cerraria el <script>.
  const metaData = (await loadSnapshot(endpoint)).replace(/</g, '\\u003c');

  // Reemplazos con funcion: una cadena de reemplazo interpretaria "$'" o "$&" dentro del codigo o de los datos.
  html = html.replace(/<link rel="stylesheet" href="css\/dashboard\.css(?:\?v=[^"]+)?">/, () => `<style>${css}</style>`);
  // Se incrustan, en el orden de index.html, todos los js/ que carga: no hay otra lista que mantener.
  html = html.replace(/<script src="js\/([\w-]+\.js)(?:\?v=[^"]+)?"><\/script>/g, (_, file) => `<script>${readFile(`js/${file}`)}</script>`);
  if (/<script src="js\//.test(html)) throw new Error('index.html carga un js/ que el build no incrusta');
  // La bitacora y el directorio de usuarios viajan incrustados: dist/ no lleva la carpeta data/.
  const inlineJson = file => JSON.stringify(JSON.parse(readFile(file))).replace(/</g, '\\u003c');
  const bitacora = inlineJson('data/tp-bitacora-2026.json');
  const usuarios = inlineJson('data/tp-usuarios-2026.json');
  const config = `window.TP_DATA_ENDPOINT = ${JSON.stringify(endpoint)};window.TP_META_DATA = ${metaData};window.TP_BITACORA = ${bitacora};window.TP_USUARIOS = ${usuarios};`;
  html = html.replace('</head>', () => `<script>${config}</script></head>`);

  // El navegador convierte CRLF en LF antes de calcular el hash CSP de cada <script>; si el HTML
  // conserva CRLF (archivos editados en Windows) los hashes no coinciden y el tablero no carga.
  html = html.replace(/\r\n?/g, '\n');

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(DIST_DIR, { recursive: true });
  const pagePassword = process.env.TP_PAGE_PASSWORD || '';
  fs.writeFileSync(DIST_HTML, pagePassword ? encryptPage(html, pagePassword) : html, 'utf8');
  if (pagePassword) console.log('[build] dist/index.html cifrado con TP_PAGE_PASSWORD');

  copyBrandAssets();
  // Dominio propio en GitHub Pages; va junto al sitio igual que en el tablero de Casiopia.
  fs.copyFileSync(path.join(ROOT, 'CNAME'), path.join(DIST_DIR, 'CNAME'));

  console.log(`[build] escrito dist/index.html (${(fs.statSync(DIST_HTML).size / 1024).toFixed(1)} KB)`);
}

main().catch(error => {
  console.error('[build] error:', error.message);
  process.exit(1);
});
