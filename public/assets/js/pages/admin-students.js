(function () {
  'use strict';

  var state = { search: '', status: 'all', department: '' };
  var departmentsLoaded = false;

  document.addEventListener('DOMContentLoaded', function () {
    RB.initAdmin('students', 'Student management', 'People').then(function (current) {
      if (!current) return;
      bindFilters();
      load();
    });
  });

  function bindFilters() {
    var form = RB.$('#studentFilters');
    var search = RB.$('#studentSearch');
    var debounced = RB.debounce(function () {
      state.search = search.value.trim();
      load();
    }, 350);

    search.addEventListener('input', debounced);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      state.search = search.value.trim();
      state.status = RB.$('#studentStatus').value;
      state.department = RB.$('#studentDepartment').value;
      load();
    });
    RB.$('#studentStatus').addEventListener('change', function () {
      state.status = this.value;
      load();
    });
    RB.$('#studentDepartment').addEventListener('change', function () {
      state.department = this.value;
      load();
    });
    RB.$('#resetFilters').addEventListener('click', function () {
      form.reset();
      state = { search: '', status: 'all', department: '' };
      load();
    });
  }

  function query() {
    var params = new URLSearchParams();
    if (state.search) params.set('search', state.search);
    if (state.status && state.status !== 'all') params.set('status', state.status);
    if (state.department) params.set('department', state.department);
    var value = params.toString();
    return value ? '?' + value : '';
  }

  function load() {
    var host = RB.$('#studentsTable');
    host.innerHTML = '<div class="rb-table-wrap"><div class="table-empty">' +
      '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading students…</div></div>';

    RB.api('api/admin/students' + query())
      .then(function (data) {
        renderTable(data.items || []);
        fillDepartments(data.departments || []);
        RB.$('#studentCount').textContent = (data.items || []).length + ' ' + RB.plural((data.items || []).length, 'student');
      })
      .catch(function (error) {
        host.innerHTML = '<div class="rb-table-wrap"><div class="table-empty text-danger">' +
          RB.escape(error.message) + '</div></div>';
      });
  }

  function fillDepartments(departments) {
    if (departmentsLoaded) return;
    departmentsLoaded = true;
    var select = RB.$('#studentDepartment');
    departments.forEach(function (name) {
      var option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
  }

  function renderTable(students) {
    var host = RB.$('#studentsTable');
    if (!students.length) {
      host.innerHTML = RB.emptyState(
        'bi-people',
        'No students match these filters',
        'Adjust the search term or filters, or ask students to register for an account.',
      );
      return;
    }

    host.innerHTML =
      '<div class="rb-table-wrap"><div class="table-responsive"><table class="table table-rb align-middle">' +
      '<thead><tr><th>Student</th><th>Department</th><th>Email</th><th>Attempts</th><th>Passed</th><th>Status</th><th class="text-end">Actions</th></tr></thead>' +
      '<tbody>' + students.map(function (student) {
        return (
          '<tr>' +
          '<td><div class="cell-title">' + RB.escape(student.fullName) + '</div>' +
          '<div class="cell-sub">' + RB.escape(student.studentId || 'No student ID') + '</div></td>' +
          '<td><div>' + RB.escape(student.department || '—') + '</div>' +
          '<div class="cell-sub">Semester ' + RB.escape(student.semester) + '</div></td>' +
          '<td class="cell-sub">' + RB.escape(student.email) + '</td>' +
          '<td>' + Number(student.attemptCount || 0) + '</td>' +
          '<td>' + Number(student.passedCount || 0) + '</td>' +
          '<td>' + RB.badge('active', student.isActive) + '</td>' +
          '<td class="text-end"><div class="table-actions justify-content-end">' +
          '<button class="btn btn-soft btn-sm-rb" type="button" data-view="' + student.id + '">' +
          '<i class="bi bi-eye me-1"></i>Details</button>' +
          '<button class="btn ' + (student.isActive ? 'btn-outline-brown' : 'btn-maroon') + ' btn-sm-rb" type="button" data-toggle="' + student.id + '" data-active="' + (student.isActive ? '1' : '0') + '">' +
          (student.isActive ? '<i class="bi bi-slash-circle me-1"></i>Deactivate' : '<i class="bi bi-check2-circle me-1"></i>Reactivate') +
          '</button></div></td>' +
          '</tr>'
        );
      }).join('') + '</tbody></table></div></div>';

    RB.$$('[data-view]', host).forEach(function (button) {
      button.addEventListener('click', function () {
        showStudent(Number(button.getAttribute('data-view')));
      });
    });
    RB.$$('[data-toggle]', host).forEach(function (button) {
      button.addEventListener('click', function () {
        toggleStudent(
          Number(button.getAttribute('data-toggle')),
          button.getAttribute('data-active') === '1',
          button,
        );
      });
    });
  }

  function showStudent(studentId) {
    var host = modalHost();
    host.innerHTML = modalMarkup('Student details',
      '<div class="table-empty"><span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading student record…</div>');
    openBootstrapModal(host);

    RB.api('api/admin/students/' + studentId)
      .then(function (data) {
        var student = data.student;
        var summary = data.summary || {};
        var attempts = data.attempts || [];
        var attemptTable = attempts.length
          ? '<div class="table-responsive"><table class="table table-rb align-middle mb-0">' +
            '<thead><tr><th>Examination</th><th>Started</th><th>Status</th><th>Score</th><th>Proctoring</th></tr></thead>' +
            '<tbody>' + attempts.map(function (attempt) {
              return (
                '<tr>' +
                '<td><div class="cell-title">' + RB.escape(attempt.examTitle) + '</div>' +
                '<div class="cell-sub">' + RB.escape(attempt.subject) + '</div></td>' +
                '<td class="cell-sub">' + RB.formatDateTime(attempt.startedAt) + '</td>' +
                '<td>' + RB.badge('attempt', attempt.status) + '</td>' +
                '<td>' + (attempt.percentage === null || attempt.percentage === undefined
                  ? '<span class="text-muted-rb">—</span>'
                  : '<strong>' + RB.formatPercent(attempt.percentage) + '</strong><div class="cell-sub">' +
                    attempt.obtainedMarks + ' / ' + attempt.totalMarks + '</div>') + '</td>' +
                '<td><span class="cell-sub">' + attempt.proctoringEvents + ' events · ' +
                attempt.unreviewedEvents + ' unreviewed</span></td>' +
                '</tr>'
              );
            }).join('') + '</tbody></table></div>'
          : RB.emptyState('bi-clock-history', 'No attempts yet', 'This student has not started an examination.');

        host.querySelector('.modal-body').innerHTML =
          '<div class="profile-identity">' + RB.avatar(student.fullName, 'avatar-lg') +
          '<div><h2>' + RB.escape(student.fullName) + '</h2>' +
          '<p>' + RB.escape(student.studentId || 'No student ID') + ' · Semester ' + RB.escape(student.semester) + '</p></div>' +
          RB.badge('active', student.isActive) + '</div>' +
          '<div class="kv-list mb-3">' +
          kv('Email address', student.email) +
          kv('Department', student.department || '—') +
          kv('Registered', RB.formatDateTime(student.createdAt)) +
          kv('Attempts', String(summary.attempts || 0)) +
          kv('Completed', String(summary.completed || 0)) +
          kv('Passed', String(summary.passed || 0)) +
          kv('Average score', RB.formatPercent(summary.averagePercentage || 0)) +
          '</div>' +
          '<div class="section-block-head mt-3"><h2>Attempt history</h2>' +
          '<a href="admin/proctoring/?search=' + encodeURIComponent(student.fullName) + '">Proctoring reports</a></div>' +
          attemptTable;
      })
      .catch(function (error) {
        host.querySelector('.modal-body').innerHTML =
          '<div class="warning-panel danger-panel">' + RB.escape(error.message) + '</div>';
      });
  }

  function toggleStudent(studentId, isActive, button) {
    RB.confirm({
      title: isActive ? 'Deactivate student account' : 'Reactivate student account',
      message: isActive
        ? 'The student will be signed out immediately and will not be able to sign in until the account is reactivated.'
        : 'The student will be able to sign in and start examinations again.',
      confirmText: isActive ? 'Deactivate account' : 'Reactivate account',
      tone: isActive ? 'danger' : 'default',
    }).then(function (confirmed) {
      if (!confirmed) return;
      RB.setBusy(button, true, 'Saving…');
      RB.api('api/admin/students/' + studentId, {
        method: 'PATCH',
        json: { isActive: !isActive },
      })
        .then(function () {
          RB.toast(isActive ? 'Student account deactivated.' : 'Student account reactivated.', 'success');
          load();
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.toast(error.message, 'danger');
        });
    });
  }

  function kv(label, value) {
    return '<div class="kv-row"><span>' + RB.escape(label) + '</span><strong>' + RB.escape(value) + '</strong></div>';
  }

  function modalHost() {
    var host = document.getElementById('adminModalHost');
    if (!host) {
      host = document.createElement('div');
      host.id = 'adminModalHost';
      document.body.appendChild(host);
    }
    return host;
  }

  function modalMarkup(title, body) {
    return (
      '<div class="modal fade" tabindex="-1" aria-hidden="true"><div class="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">' +
      '<div class="modal-content"><div class="modal-header">' +
      '<h5 class="modal-title">' + RB.escape(title) + '</h5>' +
      '<button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>' +
      '<div class="modal-body">' + body + '</div></div></div></div>'
    );
  }

  function openBootstrapModal(host) {
    var modal = new window.bootstrap.Modal(host.querySelector('.modal'));
    host.querySelector('.modal').addEventListener('hidden.bs.modal', function () {
      host.innerHTML = '';
    });
    modal.show();
  }
})();
