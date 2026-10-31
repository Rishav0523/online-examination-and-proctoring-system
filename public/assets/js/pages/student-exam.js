(function () {
  'use strict';

  var exam = null;

  document.addEventListener('DOMContentLoaded', function () {
    RB.initStudent('exams').then(function (current) {
      if (!current) return;
      var id = RB.idParam();
      if (!id) {
        showLoadError('No examination was selected.', 'Return to your dashboard and choose an examination.');
        return;
      }
      RB.api('api/student/exams/' + id)
        .then(function (data) {
          exam = data;
          render(data);
        })
        .catch(function (error) {
          showLoadError(error.message, 'The examination may have been removed or is not available to you.');
        });
    });
  });

  function showLoadError(message, hint) {
    RB.$('#examRoot').innerHTML =
      '<div class="rb-card"><div class="rb-card-body">' +
      '<div class="warning-panel danger-panel mb-3">' + RB.escape(message) + '</div>' +
      '<p class="text-muted-rb">' + RB.escape(hint || '') + '</p>' +
      '<a class="btn btn-maroon" href="student/dashboard/">Back to dashboard</a>' +
      '</div></div>';
  }

  function instructionItems() {
    var text = (exam.instructions || '').trim();
    if (!text) {
      return [
        'Read every question carefully before selecting an answer.',
        'Keep the examination tab open until you submit.',
        'Submit before the timer reaches zero; the server may submit automatically after the deadline.',
      ];
    }
    return text
      .split(/\r?\n/)
      .map(function (line) {
        return line.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim();
      })
      .filter(Boolean);
  }

  function actionPanel() {
    if (exam.state === 'ongoing' && exam.attempt) {
      return (
        '<a class="btn btn-maroon btn-lg" href="student/attempt/?id=' + exam.attempt.id + '">' +
        '<i class="bi bi-arrow-right-circle me-2"></i>Resume attempt</a>' +
        '<p class="exam-side-note">Your attempt is already in progress. The timer continues from the original start time, even if you close the browser.</p>'
      );
    }
    if (exam.state === 'available') {
      return (
        '<div class="consent-box mt-0 mb-3">' +
        '<h3><i class="bi bi-shield-check"></i>Monitoring consent</h3>' +
        '<div class="form-check">' +
        '<input class="form-check-input" type="checkbox" id="consentCheck">' +
        '<label class="form-check-label" for="consentCheck">I have read the instructions and consent to the monitoring described on this page.</label>' +
        '</div></div>' +
        '<button class="btn btn-maroon btn-lg" type="button" id="startButton" disabled>' +
        '<i class="bi bi-play-circle me-2"></i>Start examination</button>' +
        '<p class="exam-side-note">The webcam is requested before the attempt begins. No images or recordings are stored.</p>'
      );
    }
    if (exam.state === 'upcoming') {
      return (
        '<div class="info-panel mb-3">This examination opens on <strong>' + RB.formatDateTime(exam.startTime) + '</strong>.</div>' +
        '<a class="btn btn-outline-brown" href="student/dashboard/">Back to dashboard</a>'
      );
    }
    if (exam.state === 'completed') {
      var resultHtml = exam.result
        ? '<div class="success-panel mb-3"><strong>Result released:</strong> ' + exam.result.obtainedMarks + ' / ' +
          exam.result.totalMarks + ' marks (' + RB.formatPercent(exam.result.percentage) + ') — ' +
          RB.badge('result', exam.result.status) + '</div>'
        : '<div class="info-panel mb-3">Your attempt is complete. The result will appear here after the administrator releases it.</div>';
      return resultHtml + '<a class="btn btn-soft" href="student/results/">View all results</a>';
    }
    if (exam.state === 'ended') {
      return '<div class="warning-panel mb-3">The examination window has ended.</div>' +
        '<a class="btn btn-soft" href="student/dashboard/">Back to dashboard</a>';
    }
    return '<div class="info-panel mb-3">This examination is not currently open for attempts.</div>' +
      '<a class="btn btn-soft" href="student/dashboard/">Back to dashboard</a>';
  }

  function render(data) {
    var instructions = instructionItems().map(function (line) {
      return '<li><i class="bi bi-check2"></i><span>' + RB.escape(line) + '</span></li>';
    }).join('');

    var generalInstructions =
      '<ul class="rule-list mt-3">' +
      '<li><i class="bi bi-check2"></i><span>The timer starts when you begin and runs on the server. Refreshing does not reset it.</span></li>' +
      '<li><i class="bi bi-check2"></i><span>Answers are saved against your attempt as you select them, so you can resume after a refresh.</span></li>' +
      '<li><i class="bi bi-check2"></i><span>Only one attempt is permitted for this examination unless your administrator specifies otherwise.</span></li>' +
      '<li><i class="bi bi-check2"></i><span>The examination is submitted automatically when the deadline is reached.</span></li>' +
      '</ul>';

    RB.$('#examRoot').innerHTML =
      '<div class="exam-detail-grid">' +
      '<div>' +
      '<section class="exam-hero">' +
      '<span class="exam-subject">' + RB.escape(data.subject) + '</span>' +
      '<h1>' + RB.escape(data.title) + '</h1>' +
      '<p>' + RB.escape(data.description || 'Review the details and instructions before starting.') + '</p>' +
      '<div class="exam-meta-grid">' +
      '<div class="exam-meta-tile"><span class="label">Questions</span><span class="value"><i class="bi bi-list-ol"></i>' + data.questionCount + '</span></div>' +
      '<div class="exam-meta-tile"><span class="label">Total marks</span><span class="value"><i class="bi bi-award"></i>' + data.totalMarks + '</span></div>' +
      '<div class="exam-meta-tile"><span class="label">Duration</span><span class="value"><i class="bi bi-hourglass"></i>' + RB.formatDuration(data.duration) + '</span></div>' +
      '<div class="exam-meta-tile"><span class="label">Passing marks</span><span class="value"><i class="bi bi-flag"></i>' + data.passingMarks + '</span></div>' +
      '</div></section>' +

      '<section class="exam-info-card">' +
      '<h2><i class="bi bi-journal-text"></i>Examination instructions</h2>' +
      (instructions ? '<ul class="rule-list">' + instructions + '</ul>' : '<p class="text-muted-rb mb-0">No additional instructions were provided.</p>') +
      '<h2 class="mt-4"><i class="bi bi-shield-check"></i>Timing and answer handling</h2>' +
      generalInstructions +
      '</section>' +

      '<section class="exam-info-card">' +
      '<h2><i class="bi bi-camera-video"></i>Browser-based monitoring</h2>' +
      '<p class="text-muted-rb" style="font-size:.83rem;line-height:1.65">' +
      'If the examination is monitored, the browser will request webcam access before the attempt begins. With your consent, the portal checks whether a face is visible, whether more than one face appears, and whether the camera disconnects. It also records tab switches, loss of window focus and fullscreen exits.</p>' +
      '<p class="text-muted-rb" style="font-size:.83rem;line-height:1.65">' +
      'No webcam images, audio or recordings are stored. A browser cannot reliably observe other applications, physical devices or external assistance. Recorded events are indicators for administrator review and are not automatic proof of misconduct. You may continue without a camera; browser activity monitoring still applies.</p>' +
      '<div class="warning-panel mt-2">' +
      'Allow camera access when requested and keep your face visible. You may see a visible warning when an event is recorded.' +
      '</div></section>' +
      '</div>' +

      '<aside class="exam-side-card">' +
      '<div class="exam-side-head">Examination summary</div>' +
      '<div class="exam-side-body">' +
      '<div class="side-fact"><span>Status</span><strong>' + RB.badge('examState', data.state) + '</strong></div>' +
      '<div class="side-fact"><span>Opens</span><strong>' + RB.formatDateTime(data.startTime) + '</strong></div>' +
      '<div class="side-fact"><span>Closes</span><strong>' + RB.formatDateTime(data.endTime) + '</strong></div>' +
      '<div class="side-fact"><span>Duration</span><strong>' + RB.formatDuration(data.duration) + '</strong></div>' +
      '<div class="side-fact mb-3"><span>Attempts</span><strong>One attempt</strong></div>' +
      actionPanel() +
      '</div></aside>' +
      '</div>';

    RB.currentYear();
    bindStart();
  }

  function bindStart() {
    var consent = RB.$('#consentCheck');
    var button = RB.$('#startButton');
    if (!consent || !button) return;

    consent.addEventListener('change', function () {
      button.disabled = !consent.checked;
    });

    button.addEventListener('click', function () {
      if (!consent.checked) return;
      RB.setBusy(button, true, 'Preparing your attempt…');
      RB.api('api/student/exams/' + exam.id + '/start', {
        method: 'POST',
        json: { consent: true },
      })
        .then(function (data) {
          window.location.replace('student/attempt/?id=' + data.attemptId);
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.toast(error.message, 'danger');
          if (error.code === 'ALREADY_ATTEMPTED' || error.code === 'EXAM_NOT_ACTIVE' || error.code === 'EXAM_ENDED') {
            window.setTimeout(function () {
              window.location.reload();
            }, 1400);
          }
        });
    });
  }
})();
