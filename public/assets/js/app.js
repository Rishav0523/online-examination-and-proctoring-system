/*
 * Royal Bengal Online Examination System — shared browser runtime.
 * Base-path aware API client, session guards, shared navigation and UI helpers.
 * No third-party runtime dependencies beyond the vendored Bootstrap and Chart.js.
 */
(function (window, document) {
  'use strict';

  var rootUrl = new URL('.', document.baseURI);
  var BASE = rootUrl.pathname;
  if (!BASE.endsWith('/')) BASE += '/';

  var App = { base: BASE };

  /* ------------------------------------------------------------------ */
  /* utilities                                                          */
  /* ------------------------------------------------------------------ */

  App.url = function (path) {
    return new URL(String(path).replace(/^\/+/, ''), rootUrl).toString();
  };

  App.href = function (path) {
    return BASE + String(path).replace(/^\/+/, '');
  };

  App.qs = function (name) {
    return new URLSearchParams(window.location.search).get(name);
  };

  App.idParam = function () {
    var value = Number(App.qs('id'));
    return Number.isInteger(value) && value > 0 ? value : null;
  };

  App.escape = function (value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  App.$ = function (selector, scope) {
    return (scope || document).querySelector(selector);
  };

  App.$$ = function (selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  };

  App.debounce = function (fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var self = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        fn.apply(self, args);
      }, wait);
    };
  };

  App.initials = function (name) {
    var parts = String(name || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  App.avatar = function (name, extraClass) {
    return (
      '<span class="avatar ' +
      (extraClass || '') +
      '" aria-hidden="true">' +
      App.escape(App.initials(name)) +
      '</span>'
    );
  };

  var dateFormat = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  var dateTimeFormat = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  var timeFormat = new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });

  App.formatDate = function (iso) {
    var date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '—' : dateFormat.format(date);
  };

  App.formatDateTime = function (iso) {
    if (!iso) return '—';
    var date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '—' : dateTimeFormat.format(date);
  };

  App.formatTime = function (iso) {
    var date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '—' : timeFormat.format(date);
  };

  App.formatDuration = function (minutes) {
    var value = Number(minutes) || 0;
    var hours = Math.floor(value / 60);
    var mins = value % 60;
    if (hours && mins) return hours + ' h ' + mins + ' min';
    if (hours) return hours + ' h';
    return mins + ' min';
  };

  App.formatCountdown = function (seconds) {
    var total = Math.max(0, Math.floor(Number(seconds) || 0));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var secs = total % 60;
    var pad = function (n) {
      return String(n).padStart(2, '0');
    };
    return hours > 0
      ? pad(hours) + ':' + pad(minutes) + ':' + pad(secs)
      : pad(minutes) + ':' + pad(secs);
  };

  App.formatPercent = function (value) {
    var number = Number(value);
    if (Number.isNaN(number)) return '—';
    return (Math.round(number * 100) / 100).toFixed(2).replace(/\.00$/, '') + '%';
  };

  App.plural = function (count, singular, plural) {
    return Number(count) === 1 ? singular : plural || singular + 's';
  };

  /* ------------------------------------------------------------------ */
  /* HTTP client                                                        */
  /* ------------------------------------------------------------------ */

  var sessionPromise = null;
  var session = { user: null, csrfToken: null, expiresAt: null };

  App.session = function () {
    return session;
  };

  App.setSession = function (payload) {
    session = {
      user: (payload && payload.user) || null,
      csrfToken: (payload && payload.csrfToken) || null,
      expiresAt: (payload && payload.expiresAt) || null,
    };
    sessionPromise = Promise.resolve(session);
    return session;
  };

  App.boot = function () {
    if (sessionPromise) return sessionPromise;
    sessionPromise = fetch(App.url('api/auth/session'), {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (response) {
        if (!response.ok) throw new Error('Session unavailable');
        return response.json();
      })
      .then(function (payload) {
        return App.setSession(payload && payload.ok ? payload.data : null);
      })
      .catch(function () {
        sessionPromise = null;
        return App.setSession(null);
      });
    return sessionPromise;
  };

  function ApiFailure(message, status, code, fields) {
    var error = new Error(message);
    error.name = 'ApiFailure';
    error.status = status;
    error.code = code;
    error.fields = fields || {};
    return error;
  }

  App.api = function (path, options) {
    var opts = options || {};
    var method = opts.method || (opts.json === undefined ? 'GET' : 'POST');
    var headers = { Accept: 'application/json' };
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (key) {
        headers[key] = opts.headers[key];
      });
    }
    var body = opts.body;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    }

    var prepare = method === 'GET' ? Promise.resolve(session) : App.boot();
    return prepare.then(function (current) {
      if (method !== 'GET' && current && current.csrfToken) {
        headers['X-CSRF-Token'] = current.csrfToken;
      }
      return fetch(App.url(path), {
        method: method,
        headers: headers,
        body: body,
        credentials: 'same-origin',
        cache: 'no-store',
      });
    }).then(function (response) {
      var contentType = response.headers.get('content-type') || '';
      var parsing = contentType.indexOf('application/json') >= 0
        ? response.json().catch(function () { return null; })
        : Promise.resolve(null);
      return parsing.then(function (payload) {
        if (!response.ok || (payload && payload.ok === false)) {
          var detail = payload && payload.error ? payload.error : {};
          if (response.status === 401) {
            sessionPromise = null;
          }
          throw ApiFailure(
            detail.message || 'The request could not be completed (' + response.status + ').',
            response.status,
            detail.code || 'REQUEST_FAILED',
            detail.fields,
          );
        }
        return payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
      });
    });
  };

  /* ------------------------------------------------------------------ */
  /* authentication helpers                                             */
  /* ------------------------------------------------------------------ */

  App.loginPath = function (role) {
    return role === 'admin' ? App.href('auth/admin/') : App.href('auth/login/');
  };

  App.dashboardPath = function (role) {
    return role === 'admin' ? App.href('admin/dashboard/') : App.href('student/dashboard/');
  };

  App.safeNext = function (candidate, fallback) {
    if (typeof candidate !== 'string' || !candidate) return fallback;
    if (candidate.charAt(0) !== '/' || candidate.indexOf('//') === 0) return fallback;
    if (candidate.indexOf(BASE) !== 0) return fallback;
    if (candidate.indexOf(BASE + 'auth/') === 0) return fallback;
    return candidate;
  };

  App.guard = function (role) {
    return App.boot().then(function (current) {
      if (!current.user) {
        var next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(App.loginPath(role) + '?next=' + next);
        return null;
      }
      if (current.user.role !== role) {
        window.location.replace(App.dashboardPath(current.user.role));
        return null;
      }
      return current;
    });
  };

  App.logout = function () {
    return App.api('api/auth/logout', { method: 'POST', json: {} })
      .catch(function () { /* the cookie may already be gone */ })
      .then(function () {
        App.setSession(null);
        window.location.replace(App.href(''));
      });
  };

  /* ------------------------------------------------------------------ */
  /* toasts and dialogs                                                 */
  /* ------------------------------------------------------------------ */

  var TOAST_ICONS = {
    success: 'bi-check-circle-fill',
    danger: 'bi-exclamation-octagon-fill',
    warning: 'bi-exclamation-triangle-fill',
    info: 'bi-info-circle-fill',
  };

  App.toast = function (message, type, timeout) {
    var kind = TOAST_ICONS[type] ? type : 'info';
    var host = App.$('.toast-host');
    if (!host) {
      host = document.createElement('div');
      host.className = 'toast-host';
      host.setAttribute('aria-live', 'polite');
      host.setAttribute('aria-atomic', 'true');
      document.body.appendChild(host);
    }
    var toast = document.createElement('div');
    toast.className = 'rb-toast ' + kind;
    toast.setAttribute('role', 'status');
    toast.innerHTML =
      '<i class="bi ' + TOAST_ICONS[kind] + '"></i>' +
      '<div class="toast-text">' + App.escape(message) + '</div>' +
      '<button type="button" class="toast-close" aria-label="Dismiss notification"><i class="bi bi-x-lg"></i></button>';
    host.appendChild(toast);

    var remove = function () {
      toast.classList.add('leaving');
      window.setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 180);
    };
    App.$('.toast-close', toast).addEventListener('click', remove);
    window.setTimeout(remove, timeout || 5200);
    return toast;
  };

  App.confirm = function (options) {
    var opts = options || {};
    if (!window.bootstrap || !window.bootstrap.Modal) {
      return Promise.resolve(window.confirm(opts.message || 'Continue?'));
    }

    return new Promise(function (resolve) {
      var tone = opts.tone === 'danger' ? 'btn-maroon' : 'btn-brown';
      var host = document.createElement('div');
      host.innerHTML =
        '<div class="modal fade" tabindex="-1" aria-hidden="true">' +
        '  <div class="modal-dialog modal-dialog-centered">' +
        '    <div class="modal-content">' +
        '      <div class="modal-header">' +
        '        <h5 class="modal-title">' + App.escape(opts.title || 'Please confirm') + '</h5>' +
        '        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>' +
        '      </div>' +
        '      <div class="modal-body">' +
        '        <p class="mb-0 text-muted-rb" style="line-height:1.65">' + App.escape(opts.message || '') + '</p>' +
        '      </div>' +
        '      <div class="modal-footer">' +
        '        <button type="button" class="btn btn-soft" data-bs-dismiss="modal">' + App.escape(opts.cancelText || 'Cancel') + '</button>' +
        '        <button type="button" class="btn ' + tone + '" data-confirm-action>' + App.escape(opts.confirmText || 'Confirm') + '</button>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '</div>';
      document.body.appendChild(host);
      var modalEl = host.querySelector('.modal');
      var modal = new window.bootstrap.Modal(modalEl);
      var accepted = false;
      modalEl.querySelector('[data-confirm-action]').addEventListener('click', function () {
        accepted = true;
        modal.hide();
      });
      modalEl.addEventListener('hidden.bs.modal', function () {
        modal.dispose();
        host.remove();
        resolve(accepted);
      });
      modal.show();
    });
  };

  App.showModal = function (options) {
    var opts = options || {};
    var host = document.createElement('div');
    host.innerHTML =
      '<div class="modal fade" tabindex="-1" aria-hidden="true">' +
      '  <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ' + (opts.size || 'modal-lg') + '">' +
      '    <div class="modal-content">' +
      '      <div class="modal-header">' +
      '        <h5 class="modal-title">' + App.escape(opts.title || '') + '</h5>' +
      '        <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>' +
      '      </div>' +
      '      <div class="modal-body">' + (opts.body || '') + '</div>' +
      (opts.footer ? '      <div class="modal-footer">' + opts.footer + '</div>' : '') +
      '    </div>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(host);
    var modalEl = host.querySelector('.modal');
    var modal = new window.bootstrap.Modal(modalEl);
    modalEl.addEventListener('hidden.bs.modal', function () {
      modal.dispose();
      host.remove();
    });
    modal.show();
    return {
      element: modalEl,
      body: modalEl.querySelector('.modal-body'),
      footer: modalEl.querySelector('.modal-footer'),
      close: function () {
        modal.hide();
      },
    };
  };

  /* ------------------------------------------------------------------ */
  /* forms                                                              */
  /* ------------------------------------------------------------------ */

  App.clearFieldErrors = function (form) {
    if (!form) return;
    App.$$('.is-invalid', form).forEach(function (input) {
      input.classList.remove('is-invalid');
    });
    App.$$('.field-error', form).forEach(function (node) {
      node.remove();
    });
    var alert = App.$('.form-alert', form);
    if (alert) {
      alert.remove();
    }
  };

  App.showFieldErrors = function (form, fields, message) {
    if (!form) return;
    App.clearFieldErrors(form);
    var first = null;

    if (fields) {
      Object.keys(fields).forEach(function (name) {
        var input = form.querySelector('[name="' + name + '"]');
        if (!input) return;
        input.classList.add('is-invalid');
        var error = document.createElement('div');
        error.className = 'field-error';
        error.textContent = fields[name];
        var wrapper = input.closest('.input-group') || input;
        wrapper.insertAdjacentElement('afterend', error);
        if (!first) first = input;
      });
    }

    if (message) {
      var alert = document.createElement('div');
      alert.className = 'form-alert warning-panel danger-panel mb-3';
      alert.setAttribute('role', 'alert');
      alert.textContent = message;
      form.insertBefore(alert, form.firstChild);
    }

    if (first) {
      first.focus();
    } else if (message) {
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  App.setBusy = function (button, busy, busyText) {
    if (!button) return;
    if (busy) {
      if (!button.dataset.idleHtml) button.dataset.idleHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML =
        '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>' +
        App.escape(busyText || 'Please wait…');
    } else {
      button.disabled = false;
      if (button.dataset.idleHtml) {
        button.innerHTML = button.dataset.idleHtml;
        delete button.dataset.idleHtml;
      }
    }
  };

  App.bindPasswordToggles = function (scope) {
    App.$$('[data-password-toggle]', scope).forEach(function (button) {
      button.addEventListener('click', function () {
        var target = App.$('#' + button.getAttribute('data-password-toggle'));
        if (!target) return;
        var showing = target.type === 'text';
        target.type = showing ? 'password' : 'text';
        button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
        var icon = button.querySelector('i');
        if (icon) icon.className = showing ? 'bi bi-eye' : 'bi bi-eye-slash';
      });
    });
  };

  /* ------------------------------------------------------------------ */
  /* badges                                                             */
  /* ------------------------------------------------------------------ */

  var BADGES = {
    examState: {
      available: ['Available', 'success', 'bi-unlock'],
      upcoming: ['Upcoming', 'info', 'bi-clock'],
      ongoing: ['In progress', 'gold', 'bi-hourglass-split'],
      completed: ['Completed', 'brown', 'bi-check2-circle'],
      ended: ['Ended', 'muted', 'bi-slash-circle'],
      locked: ['Not open', 'muted', 'bi-lock'],
    },
    examStatus: {
      draft: ['Draft', 'muted', 'bi-file-earmark'],
      published: ['Published', 'info', 'bi-megaphone'],
      active: ['Active', 'success', 'bi-broadcast'],
      closed: ['Closed', 'brown', 'bi-lock'],
    },
    attempt: {
      in_progress: ['In progress', 'gold', 'bi-hourglass-split'],
      submitted: ['Submitted', 'success', 'bi-check2-circle'],
      expired: ['Auto-submitted', 'warning', 'bi-clock-history'],
    },
    result: {
      pass: ['Passed', 'success', 'bi-check2-circle'],
      fail: ['Failed', 'danger', 'bi-x-circle'],
    },
    review: {
      unreviewed: ['Unreviewed', 'warning', 'bi-eye'],
      reviewed: ['Reviewed', 'success', 'bi-check2-circle'],
      dismissed: ['Dismissed', 'muted', 'bi-slash-circle'],
    },
    severity: {
      low: ['Low', 'info', 'bi-info-circle'],
      medium: ['Medium', 'warning', 'bi-exclamation-triangle'],
      high: ['High', 'danger', 'bi-exclamation-octagon'],
    },
    active: {
      true: ['Active', 'success', 'bi-check-circle'],
      false: ['Deactivated', 'muted', 'bi-slash-circle'],
    },
  };

  App.badge = function (kind, value) {
    var map = BADGES[kind] || {};
    var entry = map[String(value)];
    if (!entry) {
      return '<span class="rb-badge badge-muted">' + App.escape(value) + '</span>';
    }
    return (
      '<span class="rb-badge badge-' + entry[1] + '"><i class="bi ' + entry[2] + '"></i>' +
      App.escape(entry[0]) + '</span>'
    );
  };

  App.eventLabel = function (eventType) {
    return String(eventType || '')
      .toLowerCase()
      .split('_')
      .map(function (word) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join(' ');
  };

  App.emptyState = function (icon, title, message, actionHtml) {
    return (
      '<div class="empty-state">' +
      '<div class="empty-icon"><i class="bi ' + icon + '"></i></div>' +
      '<h3>' + App.escape(title) + '</h3>' +
      '<p>' + App.escape(message) + '</p>' +
      (actionHtml || '') +
      '</div>'
    );
  };

  /* ------------------------------------------------------------------ */
  /* charts                                                             */
  /* ------------------------------------------------------------------ */

  App.chartPalette = ['#762D3F', '#B58A45', '#68452F', '#477451', '#526F84', '#B77B28', '#98704F', '#A33C3C'];

  App.chartDefaults = function () {
    if (!window.Chart) return;
    window.Chart.defaults.font.family = "'Poppins', 'Inter', system-ui, sans-serif";
    window.Chart.defaults.font.size = 11;
    window.Chart.defaults.color = '#796B60';
    window.Chart.defaults.borderColor = 'rgba(222, 209, 190, 0.75)';
    window.Chart.defaults.plugins.legend.labels.usePointStyle = true;
    window.Chart.defaults.plugins.legend.labels.boxWidth = 8;
  };

  /* ------------------------------------------------------------------ */
  /* shared navigation markup                                           */
  /* ------------------------------------------------------------------ */

  function brandMarkup(href) {
    return (
      '<a class="navbar-brand rb-brand" href="' + href + '">' +
      '<span class="brand-mark"><i class="bi bi-mortarboard-fill"></i></span>' +
      '<span class="brand-text">' +
      '<span class="brand-title">Online Examination System</span>' +
      '<span class="brand-sub">Secure Digital Examination Portal</span>' +
      '</span></a>'
    );
  }

  App.renderPublicHeader = function (options) {
    var opts = options || {};
    var host = document.getElementById('site-header');
    if (!host) return;
    var active = document.body.dataset.page || '';
    var compact = Boolean(opts.compact);
    var link = function (page, label, href) {
      var isActive = active === page ? ' active' : '';
      return '<li class="nav-item"><a class="nav-link' + isActive + '" href="' + href + '">' + label + '</a></li>';
    };

    var navLinks = compact
      ? '<li class="nav-item"><a class="nav-link" href="' + App.href('') + '"><i class="bi bi-arrow-left me-1"></i>Back to home</a></li>'
      : link('home', 'Home', App.href('')) +
        link('instructions', 'Instructions', App.href('') + '#instructions') +
        link('about', 'About', App.href('') + '#about') +
        link('contact', 'Contact', App.href('') + '#contact') +
        '<li class="nav-divider d-none d-lg-block" aria-hidden="true"></li>';

    var authLinks = compact
      ? ''
      : '<li class="nav-item"><a class="nav-login" href="' + App.href('auth/login/') + '">Student Login</a></li>' +
        '<li class="nav-item"><a class="btn btn-nav-register" href="' + App.href('auth/register/') + '">Student Registration</a></li>';

    host.innerHTML =
      '<header class="site-header">' +
      '<nav class="navbar navbar-expand-lg rb-navbar">' +
      '<div class="rb-container d-flex flex-wrap align-items-center">' +
      brandMarkup(App.href('')) +
      '<button class="navbar-toggler ms-auto" type="button" data-bs-toggle="collapse" data-bs-target="#publicNav" aria-controls="publicNav" aria-expanded="false" aria-label="Toggle navigation">' +
      '<span class="navbar-toggler-icon"></span></button>' +
      '<div class="collapse navbar-collapse" id="publicNav">' +
      '<ul class="navbar-nav ms-auto align-items-lg-center">' + navLinks + authLinks + '</ul>' +
      '</div></div></nav></header>';
  };

  var PUBLIC_FOOTER_LINKS = [
    ['Home', ''],
    ['Instructions', '#instructions'],
    ['How it works', '#how-it-works'],
    ['Features', '#features'],
    ['About', '#about'],
    ['Contact', '#contact'],
  ];

  App.renderPublicFooter = function () {
    var host = document.getElementById('site-footer');
    if (!host) return;
    var links = PUBLIC_FOOTER_LINKS.map(function (entry) {
      var href = entry[1].charAt(0) === '#' ? App.href('') + entry[1] : App.href(entry[1]);
      return '<li><a href="' + href + '">' + App.escape(entry[0]) + '</a></li>';
    }).join('');

    host.innerHTML =
      '<footer class="site-footer">' +
      '<div class="rb-container">' +
      '<div class="row g-4">' +
      '<div class="col-lg-5">' +
      '<div class="footer-brand">' +
      '<span class="brand-mark"><i class="bi bi-mortarboard-fill"></i></span>' +
      '<div class="brand-text"><span class="brand-title">Online Examination System</span>' +
      '<span class="brand-sub">Secure Digital Examination Portal</span></div>' +
      '</div>' +
      '<p class="footer-about">A secure, transparent and efficient digital platform for conducting online examinations with timed attempts, automatic evaluation and browser-based monitoring for administrative review.</p>' +
      '<p class="footer-note">Proctoring indicators are reviewed by examination administrators and are not automatic proof of misconduct.</p>' +
      '</div>' +
      '<div class="col-6 col-lg-2"><h3>Navigate</h3><ul class="footer-links">' + links + '</ul></div>' +
      '<div class="col-6 col-lg-2"><h3>Students</h3><ul class="footer-links">' +
      '<li><a href="' + App.href('auth/login/') + '">Student login</a></li>' +
      '<li><a href="' + App.href('auth/register/') + '">Create account</a></li>' +
      '<li><a href="' + App.href('auth/admin/') + '">Administrator login</a></li>' +
      '</ul></div>' +
      '<div class="col-12 col-lg-3"><h3>Examination integrity</h3><ul class="footer-links">' +
      '<li><a href="' + App.href('') + '#instructions">Examination instructions</a></li>' +
      '<li><a href="' + App.href('') + '#privacy">Monitoring and privacy</a></li>' +
      '<li><a href="' + App.href('') + '#contact">Support</a></li>' +
      '</ul></div>' +
      '</div>' +
      '<div class="footer-bottom">' +
      '<span>&copy; <span data-current-year>2026</span> Online Examination System. All rights reserved.</span>' +
      '<span>Built with Cloudflare Workers &amp; D1 &middot; Royal Bengal visual identity</span>' +
      '</div></div></footer>';

    var year = String(new Date().getFullYear());
    App.$$('[data-current-year]').forEach(function (node) {
      node.textContent = year;
    });
  };

  var STUDENT_LINKS = [
    ['dashboard', 'Dashboard', 'student/dashboard/', 'bi-grid-1x2'],
    ['exams', 'My examinations', 'student/dashboard/#exams', 'bi-journal-text'],
    ['history', 'History', 'student/dashboard/#history', 'bi-clock-history'],
    ['results', 'Results', 'student/results/', 'bi-clipboard-data'],
    ['profile', 'Profile', 'student/profile/', 'bi-person-gear'],
  ];

  App.renderStudentNav = function (active) {
    var host = document.getElementById('student-nav');
    if (!host) return;
    var current = App.session().user || {};
    var links = STUDENT_LINKS.map(function (entry) {
      return (
        '<li class="nav-item"><a class="student-nav-link' + (active === entry[0] ? ' active' : '') +
        '" href="' + App.href(entry[2]) + '"><i class="bi ' + entry[3] + '"></i>' + App.escape(entry[1]) + '</a></li>'
      );
    }).join('');

    host.innerHTML =
      '<nav class="navbar navbar-expand-lg student-navbar">' +
      '<div class="rb-container d-flex flex-wrap align-items-center">' +
      brandMarkup(App.href('student/dashboard/')) +
      '<button class="navbar-toggler ms-auto" type="button" data-bs-toggle="collapse" data-bs-target="#studentNav" aria-controls="studentNav" aria-expanded="false" aria-label="Toggle navigation">' +
      '<span class="navbar-toggler-icon"></span></button>' +
      '<div class="collapse navbar-collapse" id="studentNav">' +
      '<ul class="navbar-nav student-nav ms-auto align-items-lg-center">' + links +
      '<li class="nav-item dropdown ms-lg-2">' +
      '<button class="student-user-btn dropdown-toggle" type="button" data-bs-toggle="dropdown" aria-expanded="false">' +
      App.avatar(current.fullName, 'avatar-sm') +
      '<span class="text-start"><strong>' + App.escape(current.fullName || 'Student') + '</strong>' +
      '<small>' + App.escape(current.studentId || 'Student account') + '</small></span></button>' +
      '<ul class="dropdown-menu dropdown-menu-end">' +
      '<li><a class="dropdown-item" href="' + App.href('student/profile/') + '"><i class="bi bi-person me-2"></i>My profile</a></li>' +
      '<li><hr class="dropdown-divider"></li>' +
      '<li><button class="dropdown-item" type="button" data-logout><i class="bi bi-box-arrow-right me-2"></i>Log out</button></li>' +
      '</ul></li>' +
      '</ul></div></div></nav>';

    var logout = App.$('[data-logout]', host);
    if (logout) {
      logout.addEventListener('click', function () {
        App.setBusy(logout, true, 'Logging out…');
        App.logout();
      });
    }
  };

  App.renderStudentFooter = function () {
    var host = document.getElementById('student-footer');
    if (!host) return;
    host.innerHTML =
      '<footer class="student-footer"><div class="rb-container d-flex flex-wrap justify-content-between gap-2">' +
      '<span>&copy; <span data-current-year></span> Online Examination System</span>' +
      '<span><a href="' + App.href('') + '#instructions" class="text-muted-rb text-decoration-none">Examination instructions</a></span>' +
      '</div></footer>';
    var year = String(new Date().getFullYear());
    App.$$('[data-current-year]', host).forEach(function (node) {
      node.textContent = year;
    });
  };

  var ADMIN_LINKS = [
    ['dashboard', 'Dashboard', 'admin/dashboard/', 'bi-grid-1x2'],
    ['students', 'Student Management', 'admin/students/', 'bi-people'],
    ['exams', 'Examination Management', 'admin/exams/', 'bi-journal-bookmark'],
    ['questions', 'Question Bank', 'admin/questions/', 'bi-patch-question'],
    ['results', 'Results', 'admin/results/', 'bi-clipboard-data'],
    ['proctoring', 'Proctoring Reports', 'admin/proctoring/', 'bi-camera-video'],
    ['profile', 'Profile', 'admin/profile/', 'bi-person-gear'],
  ];

  App.renderAdminSidebar = function (active) {
    var host = document.getElementById('admin-sidebar');
    if (!host) return;
    var current = App.session().user || {};
    var links = ADMIN_LINKS.map(function (entry) {
      return (
        '<a class="sidebar-link' + (active === entry[0] ? ' active' : '') + '" href="' + App.href(entry[2]) + '">' +
        '<i class="bi ' + entry[3] + '"></i><span>' + App.escape(entry[1]) + '</span></a>'
      );
    }).join('');

    host.innerHTML =
      '<div class="sidebar-top">' +
      '<a class="rb-brand" href="' + App.href('admin/dashboard/') + '">' +
      '<span class="brand-mark"><i class="bi bi-mortarboard-fill"></i></span>' +
      '<span class="brand-text"><span class="brand-title">Examination System</span>' +
      '<span class="brand-sub">Administration</span></span></a></div>' +
      '<div class="sidebar-label">Control centre</div>' +
      '<nav class="sidebar-nav" aria-label="Administration">' + links +
      '<a class="sidebar-link" href="' + App.href('') + '" target="_blank" rel="noopener">' +
      '<i class="bi bi-box-arrow-up-right"></i><span>View public site</span></a>' +
      '</nav>' +
      '<div class="sidebar-foot">' +
      '<div class="sidebar-user">' + App.avatar(current.fullName, 'avatar-sm') +
      '<div><strong>' + App.escape(current.fullName || 'Administrator') + '</strong>' +
      '<span>Examination administrator</span></div></div>' +
      '<button class="sidebar-logout" type="button" data-logout>' +
      '<i class="bi bi-box-arrow-right"></i> Log out</button>' +
      '</div>';

    var logout = App.$('[data-logout]', host);
    if (logout) {
      logout.addEventListener('click', function () {
        App.setBusy(logout, true, 'Logging out…');
        App.logout();
      });
    }
  };

  App.renderAdminTopbar = function (title, eyebrow) {
    var host = document.getElementById('admin-topbar');
    if (!host) return;
    var current = App.session().user || {};
    host.innerHTML =
      '<button class="sidebar-toggle" type="button" aria-label="Open navigation" data-sidebar-toggle>' +
      '<i class="bi bi-list"></i></button>' +
      '<div class="page-context"><span class="eyebrow">' + App.escape(eyebrow || 'Administration') + '</span>' +
      '<h1>' + App.escape(title || 'Dashboard') + '</h1></div>' +
      '<div class="topbar-date d-flex align-items-center gap-2"><i class="bi bi-calendar3"></i>' +
      App.escape(App.formatDate(new Date().toISOString())) + '</div>' +
      '<div class="topbar-user">' + App.avatar(current.fullName) +
      '<div><strong>' + App.escape(current.fullName || 'Administrator') + '</strong>' +
      '<span>Administrator</span></div></div>';

    var toggle = App.$('[data-sidebar-toggle]', host);
    if (toggle) {
      toggle.addEventListener('click', function () {
        document.body.classList.toggle('sidebar-open');
      });
    }
    var backdrop = App.$('.sidebar-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', function () {
        document.body.classList.remove('sidebar-open');
      });
    }
  };

  App.initAdmin = function (active, title, eyebrow) {
    return App.guard('admin').then(function (current) {
      if (!current) return null;
      App.renderAdminSidebar(active);
      App.renderAdminTopbar(title, eyebrow);
      return current.user;
    });
  };

  App.initStudent = function (active) {
    return App.guard('student').then(function (current) {
      if (!current) return null;
      App.renderStudentNav(active);
      App.renderStudentFooter();
      return current.user;
    });
  };

  /* ------------------------------------------------------------------ */
  /* misc                                                               */
  /* ------------------------------------------------------------------ */

  App.handleError = function (error, form) {
    var fields = error && error.fields;
    if (form && fields && Object.keys(fields).length) {
      App.showFieldErrors(form, fields, error.message);
    } else {
      App.toast(error && error.message ? error.message : 'Something went wrong. Please try again.', 'danger');
    }
  };

  App.currentYear = function () {
    var year = String(new Date().getFullYear());
    App.$$('[data-current-year]').forEach(function (node) {
      node.textContent = year;
    });
  };

  App.chartDefaults();
  window.RB = App;
})(window, document);
