(function () {
  const STORAGE_KEY = 'rb-sidebar-collapsed';

  function getStoredState() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  }

  function saveState(collapsed) {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      // El dashboard también debe funcionar si el navegador bloquea localStorage.
    }
  }

  function wireSidebarToggle() {
    const shell = document.querySelector('.shell');
    const sidebar = document.getElementById('sidebar');
    const toggle = document.getElementById('sidebar-toggle');
    if (!shell || !sidebar || !toggle) return;

    const items = Array.from(sidebar.querySelectorAll('.s-item'));
    let collapsed = getStoredState();

    function render() {
      shell.classList.toggle('sidebar-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));

      const label = collapsed ? 'Expandir panel' : 'Minimizar panel';
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('title', label);

      // En la franja minimizada, el nombre del módulo aparece al pasar el mouse.
      items.forEach(function (item) {
        const name = item.querySelector('.s-title-nav')?.textContent.trim();
        // aria-label conserva el nombre accesible cuando el texto queda oculto.
        if (collapsed && name) {
          item.setAttribute('title', name);
          item.setAttribute('aria-label', name);
        } else {
          item.removeAttribute('title');
          item.removeAttribute('aria-label');
        }
      });
    }

    toggle.addEventListener('click', function () {
      collapsed = !collapsed;
      saveState(collapsed);
      render();

      window.setTimeout(function () {
        window.dispatchEvent(new Event('resize'));
      }, 250);
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireSidebarToggle);
  } else {
    wireSidebarToggle();
  }
})();
