(function () {
  const storageKey = 'law-case-theme';
  const savedTheme = localStorage.getItem(storageKey);
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.setAttribute('aria-label', theme === 'dark' ? '切换到浅色模式' : '切换到深色模式');
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    });
  }

  applyTheme(savedTheme || (systemDark ? 'dark' : 'light'));

  document.addEventListener('DOMContentLoaded', () => {
    applyTheme(document.documentElement.dataset.theme);

    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        localStorage.setItem(storageKey, next);
        applyTheme(next);
      });
    });

    const pathname = window.location.pathname;
    const currentPath = pathname === '/' || pathname === '/documents' || pathname.startsWith('/cases/') ? '/cases' : pathname;
    document.querySelectorAll('[data-nav-path]').forEach((link) => {
      if (link.dataset.navPath === currentPath) link.setAttribute('aria-current', 'page');
    });
  });
})();
