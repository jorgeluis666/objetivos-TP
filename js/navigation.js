(function () {
  const VIEW_KEY = 'tp-active-view';
  const VIEW_META = {
    'view-obj': {
      title: 'Gasto publicitario 2026',
      caption: 'Agencia Lima Retail',
      source: 'Fuente: Meta Ads / descargas mensuales en Google Drive',
      footer: 'Barrido automatico todos los dias a las 10:00',
    },
    'view-messages': {
      title: 'Proyecciones',
      caption: 'Cierre de mes por objetivo',
      source: 'Fuente: Gasto publicitario / Meta Ads',
      footer: 'Proyección lineal según el ritmo del mes',
    },
    'view-calculator': {
      title: 'Calculadora de Inversión',
      caption: 'Objetivo comercial e inversión por CPL',
      source: 'Fuente: valores ingresados / CPL real de Meta Ads',
      footer: 'Los valores se guardan en este navegador',
    },
    'view-history': {
      title: 'Histórico de Campañas',
      caption: 'Campañas activas y finalizadas',
      source: 'Fuente: Meta Ads / todos los meses con descarga',
      footer: 'Todas las campañas de las descargas de Drive',
    },
    'view-reports': {
      title: 'Archivo de Reportes',
      caption: 'Documentos en Google Drive',
      source: 'Fuente: Carpeta compartida Reportes Terminal Pesquero / Google Drive',
      footer: 'Validado contra las descargas de Meta del modulo Gasto publicitario',
    },
    'view-log': {
      title: 'Bitácora',
      caption: 'Checklist de cambios, comentarios y decisiones',
      source: 'Fuente: Bitácora del equipo de Agencia Lima Retail',
      footer: 'Las ediciones quedan como borrador hasta exportar y publicar el archivo',
    },
    'view-users': {
      title: 'Usuarios y Claves',
      caption: 'Cuentas con acceso al tablero',
      source: 'Fuente: Directorio de accesos de Agencia Lima Retail',
      footer: 'La clave única descifra el tablero en el navegador; aquí no se guarda ninguna',
    },
  };

  function storedView() {
    try {
      const value = window.localStorage.getItem(VIEW_KEY);
      return VIEW_META[value] ? value : 'view-obj';
    } catch {
      return 'view-obj';
    }
  }

  function saveView(viewId) {
    try {
      window.localStorage.setItem(VIEW_KEY, viewId);
    } catch {
      // La navegación sigue funcionando aunque localStorage no esté disponible.
    }
  }

  function showView(viewId) {
    const meta = VIEW_META[viewId] || VIEW_META['view-obj'];
    document.querySelectorAll('.view').forEach(view => {
      view.classList.toggle('visible', view.id === viewId);
    });
    document.querySelectorAll('[data-view-target]').forEach(button => {
      const active = button.dataset.viewTarget === viewId;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });

    document.getElementById('topbar-title').textContent = meta.title;
    document.getElementById('topbar-caption').textContent = meta.caption;
    // El estado de los datos (#topbar-status) es el mismo en todos los modulos: lo mantiene js/data-source.js.
    document.getElementById('footer-source').textContent = meta.source;
    document.getElementById('footer-status').textContent = meta.footer;
    saveView(viewId);

    if (viewId === 'view-messages') window.TPProjections?.init();
    if (viewId === 'view-calculator') window.MessagesCalculator?.init();
    if (viewId === 'view-reports') window.ReportsArchive?.init();
    if (viewId === 'view-log') window.Bitacora?.init();
    if (viewId === 'view-users') window.Usuarios?.init();
  }

  function initNavigation() {
    document.querySelectorAll('[data-view-target]').forEach(button => {
      button.addEventListener('click', () => showView(button.dataset.viewTarget));
    });
    showView(storedView());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNavigation);
  } else {
    initNavigation();
  }
})();
