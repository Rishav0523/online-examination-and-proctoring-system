(function () {
  'use strict';

  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var STUDENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/;

  document.addEventListener('DOMContentLoaded', function () {
    RB.renderPublicHeader({ compact: true });
    RB.bindPasswordToggles();
    RB.currentYear();

    var page = document.body.dataset.page;

    RB.boot().then(function (current) {
      if (!current.user) return;
      window.location.replace(RB.dashboardPath(current.user.role));
    });

    if (page === 'login') {
      setupLogin();
    } else if (page === 'admin-login') {
      setupAdminLogin();
    } else if (page === 'register') {
      setupRegister();
    }
  });

  function setupLogin() {
    var form = RB.$('#loginForm');
    var button = RB.$('#loginButton');
    if (!form) return;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      RB.clearFieldErrors(form);

      var identifier = form.identifier.value.trim();
      var password = form.password.value;
      var fields = {};
      if (identifier.length < 3) fields.identifier = 'Enter your email address or student ID.';
      if (!password) fields.password = 'Enter your password.';
      if (Object.keys(fields).length) {
        RB.showFieldErrors(form, fields);
        return;
      }

      RB.setBusy(button, true, 'Signing in…');
      RB.api('api/auth/login', {
        method: 'POST',
        json: {
          identifier: identifier,
          password: password,
          remember: form.remember.checked,
        },
      })
        .then(function (data) {
          RB.setSession(data);
          var fallback = RB.dashboardPath('student');
          window.location.replace(RB.safeNext(RB.qs('next'), fallback));
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error, form);
        });
    });
  }

  function setupAdminLogin() {
    var form = RB.$('#adminLoginForm');
    var button = RB.$('#adminLoginButton');
    if (!form) return;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      RB.clearFieldErrors(form);

      var identifier = form.identifier.value.trim();
      var password = form.password.value;
      var fields = {};
      if (!identifier) fields.identifier = 'Enter your administrator email.';
      if (!password) fields.password = 'Enter your password.';
      if (Object.keys(fields).length) {
        RB.showFieldErrors(form, fields);
        return;
      }

      RB.setBusy(button, true, 'Verifying…');
      RB.api('api/auth/admin/login', {
        method: 'POST',
        json: { identifier: identifier, password: password, remember: false },
      })
        .then(function (data) {
          RB.setSession(data);
          window.location.replace(RB.href('admin/dashboard/'));
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error, form);
        });
    });
  }

  function setupRegister() {
    var form = RB.$('#registerForm');
    var button = RB.$('#registerButton');
    if (!form) return;

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      RB.clearFieldErrors(form);

      var values = {
        fullName: form.fullName.value.trim(),
        studentId: form.studentId.value.trim(),
        email: form.email.value.trim(),
        department: form.department.value.trim(),
        semester: form.semester.value,
        password: form.password.value,
      };
      var confirmPassword = form.confirmPassword.value;
      var fields = {};

      if (values.fullName.length < 2) fields.fullName = 'Enter your full name.';
      if (!STUDENT_ID.test(values.studentId)) {
        fields.studentId = 'Student ID must be 3–32 characters using letters, numbers, dot, dash or underscore.';
      }
      if (!EMAIL.test(values.email)) fields.email = 'Enter a valid email address.';
      if (values.department.length < 2) fields.department = 'Enter your department.';
      if (!values.semester) fields.semester = 'Select your semester.';
      if (values.password.length < 8) {
        fields.password = 'Password must be at least 8 characters.';
      } else if (!/[A-Za-z]/.test(values.password) || !/[0-9]/.test(values.password)) {
        fields.password = 'Password must contain at least one letter and one number.';
      }
      if (values.password !== confirmPassword) fields.confirmPassword = 'Passwords do not match.';
      if (!form.acknowledge.checked) {
        fields.acknowledge = 'Confirm that you have read the examination instructions.';
      }

      if (Object.keys(fields).length) {
        RB.showFieldErrors(form, fields);
        return;
      }

      RB.setBusy(button, true, 'Creating account…');
      RB.api('api/auth/register', {
        method: 'POST',
        json: Object.assign({}, values, { confirmPassword: confirmPassword }),
      })
        .then(function (data) {
          RB.setSession(data);
          window.location.replace(RB.href('student/dashboard/'));
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error, form);
        });
    });
  }
})();
