# Terminal Pesquero | Gasto publicitario 2026

Dashboard de Agencia Lima Retail para controlar la inversion publicitaria de Terminal Pesquero
(cevicheria).

Version actual: `v1.10.0`. El tablero comparte codigo base y numeracion de version con los
demas tableros de la agencia.

## Versionado

El proyecto usa la nomenclatura `vMAJOR.MINOR.PATCH`:

- `MAJOR`: cambios incompatibles o una nueva etapa del tablero.
- `MINOR`: nuevos modulos, indicadores o funciones compatibles.
- `PATCH`: correcciones visuales, de datos o funcionamiento.

## Modulo activo

- Gasto mensual total.
- Distribucion entre Branding y Ventas.
- Campanas por mes.
- Estado, objetivo, presupuesto, gasto, importe diario y URL de anuncios.
- Proyecciones: cierre de mes estimado con los datos reales y calculadora de inversion por CPL.
- Historico de Campanas finalizadas.
- Archivo de Reportes: catalogo de los documentos guardados en la carpeta de Google Drive.
- Navegacion de la tabla de campanas: cabecera fija, columnas Tipo / Campana / Anuncio ancladas
  a la izquierda, modo pantalla completa (boton o `Esc` para salir) y densidad compacta
  recordada en `localStorage`.

Los modulos Comparativo YoY, Distribucion, Productos Web y Usuarios y Claves se muestran
deshabilitados hasta su futura implementacion.

## Datos

La fuente normalizada del dashboard esta en `data/tp-ads-2026.json`. Arranca vacia: los doce meses
de 2026 existen con gasto cero y sin campanas, a la espera de la primera carga real.

El tablero se alimenta de un Google Sheet publicado como CSV. A medida que se cierra cada mes, el
mes queda archivado en su propio `data/tp-<mes>-sheet-2026.json` y se engancha agregando su ruta al
arreglo `CLOSED_MONTH_URLS` en `js/objectives.js`.

Para que la lectura del CSV funcione, el spreadsheet debe estar compartido como "cualquier persona
con el enlace / lector". Si se restringe, el boton Actualizar deja de funcionar y hay que refrescar
el JSON a mano.

## Proyecciones

El modulo Proyecciones lee los datos del modulo Gasto publicitario a traves de
`window.TPObjectives.snapshot()` y proyecta el cierre del mes en curso.

- El mes proyectado es el que corresponde a la fecha de corte (`cutoff`); si no tiene gasto, se usa
  el ultimo mes con datos.
- Ritmo diario = acumulado real / dias con datos; la proyeccion mantiene ese ritmo hasta el ultimo
  dia del mes.
- La linea de tiempo marca el dia de la ultima actualizacion y compara contra el presupuesto
  (inversion) o el objetivo de reservas.
- Cada sincronizacion con Google Sheets emite el evento `tp:data-updated` y el modulo se recalcula
  solo.

## Configuracion pendiente

Estos valores estan vacios a proposito y hay que cargarlos antes de publicar:

| Que | Donde |
| --- | --- |
| ID del Google Sheet | `js/objectives.js` (`SHEET_ID`) y `scripts/google-sheets-sync.gs` (`SPREADSHEET_ID`) |
| Carpeta de Drive de reportes | `index.html` (`reports-folder-link`) y `data/tp-drive-reports.json` |
| Contrasena de acceso | `index.html`, al final (`AuthLogin.init`) |
| Logo | `assets/logo-terminal-pesquero.png` |
| Favicon | `assets/favicon.png` |
| Fondo del login | `login-bg.jpg` en la raiz |

## Desarrollo

```
npm install
npm run dev      # live-server en el puerto 3000
npm run build    # genera dist/index.html con todo embebido
```

## Despliegue

GitHub Pages desde el repositorio `jorgeluis666/objetivos-TP`
(https://jorgeluis666.github.io/objetivos-TP/). El archivo `.nojekyll` evita que Pages procese el
sitio con Jekyll.
