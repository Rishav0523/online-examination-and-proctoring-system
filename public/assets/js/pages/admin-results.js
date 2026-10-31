(function () {
  'use strict';

  var filters = { search: '', examId: '' };
  var examsLoaded = false;

  document.addEventListener('DOMContentLoaded', function () {
    RB.initAdmin('results', 'Results', 'Evaluation').then(function (current) {
      if (!current) return;
      bindFilters();
      loadExams();
      load();
    });
  });

  function bindFilters() {
    var search = RB.$('#resultSearch');
    search.addEventListener('input', RB.debounce(function () {
      filters.search = search.value.trim();
      load();
    }, 350));
    RB.$('#resultExam').addEventListener('change', function () {
      filters.examId = this.value;
      load();
    });
    RB.$('#resetResultFilters').addEventListener('click', function () {
      search.value = '';
      RB.$('#resultExam').value = '';
      filters = { search: '', examId: '' };
      load();
    });
  }

  function loadExams() {
    if (examsLoaded) return;
    examsLoaded = true;
    RB.api('api/admin/exams')
      .then(function (data) {
        var select = RB.$('#resultExam');
        (data.items || []).forEach(function (exam) {
          var option = document.createElement('option');
          option.value = String(exam.id);
          option.textContent = exam.title;
          select.appendChild(option);
        });
      })
      .catch(function () {
        examsLoaded = false;
      });
  }

  function load() {
    var host = RB.$('#resultsTable');
    var params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.examId) params.set('examId', filters.examId);
    var query = params.toString();

    host.innerHTML = '<div class="rb-table-wrap"><div class="table-empty">' +
      '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading results…</div></div>';

    RB.api('api/admin/results' + (query ? '?' + query : ''))
      .then(function (data) {
        render(data.items || []);
      })
      .catch(function (error) {
        host.innerHTML = '<div class="rb-table-wrap"><div class="table-empty text-danger">' +
          RB.escape(error.message) + '</div></div>';
      });
  }

  function render(results) {
    var host = RB.$('#resultsTable');
    var passed = results.filter(function (item) { return item.status === 'pass'; }).length;
    var failed = results.length - passed;
    var average = results.length
      ? results.reduce(function (sum, item) { return sum + Number(item.percentage || 0); }, 0) / results.length
      : 0;

    RB.$('#resultSummary').innerHTML =
      stat('bi-clipboard-data', 'Evaluated results', results.length, 'Stored in the database', 'accent-maroon') +
      stat('bi-patch-check', 'Passed', passed, 'Meeting or exceeding passing marks', 'accent-success') +
      stat('bi-x-circle', 'Not passed', failed, 'Below the passing threshold', 'accent-danger') +
      stat('bi-graph-up-arrow', 'Average score', RB.formatPercent(average), 'Across the current filter', 'accent-info');

    RB.$('#resultCount').textContent = results.length + ' ' + RB.plural(results.length, 'result');

    if (!results.length) {
      host.innerHTML = RB.emptyState(
        'bi-clipboard-x',
        'No evaluated results',
        'Results are created automatically when a student submits an examination and the server evaluates their answers.',
      );
      return;
    }

    host.innerHTML =
      '<div class="rb-table-wrap"><div class="table-responsive"><table class="table table-rb align-middle">' +
      '<thead><tr><th>Student</th><th>Examination</th><th>Marks</th><th>Percentage</th><th>Outcome</th><th>Submitted</th><th>Visibility</th><th class="text-end">Action</th></tr></thead>' +
      '<tbody>' + results.map(function (result) {
        return (
          '<tr>' +
          '<td><div class="cell-title">' + RB.escape(result.studentName) + '</div>' +
          '<div class="cell-sub">' + RB.escape(result.studentId || 'No student ID') + '</div></td>' +
          '<td><div class="cell-title">' + RB.escape(result.examTitle) + '</div>' +
          '<div class="cell-sub">' + RB.escape(result.subject) + '</div></td>' +
          '<td><strong>' + result.obtainedMarks + ' / ' + result.totalMarks + '</strong></td>' +
          '<td>' + RB.formatPercent(result.percentage) + '</td>' +
          '<td>' + RB.badge('result', result.status) + '</td>' +
          '<td class="cell-sub">' + (result.submittedAt ? RB.formatDateTime(result.submittedAt) : '—') + '</td>' +
          '<td>' + (result.resultsPublished
            ? '<span class="rb-badge badge-success"><i class="bi bi-eye"></i>Released</span>'
            : '<span class="rb-badge badge-warning"><i class="bi bi-eye-slash"></i>Held</span>') + '</td>' +
          '<td class="text-end"><button class="btn btn-soft btn-sm-rb" type="button" data-publish="' + result.examId +
          '" data-published="' + (result.resultsPublished ? '1' : '0') + '">' +
          (result.resultsPublished ? 'Withdraw' : 'Release') + '</button></td>' +
          '</tr>'
        );
      }).join('') + '</tbody></table></div></div>';

    RB.$$('[data-publish]', host).forEach(function (button) {
      button.addEventListener('click', function () {
        togglePublish(
          Number(button.getAttribute('data-publish')),
          button.getAttribute('data-published') === '1',
          button,
        );
      });
    });
  }

  function stat(icon, label, value, hint, accent) {
    return (
      '<div class="stat-card ' + (accent || '') + '">' +
      '<span class="stat-icon"><i class="bi ' + icon + '"></i></span>' +
      '<div><span class="stat-label">' + RB.escape(label) + '</span>' +
      '<div class="stat-value">' + RB.escape(String(value)) + '</div>' +
      '<div class="stat-hint">' + RB.escape(hint) + '</div></div></div>'
    );
  }

  function togglePublish(examId, isPublished, button) {
    RB.confirm({
      title: isPublished ? 'Withdraw results' : 'Release results',
      message: isPublished
        ? 'Students will no longer see results for this examination until they are released again.'
        : 'Students will immediately be able to see their marks for this examination.',
      confirmText: isPublished ? 'Withdraw results' : 'Release results',
      tone: isPublished ? 'danger' : 'default',
    }).then(function (confirmed) {
      if (!confirmed) return;
      RB.setBusy(button, true, 'Saving…');
      RB.api('api/admin/exams/' + examId + '/results-publish', {
        method: 'PATCH',
        json: { published: !isPublished },
      })
        .then(function () {
          RB.toast(isPublished ? 'Results withdrawn.' : 'Results released to students.', 'success');
          load();
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error);
        });
    });
  }
})();
