(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    RB.initStudent('results').then(function (current) {
      if (!current) return;
      loadResults();
    });
  });

  function loadResults() {
    var root = RB.$('#resultsRoot');
    RB.api('api/student/results')
      .then(function (data) {
        render(root, data.results || [], Number(data.pendingResults) || 0);
      })
      .catch(function (error) {
        root.innerHTML =
          '<div class="rb-card"><div class="rb-card-body">' +
          '<div class="warning-panel danger-panel mb-3">' + RB.escape(error.message) + '</div>' +
          '<button class="btn btn-maroon" type="button" id="retryResults">Try again</button>' +
          '</div></div>';
        var retry = RB.$('#retryResults');
        if (retry) retry.addEventListener('click', loadResults);
      });
  }

  function stat(icon, label, value, hint, accent) {
    return (
      '<div class="stat-card ' + (accent || '') + '">' +
      '<span class="stat-icon"><i class="bi ' + icon + '"></i></span>' +
      '<div><span class="stat-label">' + RB.escape(label) + '</span>' +
      '<div class="stat-value">' + value + '</div>' +
      '<div class="stat-hint">' + RB.escape(hint) + '</div></div></div>'
    );
  }

  function resultRow(result) {
    return (
      '<tr>' +
      '<td><div class="cell-title">' + RB.escape(result.examTitle) + '</div>' +
      '<div class="cell-sub">' + RB.escape(result.subject) + '</div></td>' +
      '<td><strong class="text-maroon">' + Number(result.obtainedMarks) + ' / ' + Number(result.totalMarks) + '</strong>' +
      '<div class="cell-sub">marks obtained</div></td>' +
      '<td>' + RB.formatPercent(result.percentage) + '</td>' +
      '<td>' + RB.badge('result', result.status) + '</td>' +
      '<td>' + RB.formatDateTime(result.evaluatedAt) + '</td>' +
      '<td class="text-end"><a class="btn btn-soft btn-sm-rb" href="student/exam/?id=' +
      encodeURIComponent(result.examId) + '">View examination</a></td>' +
      '</tr>'
    );
  }

  function render(root, results, pendingResults) {
    var passed = results.filter(function (item) {
      return item.status === 'pass';
    }).length;
    var failed = results.filter(function (item) {
      return item.status === 'fail';
    }).length;
    var average = results.length
      ? results.reduce(function (sum, item) {
          return sum + Number(item.percentage || 0);
        }, 0) / results.length
      : 0;

    var stats =
      '<div class="stats-grid">' +
      stat('bi-clipboard-check', 'Published results', results.length, 'Released by your administrator', 'accent-maroon') +
      stat('bi-patch-check', 'Passed', passed, 'Examinations cleared', 'accent-success') +
      stat('bi-emoji-neutral', 'Not passed', failed, 'Review and prepare again', 'accent-danger') +
      stat('bi-graph-up-arrow', 'Average score', RB.formatPercent(average), 'Across published results', 'accent-info') +
      '</div>';

    var pendingNotice = pendingResults
      ? '<div class="warning-panel mb-4"><i class="bi bi-hourglass-split me-2"></i>' +
        '<strong>' + pendingResults + ' ' + RB.plural(pendingResults, 'result') + ' awaiting release.</strong> ' +
        'Your examination has been submitted and evaluated, but the administrator has not published the result yet. ' +
        'Results appear here as soon as they are released.</div>'
      : '';

    var table = results.length
      ? '<div class="rb-table-wrap"><div class="table-responsive"><table class="table table-rb align-middle">' +
        '<thead><tr><th>Examination</th><th>Marks</th><th>Percentage</th><th>Outcome</th><th>Evaluated</th><th class="text-end">Action</th></tr></thead>' +
        '<tbody>' + results.map(resultRow).join('') + '</tbody></table></div></div>'
      : RB.emptyState(
          'bi-clipboard-x',
          'No published results yet',
          'Once you complete an examination and your administrator releases the result, it will appear here.',
          '<a class="btn btn-outline-brown btn-sm-rb" href="student/dashboard/">Return to dashboard</a>',
        );

    root.innerHTML =
      '<div class="section-block">' +
      '<div class="section-block-head"><h2>Result summary</h2>' +
      '<span class="form-text">Only released results are counted</span></div>' +
      stats + '</div>' +
      '<section class="section-block">' +
      '<div class="section-block-head"><h2>Result records</h2>' +
      '<span class="form-text">' + results.length + ' ' + RB.plural(results.length, 'record') + '</span></div>' +
      pendingNotice +
      '<div class="rb-card"><div class="rb-card-body p-0">' + table + '</div></div>' +
      '<p class="form-text mt-3 mb-0">Marks are evaluated on the server from the answers stored during your attempt. ' +
      'If you believe a result is incorrect, contact your examination administrator with your attempt details.</p>' +
      '</section>';
  }
})();
