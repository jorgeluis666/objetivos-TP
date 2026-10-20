(function () {
  const VIEW_KEY = 'tp-active-view';
  const VIEW_META = {
    'view-obj': {
      title: 'Gasto publicitario 2026',
      caption: 'Agencia Lima Retail',
      source: 'Fuente: Meta Ads / descargas mensuales en Google Drive',
      footer: 'Barrido automatico todos los dias a las 10:00',
    },
    'view-ads': {
      title: 'Anuncios',
      caption: 'Meta Ads por anuncio',
      source: 'Fuente: Meta Ads / descargas mensuales en Google Drive',
      footer: 'Mismo mes que Gasto publicitario',
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
    'view-week': {
      parent: 'view-reports',   // va dentro de Archivo de Reportes, con su pestaña
      title: 'Archivo de Reportes',
      caption: 'Generación de Reporte · Reporte de Publicidad en PDF',
      source: 'Fuente: descargas de Meta Ads / carpeta Reportes de Drive',
      footer: 'La semana que acaba de pasar, lista cada lunes',
    },
    'view-log': {
      title: 'Bitácora',
      caption: 'Checklist de cambios, comentarios y decisiones',
      source: 'Fuente: Bitácora del equipo de Agencia Lima Retail',
      footer: 'Las ediciones quedan como borrador hasta exportar y publicar el archivo',
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
    // El menú marca el módulo; las pestañas de adentro, la sección abierta.
    document.querySelectorAll('[data-view-target]').forEach(button => {
      const target = button.dataset.viewTarget;
      const active = target === viewId || (button.classList.contains('s-item') && target === meta.parent);
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
    });

    document.getElementById('topbar-title').textContent = meta.title;
    document.getElementById('topbar-caption').textContent = meta.caption;
    // El estado de los datos (#topbar-status) es el mismo en todos los modulos: lo mantiene js/data-source.js.
    document.getElementById('footer-source').textContent = meta.source;
    document.getElementById('footer-status').textContent = meta.footer;
    saveView(viewId);

    // Gasto publicitario y Anuncios comparten el mes: la que se abre se repinta si el mes cambio en la otra.
    if (viewId === 'view-obj' || viewId === 'view-ads') window.TPObjectives?.show(viewId);
    if (viewId === 'view-messages') window.TPProjections?.init();
    if (viewId === 'view-calculator') window.MessagesCalculator?.init();
    if (viewId === 'view-reports') window.ReportsArchive?.init();
    if (viewId === 'view-week') window.ReporteSemanal?.init();
    if (viewId === 'view-log') window.Bitacora?.init();
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
