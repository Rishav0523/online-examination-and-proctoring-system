(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', function () {
    RB.initStudent('dashboard').then(function (current) {
      if (!current) return;
      loadDashboard();
    });
  });

  function loadDashboard() {
    var root = RB.$('#dashboardRoot');
    Promise.all([
      RB.api('api/student/dashboard'),
      RB.api('api/student/attempts'),
    ])
      .then(function (results) {
        render(root, results[0], results[1].items || []);
      })
      .catch(function (error) {
        root.innerHTML =
          '<div class="rb-card"><div class="rb-card-body">' +
          '<div class="warning-panel danger-panel mb-3">' + RB.escape(error.message) + '</div>' +
          '<button class="btn btn-maroon" type="button" id="retryDashboard">Try again</button>' +
          '</div></div>';
        var retry = RB.$('#retryDashboard');
        if (retry) retry.addEventListener('click', loadDashboard);
      });
  }

  function examCard(exam) {
    var action;
    if (exam.state === 'ongoing' && exam.attempt) {
      action = '<a class="btn btn-maroon btn-sm-rb" href="student/attempt/?id=' + exam.attempt.id + '">Resume attempt</a>';
    } else if (exam.state === 'available') {
      action = '<a class="btn btn-maroon btn-sm-rb" href="student/exam/?id=' + exam.id + '">View and start</a>';
    } else if (exam.state === 'completed') {
      action = '<a class="btn btn-soft btn-sm-rb" href="student/exam/?id=' + exam.id + '">View examination</a>';
    } else {
      action = '<a class="btn btn-soft btn-sm-rb" href="student/exam/?id=' + exam.id + '">View details</a>';
    }

    return (
      '<article class="exam-card">' +
      '<div class="exam-card-top"><span class="exam-subject">' + RB.escape(exam.subject) + '</span>' +
      RB.badge('examState', exam.state) + '</div>' +
      '<h3>' + RB.escape(exam.title) + '</h3>' +
      '<p>' + RB.escape(exam.description || 'No additional description was provided for this examination.') + '</p>' +
      '<div class="exam-meta">' +
      '<span><i class="bi bi-list-ol"></i>' + exam.questionCount + ' ' + RB.plural(exam.questionCount, 'question') + '</span>' +
      '<span><i class="bi bi-award"></i>' + exam.totalMarks + ' marks</span>' +
      '<span><i class="bi bi-hourglass"></i>' + RB.formatDuration(exam.duration) + '</span>' +
      '</div>' +
      '<div class="exam-window"><strong>Window:</strong> ' + RB.formatDateTime(exam.startTime) +
      ' — ' + RB.formatDateTime(exam.endTime) + '</div>' +
      '<div class="exam-card-foot">' + action +
      '<span class="form-text">Pass: ' + exam.passingMarks + ' marks</span></div>' +
      '</article>'
    );
  }

  function attemptRow(attempt) {
    var action;
    if (attempt.status === 'in_progress') {
      action = '<a class="btn btn-maroon btn-sm-rb" href="student/attempt/?id=' + attempt.id + '">Resume</a>';
    } else {
      action = '<a class="btn btn-soft btn-sm-rb" href="student/exam/?id=' + attempt.examId + '">Details</a>';
    }
    var score = attempt.result
      ? '<strong class="text-maroon">' + attempt.result.obtainedMarks + ' / ' + attempt.result.totalMarks + '</strong>' +
        '<div class="cell-sub">' + RB.formatPercent(attempt.result.percentage) + '</div>'
      : '<span class="text-muted-rb">' + (attempt.status === 'in_progress' ? 'Not submitted' : 'Awaiting release') + '</span>';

    return (
      '<tr>' +
      '<td><div class="cell-title">' + RB.escape(attempt.examTitle) + '</div>' +
      '<div class="cell-sub">' + RB.escape(attempt.subject) + '</div></td>' +
      '<td>' + RB.formatDateTime(attempt.startedAt) + '</td>' +
      '<td>' + (attempt.submittedAt ? RB.formatDateTime(attempt.submittedAt) : '—') + '</td>' +
      '<td>' + RB.badge('attempt', attempt.status) + '</td>' +
      '<td>' + score + '</td>' +
      '<td class="text-end">' + action + '</td>' +
      '</tr>'
    );
  }

  function render(root, data, attempts) {
    var user = data.user;
    var summary = data.summary;
    var exams = data.exams || [];
    var available = exams.filter(function (exam) {
      return exam.state === 'available' || exam.state === 'ongoing';
    });
    var upcoming = exams.filter(function (exam) {
      return exam.state === 'upcoming';
    });
    var dormant = exams.filter(function (exam) {
      return exam.state === 'locked' || exam.state === 'ended';
    });
    var recentResults = data.recentResults || [];

    var stats =
      '<div class="stats-grid">' +
      stat('bi-unlock', 'Available now', summary.available, 'Examinations you can start', 'accent-success') +
      stat('bi-hourglass-split', 'In progress', summary.ongoing, 'Attempts waiting to be finished', 'accent-warning') +
      stat('bi-clock', 'Upcoming', summary.upcoming, 'Scheduled examinations', 'accent-info') +
      stat('bi-clipboard-data', 'Published results', summary.publishedResults, 'Released by your administrator', 'accent-maroon') +
      '</div>';

    var availableSection = available.length
      ? '<div class="exam-grid">' + available.map(examCard).join('') + '</div>'
      : RB.emptyState(
          'bi-journal-check',
          'No examinations are open right now',
          'Examinations appear here when an administrator activates them within the scheduled window.',
          '<a class="btn btn-outline-brown btn-sm-rb" href="#upcoming">View upcoming examinations</a>',
        );

    var upcomingSection = upcoming.length
      ? '<div class="exam-grid">' + upcoming.map(examCard).join('') + '</div>'
      : RB.emptyState('bi-calendar3', 'No upcoming examinations', 'Scheduled examinations will be listed here once they are published.');

    var dormantSection = dormant.length
      ? '<section class="section-block" id="dormant"><div class="section-block-head">' +
        '<h2>Other examinations</h2><span class="form-text">' + dormant.length + ' listed</span></div>' +
        '<p class="form-text mt-0">Published examinations appear here until an administrator activates them. Ended examinations can no longer be started.</p>' +
        '<div class="exam-grid">' + dormant.map(examCard).join('') + '</div></section>'
      : '';

    var history = attempts.length
      ? '<div class="rb-table-wrap"><div class="table-responsive"><table class="table table-rb align-middle">' +
        '<thead><tr><th>Examination</th><th>Started</th><th>Submitted</th><th>Status</th><th>Score</th><th class="text-end">Action</th></tr></thead>' +
        '<tbody>' + attempts.map(attemptRow).join('') + '</tbody></table></div></div>'
      : RB.emptyState('bi-clock-history', 'No attempts yet', 'Your examination attempts will be recorded here.');

    var resultsList = recentResults.length
      ? recentResults.map(function (result) {
          return (
            '<div class="result-row">' +
            '<div class="result-main"><strong>' + RB.escape(result.examTitle) + '</strong>' +
            '<small>' + RB.escape(result.subject) + ' · ' + RB.formatDateTime(result.evaluatedAt) + '</small></div>' +
            '<div class="result-score">' + RB.formatPercent(result.percentage) +
            '<small>' + result.obtainedMarks + ' / ' + result.totalMarks + ' marks</small></div>' +
            RB.badge('result', result.status) +
            '</div>'
          );
        }).join('')
      : RB.emptyState('bi-clipboard-x', 'No published results', 'Results become visible after the administrator releases them.');

    root.innerHTML =
      '<div class="welcome-panel">' +
      '<span class="page-eyebrow" style="color:var(--light-gold)">Student dashboard</span>' +
      '<h1>Welcome back, ' + RB.escape(user.fullName) + '</h1>' +
      '<p>Review the examinations available to you, resume an attempt in progress, and check results released by your administrator.</p>' +
      '<div class="welcome-meta">' +
      '<span class="welcome-chip"><i class="bi bi-person-badge"></i>' + RB.escape(user.studentId || 'Student') + '</span>' +
      '<span class="welcome-chip"><i class="bi bi-buildings"></i>' + RB.escape(user.department || 'Department not set') + '</span>' +
      '<span class="welcome-chip"><i class="bi bi-layers"></i>Semester ' + RB.escape(user.semester) + '</span>' +
      '</div></div>' +
      stats +
      '<section class="section-block" id="exams"><div class="section-block-head">' +
      '<h2>Available and ongoing examinations</h2>' +
      '<a href="student/results/">Published results <i class="bi bi-arrow-right"></i></a></div>' +
      availableSection + '</section>' +
      '<section class="section-block" id="upcoming"><div class="section-block-head">' +
      '<h2>Upcoming examinations</h2><span class="form-text">' + upcoming.length + ' scheduled</span></div>' +
      upcomingSection + '</section>' +
      dormantSection +
      '<section class="section-block" id="history"><div class="section-block-head">' +
      '<h2>Examination history</h2><span class="form-text">' + attempts.length + ' ' + RB.plural(attempts.length, 'attempt') + '</span></div>' +
      history + '</section>' +
      '<section class="section-block" id="results"><div class="section-block-head">' +
      '<h2>Published results</h2><a href="student/results/">View all results <i class="bi bi-arrow-right"></i></a></div>' +
      '<div class="rb-card"><div class="rb-card-body py-2">' + resultsList + '</div></div></section>';

    RB.currentYear();
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
})();
