#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const DIST_HTML = path.join(DIST_DIR, 'index.html');

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function main() {
  let html = readFile('index.html');
  const css = readFile('css/dashboard.css');
  const app = readFile('js/objectives.js');
  const messagesCalculator = readFile('js/messages-calculator.js');
  const navigation = readFile('js/navigation.js');
  const sidebar = readFile('js/sidebar.js');
  const reportsArchive = readFile('js/reports-archive.js');
  const projections = readFile('js/projections.js');
  const data = readFile('data/tp-ads-2026.json').replace(/</g, '\\u003c');
  const driveReports = readFile('data/tp-drive-reports.json').replace(/</g, '\\u003c');

  html = html.replace(
    new RegExp('<link rel=\"stylesheet\" href=\"css/dashboard\\.css(?:\\?v=[^\"]+)?\">'),
    `<style>${css}</style>`
  );
  html = html.replace(
    new RegExp('<script src=\"js/objectives\\.js(?:\\?v=[^\"]+)?\"><\\/script>'),
    `<script>${app}</script>`
  );
  html = html.replace(
    new RegExp('<script src="js\\/messages-calculator\\.js(?:\\?v=[^"]+)?"><\\/script>'),
    `<script>${messagesCalculator}</script>`
  );
  html = html.replace(
    new RegExp('<script src="js\\/navigation\\.js(?:\\?v=[^"]+)?"><\\/script>'),
    `<script>${navigation}</script>`
  );
  html = html.replace(
    new RegExp('<script src="js\\/sidebar\\.js(?:\\?v=[^"]+)?"><\\/script>'),
    `<script>${sidebar}</script>`
  );
  html = html.replace(
    new RegExp('<script src="js\\/projections\\.js(?:\\?v=[^"]+)?"><\\/script>'),
    `<script>${projections}</script>`
  );
  html = html.replace(
    new RegExp('<script src="js\\/reports-archive\\.js(?:\\?v=[^"]+)?"><\\/script>'),
    `<script>${reportsArchive}</script>`
  );
  html = html.replace(
    '</head>',
    `<script>window.TP_ADS_DATA = ${data};window.TP_DRIVE_REPORTS = ${driveReports};</script></head>`
  );

  fs.rmSync(DIST_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST_DIR, 'data'), { recursive: true });
  fs.writeFileSync(DIST_HTML, html, 'utf8');
  fs.copyFileSync(
    path.join(ROOT, 'data', 'tp-ads-2026.json'),
    path.join(DIST_DIR, 'data', 'tp-ads-2026.json')
  );

  fs.copyFileSync(
    path.join(ROOT, 'data', 'tp-drive-reports.json'),
    path.join(DIST_DIR, 'data', 'tp-drive-reports.json')
  );

  console.log(`[build] escrito dist/index.html (${(fs.statSync(DIST_HTML).size / 1024).toFixed(1)} KB)`);
}

try {
  main();
} catch (error) {
  console.error('[build] error:', error.message);
  process.exit(1);
}
