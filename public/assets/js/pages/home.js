(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    RB.renderPublicHeader();
    RB.renderPublicFooter();
    RB.currentYear();

    RB.boot().then(function (current) {
      if (!current.user) return;
      var actions = RB.$('.hero-actions');
      if (actions && !RB.$('[data-dashboard-link]', actions)) {
        var link = document.createElement('a');
        link.className = 'btn btn-soft btn-lg';
        link.href = RB.dashboardPath(current.user.role);
        link.setAttribute('data-dashboard-link', '');
        link.innerHTML =
          '<i class="bi bi-grid-1x2 me-2"></i>Open ' +
          (current.user.role === 'admin' ? 'administration' : 'my dashboard');
        actions.appendChild(link);
      }
    });
  });
})();
