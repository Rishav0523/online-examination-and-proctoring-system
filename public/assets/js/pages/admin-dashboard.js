(function () {
  'use strict';

  var charts = [];

  document.addEventListener('DOMContentLoaded', function () {
    RB.initAdmin('dashboard', 'Dashboard', 'Administration').then(function (current) {
      if (!current) return;
      load();
    });
  });

  function load() {
    var root = RB.$('#adminRoot');
    RB.api('api/admin/dashboard')
      .then(function (data) {
        render(root, data);
      })
      .catch(function (error) {
        root.innerHTML =
          '<div class="rb-card"><div class="rb-card-body">' +
          '<div class="warning-panel danger-panel mb-3">' + RB.escape(error.message) + '</div>' +
          '<button class="btn btn-maroon" type="button" id="retryDashboard">Try again</button>' +
          '</div></div>';
        var retry = RB.$('#retryDashboard');
        if (retry) retry.addEventListener('click', load);
      });
  }

  function stat(icon, label, value, hint, accent) {
    return (
      '<div class="stat-card ' + (accent || '') + '">' +
      '<span class="stat-icon"><i class="bi ' + icon + '"></i></span>' +
      '<div><span class="stat-label">' + RB.escape(label) + '</span>' +
      '<div class="stat-value">' + Number(value || 0) + '</div>' +
      '<div class="stat-hint">' + RB.escape(hint) + '</div></div></div>'
    );
  }

  function render(root, data) {
    var stats = data.stats;
    var chartsData = data.charts || {};
    var recentEvents = data.recentEvents || [];
    var admin = data.admin || {};

    var eventsTable = recentEvents.length
      ? '<div class="table-responsive"><table class="table table-rb align-middle">' +
        '<thead><tr><th>Student</th><th>Examination</th><th>Event</th><th>Severity</th><th>Review</th><th>When</th></tr></thead>' +
        '<tbody>' + recentEvents.map(function (event) {
          return (
            '<tr>' +
            '<td><div class="cell-title">' + RB.escape(event.studentName) + '</div></td>' +
            '<td>' + RB.escape(event.examTitle) + '</td>' +
            '<td>' + RB.escape(RB.eventLabel(event.eventType)) + '</td>' +
            '<td>' + RB.badge('severity', event.severity) + '</td>' +
            '<td>' + RB.badge('review', event.reviewStatus) + '</td>' +
            '<td class="cell-sub">' + RB.formatDateTime(event.timestamp) + '</td>' +
            '</tr>'
          );
        }).join('') + '</tbody></table></div>'
      : RB.emptyState('bi-camera-video', 'No proctoring events recorded', 'Monitored attempts will report camera, focus and fullscreen events here.');

    root.innerHTML =
      '<div class="page-head">' +
      '<div><span class="page-eyebrow">Control centre</span>' +
      '<h1>Welcome, ' + RB.escape(admin.fullName || 'Administrator') + '</h1>' +
      '<p>Live statistics from students, examinations, evaluations and proctoring reports.</p></div>' +
      '<div class="page-actions">' +
      '<a class="btn btn-maroon" href="admin/exams/"><i class="bi bi-plus-lg me-1"></i>Manage examinations</a>' +
      '<a class="btn btn-soft" href="admin/results/"><i class="bi bi-clipboard-data me-1"></i>Results</a>' +
      '</div></div>' +

      '<div class="stats-grid six">' +
      stat('bi-people', 'Registered students', stats.totalStudents, 'Student accounts in the system', 'accent-maroon') +
      stat('bi-journal-bookmark', 'Examinations', stats.totalExams, stats.activeExams + ' currently active', 'accent-info') +
      stat('bi-pencil-square', 'Attempts recorded', stats.totalAttempts, 'Started by students', 'accent-warning') +
      stat('bi-camera-video', 'Proctoring events', stats.proctoringEvents, stats.unreviewedEvents + ' awaiting review', 'accent-danger') +
      stat('bi-patch-check', 'Passed results', stats.passCount, 'Evaluated and passing', 'accent-success') +
      stat('bi-clipboard-x', 'Failed results', stats.failCount, stats.completedExams + ' examinations closed', 'accent-maroon') +
      '</div>' +

      '<section class="section-block">' +
      '<div class="section-block-head"><h2>Examination activity</h2>' +
      '<a href="admin/exams/">All examinations <i class="bi bi-arrow-right"></i></a></div>' +
      '<div class="chart-grid">' +
      '<div class="chart-card"><h3>Attempts by examination</h3><p>Total attempts recorded for the six most active examinations.</p>' +
      '<div class="chart-wrap"><canvas id="attemptsChart" aria-label="Attempts by examination chart" role="img"></canvas></div></div>' +
      '<div class="chart-card"><h3>Result distribution</h3><p>Published evaluations grouped by outcome.</p>' +
      '<div class="chart-wrap"><canvas id="resultsChart" aria-label="Result distribution chart" role="img"></canvas></div></div>' +
      '</div></section>' +

      '<section class="section-block">' +
      '<div class="chart-card"><h3>Proctoring events by type</h3>' +
      '<p>Camera, visibility and fullscreen events recorded during monitored attempts.</p>' +
      '<div class="chart-wrap small"><canvas id="eventsChart" aria-label="Proctoring events by type chart" role="img"></canvas></div></div>' +
      '</section>' +

      '<section class="section-block">' +
      '<div class="section-block-head"><h2>Recent proctoring reports</h2>' +
      '<a href="admin/proctoring/">Review all reports <i class="bi bi-arrow-right"></i></a></div>' +
      '<div class="rb-table-wrap">' + eventsTable + '</div></section>';

    drawCharts(chartsData);
  }

  function drawCharts(data) {
    if (!window.Chart) return;
    charts.forEach(function (chart) {
      chart.destroy();
    });
    charts = [];
    RB.chartDefaults();

    var optional = {
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(222, 209, 190, 0.5)' } },
        x: { grid: { display: false } },
      },
    };

    var attempts = RB.$('#attemptsChart');
    if (attempts && data.attemptsByExam) {
      charts.push(new Chart(attempts, {
        type: 'bar',
        data: {
          labels: data.attemptsByExam.map(function (row) { return row.label; }),
          datasets: [{
            label: 'Attempts',
            data: data.attemptsByExam.map(function (row) { return row.value; }),
            backgroundColor: '#762D3F',
            borderRadius: 6,
            maxBarThickness: 46,
          }],
        },
        options: optional,
      }));
    }

    var results = RB.$('#resultsChart');
    if (results && data.resultsDistribution) {
      charts.push(new Chart(results, {
        type: 'doughnut',
        data: {
          labels: data.resultsDistribution.map(function (row) {
            return row.label === 'pass' ? 'Passed' : 'Not passed';
          }),
          datasets: [{
            data: data.resultsDistribution.map(function (row) { return row.value; }),
            backgroundColor: ['#477451', '#A33C3C', '#B58A45', '#526F84'],
            borderWidth: 0,
          }],
        },
        options: {
          cutout: '62%',
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 14 } } },
        },
      }));
    }

    var events = RB.$('#eventsChart');
    if (events && data.eventsByType) {
      charts.push(new Chart(events, {
        type: 'bar',
        data: {
          labels: data.eventsByType.map(function (row) { return RB.eventLabel(row.label); }),
          datasets: [{
            label: 'Events',
            data: data.eventsByType.map(function (row) { return row.value; }),
            backgroundColor: ['#B58A45', '#762D3F', '#526F84', '#B77B28', '#477451', '#A33C3C'],
            borderRadius: 5,
          }],
        },
        options: {
          indexAxis: 'y',
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: 'rgba(222, 209, 190, 0.5)' } },
            y: { grid: { display: false } },
          },
        },
      }));
    }
  }
})();
