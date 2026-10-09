# Terminal Pesquero | Gasto publicitario 2026

Dashboard de Agencia Lima Retail para controlar la inversion publicitaria de Terminal Pesquero
(cevicheria).

Version actual: `v1.16.4`. El tablero comparte codigo base y numeracion de version con los
demas tableros de la agencia.

## Versionado

El proyecto usa la nomenclatura `vMAJOR.MINOR.PATCH`:

- `MAJOR`: cambios incompatibles o una nueva etapa del tablero.
- `MINOR`: nuevos modulos, indicadores o funciones compatibles.
- `PATCH`: correcciones visuales, de datos o funcionamiento.

## Modulos activos

- Gasto publicitario: los indicadores del reporte de Ads por mes, calculados con la descarga de Meta.
  - Resumen ejecutivo: inversion, impresiones, alcance, frecuencia y CPM, con la variacion contra el
    mismo tramo del mes anterior (por ejemplo 1-28 Sep vs 1-28 Ago; un mes cerrado se compara completo).
  - Resultados por objetivo (Interaccion, Notoriedad, Pedidos WhatsApp, Trafico...), cada uno con su
    propio resultado, costo por resultado, alcance, CPM y variacion. Debajo, las campanas del mes
    anterior que ya no tienen gasto (reorientadas).
  - Grafico lineal: inversion, impresiones, alcance o los resultados de un objetivo; acumulado del mes,
    por dia (contra el mes anterior en el mismo dia) o por mes.
  - Distribucion de inversion por campana y ranking de anuncios por objetivo (con el lider marcado,
    resultados del mes anterior y enlace a la vista previa). La tabla de anuncios tiene cabecera fija,
    columnas Objetivo / Anuncio ancladas, filtro por objetivo, pantalla completa (`Esc` para salir) y
    densidad compacta recordada en `localStorage`.
- Proyecciones: cierre de mes estimado por objetivo (resultados y gasto) y calculadora de inversion por CPL.
- Historico de Campanas: campanas finalizadas con su acumulado de todos los meses.
- Archivo de Reportes: catalogo de la carpeta de reportes en Google Drive y validacion contra Gasto publicitario.
- Bitácora: checklist mensual editable de cambios, comentarios y decisiones de la cuenta (ver "Bitácora").
- Usuarios y Claves: directorio de las cuentas con acceso al tablero, sin contraseñas (ver "Usuarios y Claves").

Los modulos Comparativo YoY, Distribucion, Productos Web y Usuarios y Claves se muestran
deshabilitados hasta su futura implementacion.

## Datos

La fuente son las descargas directas de Meta Ads ("Raw Data Report": una fila por dia x edad x sexo x
anuncio), guardadas como un Google Sheet por mes en la carpeta de Drive
`1EVeILJ9UBCMpbe5DUyiyoSOSsJ8woLx7`.

- Nombre de cada archivo: `Terminal Pesquero - <Mes> <Ano>` (por ejemplo `Terminal Pesquero - Octubre 2026`).
  Tiene que ser un Google Sheet (no `.xlsx`) y debe haber uno solo por mes; si hay dos, se usa el editado
  mas recientemente y la validacion lo avisa.
- El Web App de `scripts/google-sheets-sync.gs` lee esa carpeta y la de reportes, suma edad y sexo y
  guarda el barrido en un JSON de Drive. `js/data-source.js` (`window.TPData`) lo pide al abrir el
  tablero, cada hora y al volver a la pestana, y lo reparte a todos los modulos con el evento
  `tp:data-updated`.
- Barrido automatico: todos los dias entre 10:00 y 11:00 (hora de Lima), aunque nadie abra el
  tablero. Todo lo relacionado con la actualizacion esta en la esquina superior derecha: la pildora de
  estado abre el detalle (datos cargados, ultimo barrido con su origen, proximo automatico, archivo del
  mes y fuente) y al lado esta el unico boton **Actualizar**, que hace un barrido en el momento.
- El repo es publico, asi que ni la URL del Web App ni los datos del cliente se guardan en el:
  `npm run build` toma la URL del secret `TP_DATA_ENDPOINT`, baja el ultimo barrido y lo incrusta en
  `dist/index.html` (que solo se sirve con clave) junto con la URL. La copia queda tambien en
  `data/tp-meta-2026.json`, que esta en `.gitignore` y sirve de respaldo en desarrollo o si Google no responde.
- El objetivo se deduce del nombre de la campana (`Interaccion | Posts | ...`, `Campana pedidos WhatsApp | ...`)
  y su resultado de la columna "Tipo de resultado". El alcance es la suma de las filas de la descarga,
  igual que en los reportes de la agencia.

## Proyecciones

El modulo Proyecciones usa los mismos datos (`window.TPData`) y proyecta el ultimo mes con datos.

- Cada objetivo se proyecta por separado porque mide un resultado distinto (interacciones, ThruPlays,
  clics al boton de WhatsApp). Los resultados no se suman entre objetivos; solo el gasto tiene total del mes.
- Ritmo diario = acumulado al ultimo dia con datos / dias transcurridos desde el primer dia con datos; la
  proyeccion mantiene ese ritmo hasta el ultimo dia del mes.
- La linea de tiempo muestra el acumulado real de cada dia (resultados en el eje izquierdo y gasto en el
  derecho) del objetivo elegido. El punto actual queda fijo en el ultimo dia con datos y solo se arrastra
  en vertical, o se escribe en los campos bajo el grafico, para simular un escenario; tarjetas y tabla se
  recalculan al instante y la proyeccion original queda como referencia gris. Los escenarios viven solo en
  memoria y se pierden al recargar.
- El boton "Usar CPL real" pasa a la calculadora el costo por resultado del objetivo de WhatsApp.

## Validacion de reportes

El panel "Validacion con Gasto publicitario" (Archivo de Reportes) cruza, mes por mes, la descarga de Meta
con los reportes mensuales y parciales de la carpeta de reportes:

| Estado | Cuando |
| --- | --- |
| Sincronizado | Hay reporte y cubre el mes completo o, en el mes en curso, llega al menos al dia anterior al de la descarga. |
| Reporte desactualizado | El reporte mas reciente llega a un dia anterior al de los datos. |
| Falta reporte | El mes tiene gasto y no hay ningun reporte suyo. |
| Descarga incompleta | Un mes ya cerrado cuya descarga no llega al ultimo dia. |
| Archivo con error | El Sheet del mes no tiene la pestana o las columnas de Meta. |
| Sin descarga de Meta | Hay reportes de un mes cuya descarga no esta en la carpeta. |

La cobertura de un reporte sale del tramo de su nombre (`1-27Sep2026` = hasta el 27) o, si es mensual, del
dia anterior a su ultima edicion; si se edito despues del mes, lo cubre completo.

## Bitácora

Checklist por mes de los cambios, comentarios y decisiones de la cuenta. La version publicada es
`data/tp-bitacora-2026.json` (versionado en el repo; `npm run build` lo incrusta como `window.TP_BITACORA`
porque `dist/` no lleva `data/`). En desarrollo se lee con `fetch`.

```json
{
  "year": 2026,
  "updatedAt": "2026-09-28",
  "items": [
    { "id": "b01", "date": "2026-08-04", "type": "cambio", "platform": "meta", "done": true,
      "text": "Se activa Campaña pedidos WhatsApp desde el 4 de agosto" }
  ]
}
```

- `date` (`YYYY-MM-DD`) define el mes en que se agrupa el item.
- `type`: `cambio`, `comentario` o `decision` (otro valor se lee como `comentario`).
- `platform`: `general`, `meta` o `tiktok` (otro valor se lee como `general`). La lista vive en
  `js/bitacora.js` (`PLATFORMS`) y en el select del formulario de `index.html`.
- `done`: casilla marcada (hecho, aplicado o revisado). Los items nuevos usan `id` = `b` + timestamp en base 36.

Flujo editar → exportar → publicar:

1. En la vista Bitácora se agregan, marcan, editan o eliminan items. Cada edicion queda como borrador en
   `localStorage` (`tp-bitacora-draft`) de ese navegador; "Descartar borrador" vuelve a lo publicado.
2. **Exportar** descarga `tp-bitacora-2026.json` con `updatedAt` = hoy y los items ordenados por fecha.
3. Reemplazar `data/tp-bitacora-2026.json` con el archivo descargado, commit y push a `main` (el deploy lo publica).

El borrador guarda el `updatedAt` sobre el que se hizo: al publicar una version nueva, los borradores
hechos sobre la anterior se ignoran. Sin `localStorage` (modo privado) las ediciones duran hasta recargar
y Exportar sigue funcionando.

Ojo: mientras el repo sea publico, lo que se publique en la bitácora tambien lo es.

## Usuarios y Claves

Directorio de quien tiene acceso al tablero. El tablero publicado se abre con la clave unica de
`TP_PAGE_PASSWORD` (ver "Publicacion en terminalpesquero.limaretail.com"); aqui **nunca** se guarda
ninguna clave, ni en el repo ni en el HTML: esta vista solo lleva nombre, usuario de acceso, rol,
fecha de alta y estado. La version publicada es `data/tp-usuarios-2026.json` (el build la incrusta como
`window.TP_USUARIOS`).

```json
{
  "updatedAt": "2026-09-29",
  "users": [
    { "id": "u01", "name": "Nombre Apellido", "user": "cliente-tp", "role": "cliente",
      "status": "activo", "since": "2026-09-29" }
  ]
}
```

- `role`: `cliente`, `equipo` o `admin` (otro valor se lee como `cliente`).
- `status`: `activo` o `suspendido`. `user` es el usuario o correo con que se identifica a la persona
  (no es una cuenta del servidor) y se guarda en minusculas y sin espacios ni `:`.
- Se edita igual que la Bitácora: borrador en `localStorage` (`tp-usuarios-draft`), **Exportar** descarga
  `tp-usuarios-2026.json`, se reemplaza el archivo en `data/`, commit y push a `main`.
- La clave es una sola para todos (secret `TP_PAGE_PASSWORD`): dar acceso es entregarla, y quitarselo a
  alguien obliga a cambiarla y repartir la nueva. La vista muestra los pasos.

Ojo: mientras el repo sea publico (y GitHub Pages siga activo), los nombres de este directorio tambien lo son.

## Configuracion del Web App (Google Apps Script)

1. En [script.google.com](https://script.google.com) crear un proyecto independiente (no dentro de un Sheet)
   con la cuenta duena de las dos carpetas, pegar `scripts/google-sheets-sync.gs` y poner la zona horaria del
   proyecto en Lima.
2. Ejecutar una vez `installSweepTriggers()`: programa el barrido diario de las 10:00 y hace el
   primero. `probarBarrido()` muestra en el registro las filas, el gasto y el rango de fechas de cada mes.
3. Implementar > Nueva implementacion > Aplicacion web, ejecutar como "Yo" y acceso "Cualquier persona"
   (quien tenga la URL puede leer los numeros de las campanas; la URL solo esta dentro del tablero, que va con clave).
4. Guardar la URL `https://script.google.com/macros/s/.../exec` en GitHub > Settings > Secrets and variables >
   Actions como `TP_DATA_ENDPOINT` (para compilar en local: `TP_DATA_ENDPOINT=<url> npm run build`).
   Al cambiar el codigo del script: Implementar > Administrar implementaciones > editar > Nueva version (la URL no cambia).

| Que | Donde |
| --- | --- |
| Carpetas de descargas de Meta y de reportes | `scripts/google-sheets-sync.gs` (`DATA_FOLDER_ID`, `REPORTS_FOLDER_ID`) |
| URL del Web App | secret de GitHub `TP_DATA_ENDPOINT` (lo incrusta `scripts/build.js`) |
| Clave de acceso al tablero | secret de GitHub `TP_PAGE_PASSWORD` (ver "Publicacion en terminalpesquero.limaretail.com") |
| Logo | `assets/logo-terminal-pesquero.png` |
| Favicon | `assets/favicon.png` |

## Desarrollo

```
npm install
npm run dev      # live-server en el puerto 3000 (usa la copia data/tp-meta-2026.json, sin lectura en vivo)
npm run build    # genera dist/ con todo embebido (con TP_DATA_ENDPOINT baja los datos y activa la lectura en vivo)
```

El resultado se genera en `dist/`: `index.html` (CSS, JS y la copia de `data/tp-meta-2026.json`
incrustados), `assets/` y `CNAME`. Nada mas: `scripts/`, `data/` y el resto del repo nunca se publican.
Con `TP_PAGE_PASSWORD=<clave> npm run build` el `index.html` sale cifrado, como en GitHub Pages.

## Publicacion en terminalpesquero.limaretail.com (GitHub Pages)

URL publica: **https://terminalpesquero.limaretail.com**. Cada push a `main` la actualiza sola
(`.github/workflows/deploy-pages.yml`); no hay que volver a tocar el DNS ni la configuracion de Pages.

- Pages publica con Actions (sube `dist/`), asi que el dominio propio se configura en **Settings > Pages >
  Custom domain** y queda guardado en el repo. Ademas `CNAME` (raiz) lleva el dominio y `build.js` lo copia a
  `dist/`, igual que en el tablero de Casiopia.
- DNS en Banahosting (cPanel > Zone Editor > `limaretail.com`): registro **CNAME** `terminalpesquero` ->
  `jorgeluis666.github.io`. La URL vieja `https://jorgeluis666.github.io/objetivos-TP/` redirige (301) al dominio.
- **Clave:** Pages no tiene Basic Auth, asi que `scripts/build.js` cifra el tablero completo (datos, JS y URL del
  Web App) con AES-256-GCM y una llave PBKDF2-SHA256 (600 000 iteraciones) derivada del secret
  **`TP_PAGE_PASSWORD`**. `deploy/pages-gate.html` pide la clave y lo descifra en el navegador; sin ella el HTML
  publicado no revela nada. Si falta el secret, el workflow falla en vez de publicar el tablero sin clave.
  La pantalla usa el mismo diseno que el acceso de los demas tableros de la agencia (`auth-login.js` de
  Rekluta, fondo `assets/login-bg.jpg`), pero a diferencia de ese la clave no esta escrita en el codigo.
- Es una sola clave compartida. Como el HTML cifrado es publico, se puede atacar sin limite de intentos: usar
  una clave larga y aleatoria (16+ caracteres). Para cambiarla: editar el secret `TP_PAGE_PASSWORD` y volver a
  ejecutar el workflow (Actions > Publicar en GitHub Pages > Run workflow).
- Tras entrar, la llave queda en `sessionStorage` de esa pestana para no pedir la clave al recargar; cada deploy
  genera una sal nueva, asi que despues de publicar se vuelve a pedir.
