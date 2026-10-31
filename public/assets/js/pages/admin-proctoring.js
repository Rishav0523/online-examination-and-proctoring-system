(function () {
  'use strict';

  var filters = { search: '', examId: '', reviewStatus: '', severity: '' };
  var examsLoaded = false;

  document.addEventListener('DOMContentLoaded', function () {
    RB.initAdmin('proctoring', 'Proctoring reports', 'Integrity').then(function (current) {
      if (!current) return;
      applyInitialFilters();
      bindFilters();
      loadExams();
      load();
    });
  });

  function applyInitialFilters() {
    filters.search = RB.qs('search') || '';
    filters.examId = RB.qs('examId') || '';
    filters.reviewStatus = RB.qs('reviewStatus') || '';
    filters.severity = RB.qs('severity') || '';
    RB.$('#proctorSearch').value = filters.search;
    RB.$('#proctorReview').value = filters.reviewStatus;
    RB.$('#proctorSeverity').value = filters.severity;
  }

  function bindFilters() {
    var search = RB.$('#proctorSearch');
    search.addEventListener('input', RB.debounce(function () {
      filters.search = search.value.trim();
      load();
    }, 350));
    ['proctorExam', 'proctorReview', 'proctorSeverity'].forEach(function (id) {
      RB.$('#' + id).addEventListener('change', function () {
        filters.examId = RB.$('#proctorExam').value;
        filters.reviewStatus = RB.$('#proctorReview').value;
        filters.severity = RB.$('#proctorSeverity').value;
        load();
      });
    });
    RB.$('#resetProctorFilters').addEventListener('click', function () {
      search.value = '';
      RB.$('#proctorExam').value = '';
      RB.$('#proctorReview').value = '';
      RB.$('#proctorSeverity').value = '';
      filters = { search: '', examId: '', reviewStatus: '', severity: '' };
      load();
    });
  }

  function loadExams() {
    if (examsLoaded) return;
    examsLoaded = true;
    RB.api('api/admin/exams')
      .then(function (data) {
        var select = RB.$('#proctorExam');
        (data.items || []).forEach(function (exam) {
          var option = document.createElement('option');
          option.value = String(exam.id);
          option.textContent = exam.title;
          select.appendChild(option);
        });
        if (filters.examId) select.value = filters.examId;
      })
      .catch(function () {
        examsLoaded = false;
      });
  }

  function load() {
    var host = RB.$('#proctorTable');
    var params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.examId) params.set('examId', filters.examId);
    if (filters.reviewStatus) params.set('reviewStatus', filters.reviewStatus);
    if (filters.severity) params.set('severity', filters.severity);
    var query = params.toString();

    host.innerHTML = '<div class="rb-table-wrap"><div class="table-empty">' +
      '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading proctoring reports…</div></div>';

    RB.api('api/admin/proctoring' + (query ? '?' + query : ''))
      .then(function (data) {
        render(data.items || []);
      })
      .catch(function (error) {
        host.innerHTML = '<div class="rb-table-wrap"><div class="table-empty text-danger">' +
          RB.escape(error.message) + '</div></div>';
      });
  }

  function render(events) {
    var host = RB.$('#proctorTable');
    var unreviewed = events.filter(function (event) { return event.reviewStatus === 'unreviewed'; }).length;
    var high = events.filter(function (event) { return event.severity === 'high'; }).length;

    RB.$('#proctorSummary').innerHTML =
      stat('bi-camera-video', 'Events shown', events.length, 'Current filters, up to 500', 'accent-maroon') +
      stat('bi-eye', 'Awaiting review', unreviewed, 'Unreviewed indicators', 'accent-warning') +
      stat('bi-exclamation-octagon', 'High severity', high, 'Require closer attention', 'accent-danger') +
      stat('bi-people', 'Students involved', new Set(events.map(function (event) { return event.studentName; })).size, 'Unique students in this view', 'accent-info');

    RB.$('#proctorCount').textContent = events.length + ' ' + RB.plural(events.length, 'event');

    if (!events.length) {
      host.innerHTML = RB.emptyState(
        'bi-camera-video',
        'No proctoring events found',
        'Events appear here when monitored attempts record camera, visibility or fullscreen signals.',
      );
      return;
    }

    host.innerHTML =
      '<div class="rb-table-wrap"><div class="table-responsive"><table class="table table-rb align-middle">' +
      '<thead><tr><th>Student</th><th>Examination</th><th>Event</th><th>Severity</th><th>Recorded</th><th>Review</th><th class="text-end">Actions</th></tr></thead>' +
      '<tbody>' + events.map(function (event) {
        return (
          '<tr>' +
          '<td><div class="cell-title">' + RB.escape(event.studentName) + '</div>' +
          '<div class="cell-sub">' + RB.escape(event.studentId || 'No student ID') + '</div></td>' +
          '<td><div class="cell-title">' + RB.escape(event.examTitle) + '</div>' +
          '<div class="cell-sub">Attempt #' + event.attemptId + '</div></td>' +
          '<td><div class="cell-title">' + RB.escape(RB.eventLabel(event.eventType)) + '</div>' +
          '<div class="cell-sub" style="max-width:340px">' + RB.escape(event.description) + '</div></td>' +
          '<td>' + RB.badge('severity', event.severity) + '</td>' +
          '<td class="cell-sub">' + RB.formatDateTime(event.timestamp) + '</td>' +
          '<td>' + RB.badge('review', event.reviewStatus) + '</td>' +
          '<td class="text-end"><div class="table-actions justify-content-end">' +
          (event.reviewStatus === 'unreviewed'
            ? '<button class="btn btn-soft btn-sm-rb" type="button" data-review="' + event.id + '" data-status="reviewed">' +
              '<i class="bi bi-check2 me-1"></i>Mark reviewed</button>' +
              '<button class="btn btn-outline-brown btn-sm-rb" type="button" data-review="' + event.id + '" data-status="dismissed">' +
              '<i class="bi bi-slash-circle me-1"></i>Dismiss</button>'
            : '<button class="btn btn-soft btn-sm-rb" type="button" data-review="' + event.id + '" data-status="unreviewed">' +
              '<i class="bi bi-arrow-counterclockwise me-1"></i>Reopen</button>') +
          '</div></td></tr>'
        );
      }).join('') + '</tbody></table></div></div>';

    RB.$$('[data-review]', host).forEach(function (button) {
      button.addEventListener('click', function () {
        review(
          Number(button.getAttribute('data-review')),
          button.getAttribute('data-status'),
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
      '<div class="stat-value">' + Number(value || 0) + '</div>' +
      '<div class="stat-hint">' + RB.escape(hint) + '</div></div></div>'
    );
  }

  function review(eventId, status, button) {
    if (status === 'dismissed') {
      RB.confirm({
        title: 'Dismiss event',
        message: 'Dismiss this event as a false positive? The event stays in the record with a dismissed status.',
        confirmText: 'Dismiss event',
      }).then(function (confirmed) {
        if (confirmed) sendReview(eventId, status, button);
      });
      return;
    }
    sendReview(eventId, status, button);
  }

  function sendReview(eventId, status, button) {
    RB.setBusy(button, true, 'Saving…');
    RB.api('api/admin/proctoring/' + eventId, {
      method: 'PATCH',
      json: { reviewStatus: status },
    })
      .then(function () {
        RB.toast(
          status === 'reviewed' ? 'Event marked as reviewed.' : status === 'dismissed' ? 'Event dismissed.' : 'Event reopened.',
          'success',
        );
        load();
      })
      .catch(function (error) {
        RB.setBusy(button, false);
        RB.handleError(error);
      });
  }
})();
