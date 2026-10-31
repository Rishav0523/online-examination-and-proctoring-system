(function () {
  'use strict';

  var attemptId = null;
  var questions = [];
  var answers = {};
  var current = 0;
  var deadlineMs = 0;
  var clockOffset = 0;
  var timerInterval = null;
  var resyncInterval = null;
  var submitting = false;
  var finished = false;
  var monitoring = false;
  var proctor = null;
  var pendingSaves = new Map();
  var failedSaves = new Map();
  var saveInFlight = false;
  var saveCompleted = false;
  var alertTimer = null;
  var autoSubmitFailed = false;

  document.addEventListener('DOMContentLoaded', function () {
    RB.guard('student').then(function (currentUser) {
      if (!currentUser) return;
      attemptId = RB.idParam();
      if (!attemptId) {
        showLoadError('No attempt was selected.', 'Open an examination from your dashboard to begin.');
        return;
      }
      loadAttempt();
    });
  });

  /* ------------------------------------------------------------------ */
  /* loading                                                            */
  /* ------------------------------------------------------------------ */

  function loadAttempt() {
    RB.api('api/student/attempts/' + attemptId)
      .then(function (data) {
        RB.$('#attemptExamTitle').textContent = data.examTitle || 'Examination';
        if (data.finished) {
          renderFinish(data);
          return;
        }
        renderAttempt(data);
      })
      .catch(function (error) {
        showLoadError(error.message, 'The attempt may have been submitted in another tab or is no longer available.');
      });
  }

  function showLoadError(message, hint) {
    RB.$('#attemptRoot').innerHTML =
      '<div class="rb-card" style="grid-column:1 / -1"><div class="rb-card-body">' +
      '<div class="warning-panel danger-panel mb-3">' + RB.escape(message) + '</div>' +
      '<p class="text-muted-rb">' + RB.escape(hint || '') + '</p>' +
      '<a class="btn btn-maroon" href="student/dashboard/">Return to dashboard</a>' +
      '</div></div>';
    var timer = RB.$('#attemptTimer');
    if (timer) timer.style.display = 'none';
    var submit = RB.$('#submitTopButton');
    if (submit) submit.style.display = 'none';
  }

  /* ------------------------------------------------------------------ */
  /* attempt layout                                                     */
  /* ------------------------------------------------------------------ */

  function renderAttempt(data) {
    questions = data.questions || [];
    answers = Object.assign({}, data.answers || {});
    deadlineMs = Date.parse(data.expiresAt);
    clockOffset = Date.parse(data.serverNow) - Date.now();

    RB.$('#attemptExamMeta').textContent =
      (data.subject ? data.subject + ' · ' : '') + questions.length + ' questions · ' +
      RB.formatDuration(data.duration);

    RB.$('#attemptRoot').innerHTML =
      '<div class="attempt-main">' +
      '<div class="attempt-progress">' +
      '<span>Question <strong id="questionPosition">1</strong> of <span id="questionTotal">' + questions.length + '</span></span>' +
      '<span><strong id="answeredCount">0</strong> answered · <span id="unansweredCount">' + questions.length + '</span> remaining</span>' +
      '</div>' +
      '<div id="questionCard"></div>' +
      '<div class="attempt-actions">' +
      '<button class="btn btn-soft" type="button" id="prevButton"><i class="bi bi-arrow-left me-1"></i>Previous</button>' +
      '<span class="save-state" id="saveState" aria-live="polite">Answers save automatically</span>' +
      '<div class="d-flex gap-2 flex-wrap">' +
      '<button class="btn btn-soft" type="button" id="clearAnswerButton">Clear answer</button>' +
      '<button class="btn btn-maroon" type="button" id="nextButton">Next<i class="bi bi-arrow-right ms-1"></i></button>' +
      '</div></div></div>' +

      '<aside class="attempt-rail">' +
      '<div class="monitor-card">' +
      '<div class="monitor-card-head"><span><i class="bi bi-camera-video me-1"></i>Live monitor</span>' +
      '<span class="monitor-badge" id="videoBadge">Starting</span></div>' +
      '<div class="monitor-video-wrap">' +
      '<video id="proctorVideo" autoplay playsinline muted aria-label="Webcam preview"></video>' +
      '<div class="video-offline" id="videoOffline"><i class="bi bi-camera-video-off"></i><span>Camera is off</span></div>' +
      '</div>' +
      '<div class="monitor-status">' +
      '<div class="monitor-status-row"><span>Camera</span><strong><span class="dot" id="cameraDot"></span><span id="cameraStatus">Not started</span></strong></div>' +
      '<div class="monitor-status-row"><span>Face check</span><strong><span class="dot" id="faceDot"></span><span id="faceStatus">Not started</span></strong></div>' +
      '<div class="monitor-status-row"><span>Recorded events</span><strong id="eventCount">0</strong></div>' +
      '</div>' +
      '<p class="monitor-note">Only the webcam preview and browser activity are observed. No images or recordings are stored. Events are reviewed by administrators and are not automatic proof of misconduct.</p>' +
      '</div>' +

      '<div class="nav-card">' +
      '<h3>Question navigator</h3>' +
      '<div class="question-nav" id="questionNav" role="group" aria-label="Question navigator"></div>' +
      '<div class="qnav-legend"><span><i></i>Unanswered</span><span><i class="answered"></i>Answered</span><span><i class="current"></i>Current</span></div>' +
      '</div>' +

      '<div class="nav-card">' +
      '<h3>Submission</h3>' +
      '<p class="form-text mb-2">You can change answers until you submit. The examination is submitted automatically when the timer ends.</p>' +
      '<button class="btn btn-maroon attempt-submit-btn" type="button" id="submitSideButton"><i class="bi bi-send me-2"></i>Submit examination</button>' +
      '</div>' +
      '</aside>';

    if (!questions.length) {
      RB.$('#questionCard').innerHTML =
        '<div class="rb-card"><div class="rb-card-body">' +
        RB.emptyState('bi-journal-x', 'No questions available', 'This examination does not currently contain any questions. Contact your administrator.') +
        '</div></div>';
    }

    bindLayout();
    renderQuestion();
    renderNavigator();
    updateAnswerCounts();
    showSetup();
    startClock();

    window.addEventListener('beforeunload', warnBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
  }

  function bindLayout() {
    var prev = RB.$('#prevButton');
    var next = RB.$('#nextButton');
    var clear = RB.$('#clearAnswerButton');
    var submitTop = RB.$('#submitTopButton');
    var submitSide = RB.$('#submitSideButton');

    if (prev) prev.addEventListener('click', function () { goTo(current - 1); });
    if (next) next.addEventListener('click', function () { goTo(current + 1); });
    if (clear) clear.addEventListener('click', clearCurrentAnswer);
    if (submitTop) submitTop.addEventListener('click', function () { requestSubmit(false); });
    if (submitSide) submitSide.addEventListener('click', function () { requestSubmit(false); });

    var card = RB.$('#questionCard');
    if (card) {
      card.addEventListener('change', function (event) {
        var input = event.target;
        if (!input || input.type !== 'radio') return;
        var questionId = Number(input.getAttribute('data-question'));
        var optionId = Number(input.value);
        if (!questionId || !optionId) return;
        selectAnswer(questionId, optionId);
      });
    }

    var nav = RB.$('#questionNav');
    if (nav) {
      nav.addEventListener('click', function (event) {
        var button = event.target.closest('[data-question-index]');
        if (!button) return;
        goTo(Number(button.getAttribute('data-question-index')));
      });
    }

    var saveState = RB.$('#saveState');
    if (saveState) {
      saveState.addEventListener('click', function (event) {
        if (event.target.closest('#retrySaves')) retryFailedSaves();
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* questions                                                          */
  /* ------------------------------------------------------------------ */

  function renderQuestion() {
    var card = RB.$('#questionCard');
    if (!card) return;
    if (!questions.length) return;
    var question = questions[current];
    var selected = answers[question.id];

    var options = question.options.map(function (option, index) {
      return (
        '<label class="option-item">' +
        '<input type="radio" name="question-' + question.id + '" value="' + option.id + '"' +
        ' data-question="' + question.id + '"' + (selected === option.id ? ' checked' : '') + '>' +
        '<span class="option-box">' +
        '<span class="option-letter">' + String.fromCharCode(65 + index) + '</span>' +
        '<span class="option-text">' + RB.escape(option.text) + '</span>' +
        '</span></label>'
      );
    }).join('');

    card.innerHTML =
      '<section class="question-card">' +
      '<div class="question-head">' +
      '<div class="question-index">Question ' + (current + 1) +
      '<span class="marks">' + question.marks + ' ' + RB.plural(question.marks, 'mark') + '</span></div>' +
      '<p class="question-text">' + RB.escape(question.text) + '</p>' +
      '</div>' +
      '<div class="options-list">' + options + '</div>' +
      '</section>';

    var position = RB.$('#questionPosition');
    if (position) position.textContent = String(current + 1);
    var total = RB.$('#questionTotal');
    if (total) total.textContent = String(questions.length);
    var prev = RB.$('#prevButton');
    if (prev) prev.disabled = current === 0;
    var next = RB.$('#nextButton');
    if (next) {
      next.disabled = current >= questions.length - 1;
      next.innerHTML = current >= questions.length - 1
        ? 'Review<i class="bi bi-check2 ms-1"></i>'
        : 'Next<i class="bi bi-arrow-right ms-1"></i>';
    }
    var clear = RB.$('#clearAnswerButton');
    if (clear) clear.disabled = selected === null || selected === undefined;
    renderNavigator();
  }

  function renderNavigator() {
    var nav = RB.$('#questionNav');
    if (!nav) return;
    nav.innerHTML = questions.map(function (question, index) {
      var answered = answers[question.id] !== null && answers[question.id] !== undefined;
      var classes = 'qnav-btn';
      if (answered) classes += ' answered';
      if (index === current) classes += ' current';
      return '<button type="button" class="' + classes + '" data-question-index="' + index +
        '" aria-label="Question ' + (index + 1) + (answered ? ', answered' : ', unanswered') +
        '" aria-current="' + (index === current ? 'true' : 'false') + '">' + (index + 1) + '</button>';
    }).join('');
    var active = RB.$('.qnav-btn.current', nav);
    if (active && active.scrollIntoView) {
      active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function goTo(index) {
    if (index < 0 || index >= questions.length || index === current) return;
    current = index;
    renderQuestion();
  }

  function selectAnswer(questionId, optionId) {
    if (finished || submitting) return;
    answers[questionId] = optionId;
    renderNavigator();
    updateAnswerCounts();
    var clear = RB.$('#clearAnswerButton');
    if (clear) clear.disabled = false;
    queueSave(questionId, optionId);
  }

  function clearCurrentAnswer() {
    if (finished || submitting || !questions.length) return;
    var question = questions[current];
    answers[question.id] = null;
    RB.$$('input[name="question-' + question.id + '"]').forEach(function (input) {
      input.checked = false;
    });
    renderNavigator();
    updateAnswerCounts();
    var clear = RB.$('#clearAnswerButton');
    if (clear) clear.disabled = true;
    queueSave(question.id, null);
  }

  function answeredTotal() {
    return questions.filter(function (question) {
      return answers[question.id] !== null && answers[question.id] !== undefined;
    }).length;
  }

  function updateAnswerCounts() {
    var answered = answeredTotal();
    var answeredNode = RB.$('#answeredCount');
    if (answeredNode) answeredNode.textContent = String(answered);
    var remainingNode = RB.$('#unansweredCount');
    if (remainingNode) remainingNode.textContent = String(questions.length - answered);
  }

  /* ------------------------------------------------------------------ */
  /* answer persistence                                                 */
  /* ------------------------------------------------------------------ */

  function queueSave(questionId, optionId) {
    failedSaves.delete(questionId);
    pendingSaves.set(questionId, optionId);
    flushSaves();
  }

  function flushSaves() {
    if (saveInFlight || finished) return;
    var next = pendingSaves.entries().next();
    if (next.done) {
      refreshSaveState();
      return;
    }
    var questionId = next.value[0];
    var optionId = next.value[1];
    pendingSaves.delete(questionId);
    saveInFlight = true;
    refreshSaveState();

    RB.api('api/student/attempts/' + attemptId + '/answers/' + questionId, {
      method: 'PUT',
      json: { optionId: optionId },
    })
      .then(function () {
        saveInFlight = false;
        saveCompleted = true;
        flushSaves();
      })
      .catch(function (error) {
        saveInFlight = false;
        if (error.code === 'ATTEMPT_CLOSED' || error.code === 'ATTEMPT_EXPIRED') {
          fetchFinishedState();
          return;
        }
        failedSaves.set(questionId, optionId);
        flushSaves();
        RB.toast('An answer could not be saved. Use Retry to try again.', 'danger');
      });
  }

  function refreshSaveState() {
    var node = RB.$('#saveState');
    if (!node) return;
    if (saveInFlight) {
      node.className = 'save-state saving';
      node.innerHTML = '<span class="spinner-border spinner-border-sm" aria-hidden="true"></span>Saving…';
    } else if (failedSaves.size > 0) {
      node.className = 'save-state failed';
      node.innerHTML = '<i class="bi bi-exclamation-triangle"></i>Not saved ' +
        '<button type="button" id="retrySaves" class="btn btn-soft btn-sm-rb ms-1">Retry</button>';
    } else if (saveCompleted) {
      node.className = 'save-state saved';
      node.innerHTML = '<i class="bi bi-cloud-check"></i>Saved ' + RB.formatTime(new Date().toISOString());
    } else {
      node.className = 'save-state';
      node.textContent = 'Answers save automatically';
    }
  }

  function retryFailedSaves() {
    failedSaves.forEach(function (optionId, questionId) {
      pendingSaves.set(questionId, optionId);
    });
    failedSaves.clear();
    flushSaves();
  }

  function waitForSaves() {
    if (failedSaves.size > 0) retryFailedSaves();
    return new Promise(function (resolve) {
      var waited = 0;
      var interval = window.setInterval(function () {
        var done = !saveInFlight && pendingSaves.size === 0;
        if (done || waited >= 6000) {
          window.clearInterval(interval);
          resolve();
          return;
        }
        waited += 120;
      }, 120);
    });
  }

  /* ------------------------------------------------------------------ */
  /* timer                                                              */
  /* ------------------------------------------------------------------ */

  function startClock() {
    tick();
    if (timerInterval) window.clearInterval(timerInterval);
    timerInterval = window.setInterval(tick, 500);
    if (resyncInterval) window.clearInterval(resyncInterval);
    resyncInterval = window.setInterval(resyncState, 60000);
    document.addEventListener('visibilitychange', handleVisibility);
  }

  function tick() {
    if (finished) return;
    var remaining = Math.ceil((deadlineMs - (Date.now() + clockOffset)) / 1000);
    if (remaining <= 0) {
      updateTimer(0);
      if (!submitting && !autoSubmitFailed) requestSubmit(true);
      return;
    }
    updateTimer(remaining);
  }

  function updateTimer(remaining) {
    var text = RB.formatCountdown(remaining);
    var node = RB.$('#attemptTimerText');
    if (node) node.textContent = text;
    var timer = RB.$('#attemptTimer');
    if (timer) {
      timer.classList.toggle('is-warning', remaining > 0 && remaining <= 300);
      timer.classList.toggle('is-danger', remaining > 0 && remaining <= 60);
      timer.setAttribute('aria-label', 'Time remaining ' + text);
    }
  }

  function resyncState() {
    if (finished || submitting) return;
    RB.api('api/student/attempts/' + attemptId)
      .then(function (data) {
        if (data.finished) {
          renderFinish(data);
          return;
        }
        deadlineMs = Date.parse(data.expiresAt);
        clockOffset = Date.parse(data.serverNow) - Date.now();
      })
      .catch(function (error) {
        if (error.status === 404 || error.status === 409) fetchFinishedState();
      });
  }

  function handleVisibility() {
    if (!document.hidden && !finished) resyncState();
  }

  function fetchFinishedState() {
    RB.api('api/student/attempts/' + attemptId)
      .then(function (data) {
        if (data.finished) renderFinish(data);
        else window.location.reload();
      })
      .catch(function () {
        window.location.reload();
      });
  }

  /* ------------------------------------------------------------------ */
  /* setup overlay and proctoring                                       */
  /* ------------------------------------------------------------------ */

  function showSetup() {
    var host = RB.$('#setupOverlayHost');
    if (!host) return;
    host.innerHTML =
      '<div class="setup-overlay" role="dialog" aria-modal="true" aria-labelledby="setupTitle">' +
      '<div class="setup-card">' +
      '<div class="setup-head">' +
      '<span class="setup-icon"><i class="bi bi-shield-check"></i></span>' +
      '<h2 id="setupTitle">Set up your monitored attempt</h2>' +
      '<p>Complete the browser setup before you start answering questions.</p>' +
      '</div>' +
      '<div class="setup-body">' +
      '<ul class="setup-list">' +
      '<li><i class="bi bi-stopwatch"></i><span>The timer is already tracked by the server and continues while this panel is open.</span></li>' +
      '<li><i class="bi bi-camera-video"></i><span>Camera access is requested only after you press the button below. The live preview is visible throughout the attempt.</span></li>' +
      '<li><i class="bi bi-fullscreen"></i><span>The portal will request fullscreen mode to reduce accidental distractions.</span></li>' +
      '<li><i class="bi bi-eye"></i><span>Tab switches, window focus changes and fullscreen exits are recorded as reviewable events.</span></li>' +
      '<li><i class="bi bi-shield-lock"></i><span>No images, audio or recordings are stored. You can continue without a camera.</span></li>' +
      '</ul>' +
      '<div class="setup-status" id="setupStatus" role="status"></div>' +
      '<div class="setup-actions">' +
      '<button class="btn btn-maroon btn-lg" type="button" id="enableCameraButton">' +
      '<i class="bi bi-camera-video me-2"></i>Enable camera and begin</button>' +
      '<button class="setup-skip" type="button" id="skipCameraButton">Continue without a camera</button>' +
      '</div>' +
      '<p class="form-text mt-3 mb-0">Your explicit consent was recorded when this attempt started. If you do not wish to continue, return to your dashboard; the timer will keep running.</p>' +
      '</div></div></div>';

    var enableButton = RB.$('#enableCameraButton');
    var skipButton = RB.$('#skipCameraButton');

    enableButton.addEventListener('click', function () {
      if (!proctor) initProctor();
      RB.setBusy(enableButton, true, 'Requesting camera…');
      proctor.requestFullscreen();
      proctor.startCamera().then(function (result) {
        if (!result.ok) {
          RB.setBusy(enableButton, false);
          showSetupStatus(result.message + ' You may continue without a camera; browser activity monitoring still applies.');
          return;
        }
        showSetupStatus('Camera active. Loading the local face detection model…');
        return proctor.loadFaceDetection().then(function () {
          beginSession();
        });
      });
    });

    skipButton.addEventListener('click', function () {
      RB.confirm({
        title: 'Continue without a camera?',
        message: 'Face presence cannot be checked without a webcam. Browser activity monitoring will still be active and recorded. You can enable the camera later from the monitoring panel.',
        confirmText: 'Continue without camera',
        cancelText: 'Go back',
      }).then(function (accepted) {
        if (!accepted) return;
        if (!proctor) initProctor();
        proctor.requestFullscreen();
        beginSession();
      });
    });

    var cameraPanel = RB.$('.monitor-card');
    if (cameraPanel) {
      cameraPanel.addEventListener('click', function (event) {
        if (event.target.closest('#restartCameraButton')) startCameraAgain();
      });
    }
  }

  function showSetupStatus(message) {
    var status = RB.$('#setupStatus');
    if (!status) return;
    status.textContent = message;
    status.classList.add('show');
  }

  function initProctor() {
    proctor = RBProctor.create({
      attemptId: attemptId,
      video: RB.$('#proctorVideo'),
      onEvent: function (type, message) {
        showProctorAlert('Monitoring event recorded: ' + message);
      },
      onWarning: function (message, tone) {
        showProctorAlert(message, tone);
      },
      onStatus: function (status) {
        updateMonitorUi(status);
      },
    });
  }

  function beginSession() {
    var host = RB.$('#setupOverlayHost');
    if (host) host.innerHTML = '';
    monitoring = true;
    if (!proctor) initProctor();
    proctor.start();
    updateMonitorUi(proctor.status);
    showProctorAlert('Monitoring is active for this attempt. Keep this tab open and your face visible when the camera is enabled.', 'info');
    RB.toast('Monitored examination started. Your answers are saved as you go.', 'success');
  }

  function startCameraAgain() {
    if (!proctor) initProctor();
    RB.toast('Requesting camera access…', 'info');
    proctor.startCamera().then(function (result) {
      if (!result.ok) {
        RB.toast(result.message, 'danger');
        return;
      }
      proctor.loadFaceDetection().then(function () {
        updateMonitorUi(proctor.status);
        RB.toast('Camera reconnected.', 'success');
      });
    });
  }

  function updateMonitorUi(status) {
    var cameraDot = RB.$('#cameraDot');
    var cameraText = RB.$('#cameraStatus');
    var faceDot = RB.$('#faceDot');
    var faceText = RB.$('#faceStatus');
    var badge = RB.$('#videoBadge');
    var offline = RB.$('#videoOffline');
    var events = RB.$('#eventCount');

    if (!cameraDot || !badge) return;

    var cameraState = status.camera;
    if (cameraState === 'live') {
      cameraDot.className = 'dot ok';
      cameraText.textContent = 'Active';
      badge.className = 'monitor-badge ok';
      badge.innerHTML = '<i class="bi bi-record-circle"></i>Camera on';
      if (offline) offline.style.display = 'none';
    } else {
      cameraDot.className = 'dot ' + (cameraState === 'off' || cameraState === 'denied' ? 'bad' : 'warn');
      cameraText.textContent = cameraState === 'denied'
        ? 'Permission denied'
        : cameraState === 'unsupported'
          ? 'Unsupported'
          : 'Off';
      badge.className = 'monitor-badge ' + (cameraState === 'off' || cameraState === 'denied' ? 'bad' : 'warn');
      badge.innerHTML = '<i class="bi bi-camera-video-off"></i>Camera off';
      if (offline) {
        offline.style.display = '';
        var textNode = offline.querySelector('span');
        if (textNode) {
          textNode.textContent = monitoring ? 'Camera off — click here to reconnect' : 'Camera is off';
        }
      }
      var panel = RB.$('.monitor-card');
      if (monitoring && panel && !RB.$('#restartCameraButton', panel)) {
        var reconnect = document.createElement('button');
        reconnect.type = 'button';
        reconnect.id = 'restartCameraButton';
        reconnect.className = 'btn btn-soft btn-sm-rb w-100';
        reconnect.innerHTML = '<i class="bi bi-arrow-clockwise me-1"></i>Reconnect camera';
        panel.appendChild(reconnect);
      }
      if (cameraState === 'live') {
        var existing = RB.$('#restartCameraButton');
        if (existing) existing.remove();
      }
    }

    if (faceDot && faceText) {
      if (status.models === 'unavailable') {
        faceDot.className = 'dot warn';
        faceText.textContent = 'Unavailable';
      } else if (status.models === 'pending') {
        faceDot.className = 'dot';
        faceText.textContent = 'Preparing model';
      } else if (status.face === 'ok') {
        faceDot.className = 'dot ok';
        faceText.textContent = 'Face detected';
      } else if (status.face === 'none') {
        faceDot.className = 'dot warn';
        faceText.textContent = 'No face visible';
      } else if (status.face === 'multiple') {
        faceDot.className = 'dot bad';
        faceText.textContent = 'Multiple faces';
      } else {
        faceDot.className = 'dot';
        faceText.textContent = cameraState === 'live' ? 'Checking…' : 'Not checked';
      }
    }

    if (events) events.textContent = String(status.events || 0);
  }

  function showProctorAlert(message, tone) {
    var host = RB.$('#proctorAlertHost');
    if (!host) return;
    host.innerHTML = '';
    var node = document.createElement('div');
    node.className = 'attempt-proctor-alert';
    node.setAttribute('role', 'status');
    node.innerHTML =
      '<i class="bi ' + (tone === 'info' ? 'bi-info-circle' : tone === 'danger' ? 'bi-exclamation-octagon' : 'bi-exclamation-triangle') + '"></i>' +
      '<span>' + RB.escape(message) + '</span>';
    if (tone === 'danger') {
      node.style.background = '#fbf0ef';
      node.style.color = '#7c2f2f';
    }
    host.appendChild(node);
    if (alertTimer) window.clearTimeout(alertTimer);
    alertTimer = window.setTimeout(function () {
      if (node.parentNode) node.remove();
    }, 9000);
  }

  /* ------------------------------------------------------------------ */
  /* submission                                                         */
  /* ------------------------------------------------------------------ */

  function requestSubmit(auto) {
    if (finished || submitting) return;

    if (auto) {
      var autoMessage = RB.$('#submitTopButton');
      if (autoMessage) RB.setBusy(autoMessage, true, 'Submitting…');
      doSubmit(true);
      return;
    }

    var answered = answeredTotal();
    var unanswered = questions.length - answered;
    var message = 'You have answered ' + answered + ' of ' + questions.length + ' questions.';
    if (unanswered > 0) message += ' ' + unanswered + ' ' + RB.plural(unanswered, 'question') + ' will be left unanswered.';
    message += ' You cannot change your answers after submission.';

    RB.confirm({
      title: 'Submit this examination?',
      message: message,
      confirmText: 'Submit examination',
      cancelText: 'Keep working',
      tone: 'danger',
    }).then(function (accepted) {
      if (accepted) doSubmit(false);
    });
  }

  function doSubmit(auto) {
    if (submitting || finished) return;
    submitting = true;
    autoSubmitFailed = false;

    var top = RB.$('#submitTopButton');
    var side = RB.$('#submitSideButton');
    if (top) RB.setBusy(top, true, 'Submitting…');
    if (side) RB.setBusy(side, true, 'Submitting…');
    RB.$$('#questionCard input').forEach(function (input) { input.disabled = true; });

    if (auto) {
      var overlay = RB.$('#setupOverlayHost');
      if (overlay) overlay.innerHTML = '';
      showProctorAlert('Time is up. Your examination is being submitted automatically.', 'danger');
    }
    if (proctor) proctor.stop();

    waitForSaves().then(function () {
      return RB.api('api/student/attempts/' + attemptId + '/submit', { method: 'POST' });
    })
      .then(function (outcome) {
        renderFinish(outcome);
      })
      .catch(function (error) {
        submitting = false;
        if (auto) autoSubmitFailed = true;
        if (top) RB.setBusy(top, false);
        if (side) RB.setBusy(side, false);
        RB.$$('#questionCard input').forEach(function (input) { input.disabled = false; });

        if (error.code === 'ATTEMPT_CLOSED') {
          fetchFinishedState();
          return;
        }
        var host = RB.$('#proctorAlertHost');
        if (host) {
          host.innerHTML =
            '<div class="attempt-proctor-alert" role="alert">' +
            '<i class="bi bi-exclamation-octagon"></i>' +
            '<span>Submission did not complete: ' + RB.escape(error.message) +
            ' Your saved answers are safe. The server will finalise the attempt when its deadline passes.</span>' +
            '<button class="btn btn-soft btn-sm-rb ms-auto" type="button" id="retrySubmit">Retry submission</button>' +
            '</div>';
          var retry = RB.$('#retrySubmit');
          if (retry) {
            retry.addEventListener('click', function () {
              submitting = false;
              autoSubmitFailed = false;
              doSubmit(true);
            });
          }
        }
      });
  }

  /* ------------------------------------------------------------------ */
  /* finish                                                             */
  /* ------------------------------------------------------------------ */

  function renderFinish(data) {
    if (finished) return;
    finished = true;
    submitting = true;
    if (timerInterval) window.clearInterval(timerInterval);
    if (resyncInterval) window.clearInterval(resyncInterval);
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('beforeunload', warnBeforeUnload);
    window.removeEventListener('pagehide', handlePageHide);
    if (proctor) proctor.stop();
    var host = RB.$('#setupOverlayHost');
    if (host) host.innerHTML = '';
    var alertHost = RB.$('#proctorAlertHost');
    if (alertHost) alertHost.innerHTML = '';

    var timer = RB.$('#attemptTimer');
    if (timer) timer.style.display = 'none';
    var topSubmit = RB.$('#submitTopButton');
    if (topSubmit) topSubmit.style.display = 'none';
    var meta = RB.$('#attemptExamMeta');
    if (meta) meta.textContent = 'Attempt complete';
    if (data.examTitle) RB.$('#attemptExamTitle').textContent = data.examTitle;

    var expired = data.status === 'expired';
    var released = Boolean(data.resultsPublished && data.result);
    var submittedAt = data.submittedAt ? ' Submitted ' + RB.formatDateTime(data.submittedAt) + '.' : '';
    var title = expired ? 'Time expired — attempt submitted' : 'Examination submitted';
    var description = expired
      ? 'The examination deadline was reached. Your saved answers were evaluated automatically.'
      : 'Your responses were recorded successfully and evaluated by the server.';
    if (data.alreadySubmitted && !expired) description = 'This attempt had already been submitted. Showing its current state.';
    if (!released) description += ' The result will appear after the administrator releases it for this examination.';

    var scoreHtml = released
      ? '<div class="finish-score">' + RB.formatPercent(data.result.percentage) + '</div>' +
        '<p class="mb-2">' + data.result.obtainedMarks + ' out of ' + data.result.totalMarks + ' marks</p>' +
        RB.badge('result', data.result.status)
      : '<div class="info-panel mt-3">Results are not published yet. You can safely close this page; your submission is stored.</div>';

    RB.$('#attemptRoot').innerHTML =
      '<div class="finish-card" style="grid-column:1 / -1">' +
      '<div class="finish-icon"><i class="bi ' + (expired ? 'bi-clock-history' : 'bi-check2') + '"></i></div>' +
      '<span class="page-eyebrow">Attempt #' + RB.escape(String(data.attemptId || attemptId)) + '</span>' +
      '<h1>' + RB.escape(title) + '</h1>' +
      '<p>' + RB.escape(description) + RB.escape(submittedAt) + '</p>' +
      scoreHtml +
      '<div class="finish-actions">' +
      '<a class="btn btn-maroon" href="student/dashboard/">Back to dashboard</a>' +
      '<a class="btn btn-outline-brown" href="student/results/">View published results</a>' +
      '</div>' +
      '<p class="form-text mt-3 mb-0">A recorded proctoring event is an indicator for administrator review, not an automatic finding.</p>' +
      '</div>';
    RB.currentYear();
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                          */
  /* ------------------------------------------------------------------ */

  function warnBeforeUnload(event) {
    if (finished || !monitoring) return;
    event.preventDefault();
    event.returnValue = '';
    return '';
  }

  function handlePageHide() {
    if (proctor) proctor.stop({ exitFullscreen: false });
  }

  function handlePageShow(event) {
    if (event.persisted && !finished) window.location.reload();
  }
})();
