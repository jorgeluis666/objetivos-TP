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

// El acceso lo controla Apache (HTTP Basic Auth), no el navegador. HTPASSWD_PATH es la ruta absoluta
// del archivo de claves en el servidor (la que crea cPanel > Privacidad de directorios). Si falta,
// se deja un marcador: Apache responde 500 en vez de servir el tablero sin clave.
function writeHtaccess(html) {
  const htpasswdPath = (process.env.HTPASSWD_PATH || '').trim();
  if (!htpasswdPath) console.warn('[build] falta HTPASSWD_PATH; dist/.htaccess queda con un marcador y el sitio no abrira');
  // CSP con el hash de cada <script> inline, porque el build mete todo el JS dentro del HTML.
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map(match => `'sha256-${crypto.createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
  const csp = [
    "default-src 'self'",
    `script-src 'self' https://cdnjs.cloudflare.com ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data: https:",
    "connect-src 'self' https://docs.google.com https://script.google.com https://script.googleusercontent.com",
    'frame-src https://drive.google.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
  const template = readFile('deploy/.htaccess');
  for (const token of ['__HTPASSWD_PATH__', '__CSP__']) {
    if (template.split(token).length !== 2) throw new Error(`deploy/.htaccess debe contener ${token} exactamente una vez`);
  }
  const output = template
    .replace('__HTPASSWD_PATH__', htpasswdPath || '/RUTA/NO/CONFIGURADA/.htpasswd')
    .replace('__CSP__', csp);
  fs.writeFileSync(path.join(DIST_DIR, '.htaccess'), output, 'utf8');
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

const DATA_ENDPOINT_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
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
  fs.writeFileSync(DIST_HTML, html, 'utf8');

  copyBrandAssets();
  writeHtaccess(html);

  console.log(`[build] escrito dist/index.html (${(fs.statSync(DIST_HTML).size / 1024).toFixed(1)} KB)`);
}

main().catch(error => {
  console.error('[build] error:', error.message);
  process.exit(1);
});
