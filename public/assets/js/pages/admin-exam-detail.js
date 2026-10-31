(function () {
  'use strict';

  var examId = null;
  var exam = null;
  var questions = [];
  var attempts = [];
  var canEditQuestions = false;

  document.addEventListener('DOMContentLoaded', function () {
    examId = RB.idParam();
    RB.initAdmin('exams', 'Examination details', 'Assessments').then(function (current) {
      if (!current) return;
      if (!examId) {
        RB.$('#examRoot').innerHTML = RB.emptyState(
          'bi-exclamation-triangle',
          'No examination selected',
          'Open an examination from the examination management list.',
          '<a class="btn btn-maroon btn-sm-rb" href="admin/exams/">Back to examinations</a>',
        );
        return;
      }
      load();
    });
  });

  function load() {
    Promise.all([
      RB.api('api/admin/exams/' + examId),
      RB.api('api/admin/exams/' + examId + '/attempts'),
    ])
      .then(function (results) {
        exam = results[0].exam;
        questions = results[0].questions || [];
        canEditQuestions = Boolean(results[0].canEditQuestions);
        attempts = results[1].attempts || [];
        render();
      })
      .catch(function (error) {
        RB.$('#examRoot').innerHTML =
          '<div class="rb-card"><div class="rb-card-body">' +
          '<div class="warning-panel danger-panel mb-3">' + RB.escape(error.message) + '</div>' +
          '<a class="btn btn-maroon" href="admin/exams/">Back to examinations</a></div></div>';
      });
  }

  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function toLocalInput(iso) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function statusActions() {
    if (exam.status === 'draft') {
      return '<button class="btn btn-maroon w-100" type="button" data-set-status="published">' +
        '<i class="bi bi-megaphone me-1"></i>Publish examination</button>';
    }
    if (exam.status === 'published') {
      return '<button class="btn btn-maroon w-100" type="button" data-set-status="active">' +
        '<i class="bi bi-broadcast me-1"></i>Activate examination</button>' +
        '<button class="btn btn-soft w-100 mt-2" type="button" data-set-status="draft">' +
        '<i class="bi bi-arrow-counterclockwise me-1"></i>Return to draft</button>';
    }
    if (exam.status === 'active') {
      return '<button class="btn btn-maroon w-100" type="button" data-set-status="closed">' +
        '<i class="bi bi-lock me-1"></i>Close examination</button>';
    }
    return '<button class="btn btn-soft w-100" type="button" data-set-status="published">' +
      '<i class="bi bi-arrow-counterclockwise me-1"></i>Reopen for scheduling</button>';
  }

  function render() {
    var root = RB.$('#examRoot');
    var resultCount = attempts.filter(function (item) {
      return item.resultStatus;
    }).length;
    var marksConflict = exam.passingMarks > exam.totalMarks;

    root.innerHTML =
      '<nav class="breadcrumb-rb"><a href="admin/exams/">Examinations</a> / ' + RB.escape(exam.title) + '</nav>' +
      '<div class="page-head">' +
      '<div><span class="page-eyebrow">' + RB.escape(exam.subject) + '</span>' +
      '<h1>' + RB.escape(exam.title) + '</h1>' +
      '<p>' + RB.formatDateTime(exam.startTime) + ' — ' + RB.formatDateTime(exam.endTime) +
      ' · ' + RB.formatDuration(exam.duration) + ' · ' + exam.totalMarks + ' total marks</p></div>' +
      '<div class="page-actions">' + RB.badge('examStatus', exam.status) +
      (exam.resultsPublished
        ? '<span class="rb-badge badge-success"><i class="bi bi-eye"></i>Results released</span>'
        : '<span class="rb-badge badge-muted"><i class="bi bi-eye-slash"></i>Results held</span>') +
      '<a class="btn btn-soft" href="admin/proctoring/?examId=' + exam.id + '"><i class="bi bi-camera-video me-1"></i>Proctoring</a>' +
      '</div></div>' +

      '<div class="exam-detail-grid">' +
      '<div>' +

      '<section class="section-block">' +
      '<div class="section-block-head"><h2>Examination settings</h2>' +
      '<span class="form-text">Total marks: ' + exam.totalMarks + '</span></div>' +
      (marksConflict
        ? '<div class="warning-panel danger-panel mb-3"><i class="bi bi-exclamation-triangle me-2"></i>' +
          'Passing marks (' + exam.passingMarks + ') exceed the total marks of the questions (' + exam.totalMarks +
          '). Lower the passing marks or add more questions before publishing.</div>'
        : '') +
      '<div class="rb-card"><div class="rb-card-body">' +
      '<form id="examSettingsForm" novalidate>' +
      '<div class="form-grid">' +
      '<div class="full"><label class="form-label" for="editTitle">Title</label>' +
      '<input class="form-control" id="editTitle" name="title" maxlength="150" required value="' + RB.escape(exam.title) + '"></div>' +
      '<div><label class="form-label" for="editSubject">Subject</label>' +
      '<input class="form-control" id="editSubject" name="subject" maxlength="80" required value="' + RB.escape(exam.subject) + '"></div>' +
      '<div><label class="form-label" for="editDuration">Duration (minutes)</label>' +
      '<input class="form-control" id="editDuration" name="duration" type="number" min="1" max="600" required value="' + exam.duration + '"></div>' +
      '<div><label class="form-label" for="editPassing">Passing marks</label>' +
      '<input class="form-control" id="editPassing" name="passingMarks" type="number" min="0" max="5000" required value="' + exam.passingMarks + '"></div>' +
      '<div><label class="form-label" for="editStart">Start date and time</label>' +
      '<input class="form-control" id="editStart" name="startTime" type="datetime-local" required value="' + toLocalInput(exam.startTime) + '"></div>' +
      '<div><label class="form-label" for="editEnd">End date and time</label>' +
      '<input class="form-control" id="editEnd" name="endTime" type="datetime-local" required value="' + toLocalInput(exam.endTime) + '"></div>' +
      '<div class="full"><label class="form-label" for="editDescription">Description</label>' +
      '<textarea class="form-control" id="editDescription" name="description" rows="2" maxlength="2000">' + RB.escape(exam.description) + '</textarea></div>' +
      '<div class="full"><label class="form-label" for="editInstructions">Special instructions</label>' +
      '<textarea class="form-control" id="editInstructions" name="instructions" rows="3" maxlength="5000">' + RB.escape(exam.instructions) + '</textarea></div>' +
      '</div>' +
      '<button class="btn btn-brown mt-3" type="submit" id="saveSettings">' +
      '<i class="bi bi-check2 me-1"></i>Save settings</button>' +
      '</form></div></div></section>' +

      '<section class="section-block">' +
      '<div class="section-block-head"><h2>Questions</h2>' +
      '<div class="d-flex gap-2 align-items-center">' +
      '<span class="form-text">' + questions.length + ' ' + RB.plural(questions.length, 'question') + ' · ' + exam.totalMarks + ' marks</span>' +
      (canEditQuestions
        ? '<button class="btn btn-maroon btn-sm-rb" type="button" id="addQuestion">' +
          '<i class="bi bi-plus-lg me-1"></i>Add question</button>'
        : '') +
      '</div></div>' +
      (canEditQuestions
        ? ''
        : '<div class="warning-panel mb-3"><i class="bi bi-lock me-2"></i>' +
          'Questions are locked because students have already started attempts for this examination.</div>') +
      questionsList() +
      '</section>' +

      '<section class="section-block">' +
      '<div class="section-block-head"><h2>Student attempts</h2>' +
      '<span class="form-text">' + attempts.length + ' ' + RB.plural(attempts.length, 'attempt') + '</span></div>' +
      attemptsList() +
      '</section>' +

      '</div>' +

      '<aside class="exam-side-card">' +
      '<div class="rb-card mb-3"><div class="rb-card-header"><h3>Workflow</h3></div>' +
      '<div class="rb-card-body">' + statusActions() +
      '<p class="form-text mt-3 mb-0">' +
      (exam.status === 'draft'
        ? (questions.length
            ? 'Publish this examination to make it visible to students.'
            : 'Add at least one question before publishing.')
        : exam.status === 'published'
          ? 'Students can see the examination but cannot start until it is active.'
          : exam.status === 'active'
            ? 'Students can start attempts within the scheduled window.'
            : 'Closed examinations cannot be started; existing attempts are preserved.') +
      '</p></div></div>' +

      '<div class="rb-card mb-3"><div class="rb-card-header"><h3>Results</h3></div>' +
      '<div class="rb-card-body">' +
      '<div class="kv-list mb-3">' +
      kv('Evaluated results', String(resultCount)) +
      kv('Published to students', exam.resultsPublished ? 'Yes' : 'No') +
      kv('Passing marks', String(exam.passingMarks)) +
      '</div>' +
      '<button class="btn ' + (exam.resultsPublished ? 'btn-outline-brown' : 'btn-maroon') + ' w-100" type="button" id="toggleResults">' +
      (exam.resultsPublished
        ? '<i class="bi bi-eye-slash me-1"></i>Withdraw results'
        : '<i class="bi bi-send me-1"></i>Release results') +
      '</button>' +
      '<p class="form-text mt-2 mb-0">Students only see marks after results are released.</p>' +
      '</div></div>' +

      '<div class="rb-card"><div class="rb-card-header"><h3>Danger zone</h3></div>' +
      '<div class="rb-card-body">' +
      '<button class="btn btn-outline-brown w-100" type="button" id="deleteExam">' +
      '<i class="bi bi-trash me-1"></i>Delete examination</button>' +
      '<p class="form-text mt-2 mb-0">Examinations with attempts cannot be deleted. Close them instead to preserve records.</p>' +
      '</div></div>' +
      '</aside>' +
      '</div>';

    bind();
  }

  function questionsList() {
    if (!questions.length) {
      return RB.emptyState(
        'bi-patch-plus',
        'No questions yet',
        canEditQuestions
          ? 'Add multiple-choice questions with four options and one correct answer.'
          : 'This examination has no questions.',
      );
    }

    return '<div class="question-list">' + questions.map(function (question, index) {
      var options = question.options.map(function (option) {
        return '<div class="question-option' + (option.isCorrect ? ' correct' : '') + '">' +
          '<i class="bi ' + (option.isCorrect ? 'bi-check-circle-fill' : 'bi-circle') + '"></i>' +
          '<span>' + RB.escape(option.text) + '</span></div>';
      }).join('');

      var tools = canEditQuestions
        ? '<div class="question-item-tools">' +
          '<button class="btn btn-soft btn-sm-rb" type="button" data-question-up="' + index + '" aria-label="Move question up"' +
          (index === 0 ? ' disabled' : '') + '><i class="bi bi-arrow-up"></i></button>' +
          '<button class="btn btn-soft btn-sm-rb" type="button" data-question-down="' + index + '" aria-label="Move question down"' +
          (index === questions.length - 1 ? ' disabled' : '') + '><i class="bi bi-arrow-down"></i></button>' +
          '<button class="btn btn-soft btn-sm-rb" type="button" data-question-edit="' + question.id + '">' +
          '<i class="bi bi-pencil me-1"></i>Edit</button>' +
          '<button class="btn btn-outline-brown btn-sm-rb" type="button" data-question-delete="' + question.id + '">' +
          '<i class="bi bi-trash"></i></button></div>'
        : '';

      return (
        '<article class="question-item" id="question-' + question.id + '">' +
        '<div class="question-item-head">' +
        '<span class="question-number">' + (index + 1) + '</span>' +
        '<div class="question-item-text"><p>' + RB.escape(question.text) + '</p>' +
        '<div class="question-meta">' + question.marks + ' ' + RB.plural(question.marks, 'mark') + '</div></div>' +
        tools + '</div>' +
        '<div class="question-options">' + options + '</div>' +
        '</article>'
      );
    }).join('') + '</div>';
  }

  function attemptsList() {
    if (!attempts.length) {
      return RB.emptyState(
        'bi-clock-history',
        'No attempts yet',
        'Student attempts will appear here once the examination is active and students begin.',
      );
    }
    return '<div class="rb-table-wrap"><div class="table-responsive"><table class="table table-rb align-middle">' +
      '<thead><tr><th>Student</th><th>Started</th><th>Submitted</th><th>Status</th><th>Score</th><th>Proctoring</th></tr></thead>' +
      '<tbody>' + attempts.map(function (attempt) {
        return (
          '<tr>' +
          '<td><div class="cell-title">' + RB.escape(attempt.studentName) + '</div>' +
          '<div class="cell-sub">' + RB.escape(attempt.studentId || 'No student ID') + '</div></td>' +
          '<td class="cell-sub">' + RB.formatDateTime(attempt.startedAt) + '</td>' +
          '<td class="cell-sub">' + (attempt.submittedAt ? RB.formatDateTime(attempt.submittedAt) : '—') + '</td>' +
          '<td>' + RB.badge('attempt', attempt.status) + '</td>' +
          '<td>' + (attempt.percentage === null || attempt.percentage === undefined
            ? '<span class="text-muted-rb">Awaiting evaluation</span>'
            : '<strong>' + RB.formatPercent(attempt.percentage) + '</strong><div class="cell-sub">' +
              attempt.obtainedMarks + ' / ' + attempt.totalMarks + '</div>') + '</td>' +
          '<td class="cell-sub">' + attempt.proctoringEvents + ' events · ' +
          attempt.unreviewedEvents + ' unreviewed</td>' +
          '</tr>'
        );
      }).join('') + '</tbody></table></div></div>';
  }

  function kv(label, value) {
    return '<div class="kv-row"><span>' + RB.escape(label) + '</span><strong>' + RB.escape(value) + '</strong></div>';
  }

  function bind() {
    var root = RB.$('#examRoot');

    RB.$('#examSettingsForm').addEventListener('submit', saveSettings);

    RB.$$('[data-set-status]', root).forEach(function (button) {
      button.addEventListener('click', function () {
        setStatus(button.getAttribute('data-set-status'), button);
      });
    });

    var toggleResults = RB.$('#toggleResults');
    if (toggleResults) toggleResults.addEventListener('click', toggleResultsRelease);

    var deleteButton = RB.$('#deleteExam');
    if (deleteButton) {
      deleteButton.addEventListener('click', function () {
        removeExam(deleteButton);
      });
    }

    var add = RB.$('#addQuestion');
    if (add) add.addEventListener('click', function () { openQuestionModal(null); });

    RB.$$('[data-question-edit]', root).forEach(function (button) {
      button.addEventListener('click', function () {
        var id = Number(button.getAttribute('data-question-edit'));
        var question = questions.find(function (item) { return item.id === id; });
        if (question) openQuestionModal(question);
      });
    });

    RB.$$('[data-question-delete]', root).forEach(function (button) {
      button.addEventListener('click', function () {
        deleteQuestion(Number(button.getAttribute('data-question-delete')), button);
      });
    });

    RB.$$('[data-question-up]', root).forEach(function (button) {
      button.addEventListener('click', function () {
        moveQuestion(Number(button.getAttribute('data-question-up')), -1);
      });
    });
    RB.$$('[data-question-down]', root).forEach(function (button) {
      button.addEventListener('click', function () {
        moveQuestion(Number(button.getAttribute('data-question-down')), 1);
      });
    });
  }

  function saveSettings(event) {
    event.preventDefault();
    var form = event.target;
    var button = RB.$('#saveSettings');
    var els = form.elements;
    RB.clearFieldErrors(form);

    var values = {
      title: els.title.value.trim(),
      subject: els.subject.value.trim(),
      duration: Number(els.duration.value),
      passingMarks: Number(els.passingMarks.value),
      startTime: els.startTime.value ? new Date(els.startTime.value).toISOString() : '',
      endTime: els.endTime.value ? new Date(els.endTime.value).toISOString() : '',
      description: els.description.value.trim(),
      instructions: els.instructions.value.trim(),
    };

    var errors = {};
    if (values.title.length < 3) errors.title = 'Enter an examination title.';
    if (values.subject.length < 2) errors.subject = 'Enter the subject.';
    if (!values.startTime) errors.startTime = 'Choose a start date and time.';
    if (!values.endTime) errors.endTime = 'Choose an end date and time.';
    if (values.startTime && values.endTime && Date.parse(values.endTime) <= Date.parse(values.startTime)) {
      errors.endTime = 'The end time must be after the start time.';
    }
    if (Object.keys(errors).length) {
      RB.showFieldErrors(form, errors);
      return;
    }

    RB.setBusy(button, true, 'Saving…');
    RB.api('api/admin/exams/' + examId, { method: 'PATCH', json: values })
      .then(function () {
        RB.toast('Examination settings saved.', 'success');
        load();
      })
      .catch(function (error) {
        RB.setBusy(button, false);
        RB.handleError(error, form);
      });
  }

  function setStatus(target, button) {
    var labels = { published: 'publish', active: 'activate', closed: 'close', draft: 'return to draft' };
    var label = labels[target] || target;
    RB.confirm({
      title: label.charAt(0).toUpperCase() + label.slice(1) + ' examination',
      message: target === 'active'
        ? 'Students will be able to start this examination immediately, within its scheduled window.'
        : target === 'closed'
          ? 'No new attempts can be started after closing. Active attempts can still be submitted until they expire.'
          : target === 'draft'
            ? 'The examination will be hidden from students until it is published again.'
            : 'The examination becomes visible to students, but they cannot start it until it is activated.',
      confirmText: 'Yes, ' + label,
    }).then(function (confirmed) {
      if (!confirmed) return;
      RB.setBusy(button, true, 'Updating…');
      RB.api('api/admin/exams/' + examId, { method: 'PATCH', json: { status: target } })
        .then(function () {
          RB.toast('Examination status updated.', 'success');
          load();
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error);
        });
    });
  }

  function toggleResultsRelease() {
    var releasing = !exam.resultsPublished;
    RB.confirm({
      title: releasing ? 'Release results' : 'Withdraw results',
      message: releasing
        ? 'Students will immediately be able to see their marks for this examination.'
        : 'Students will no longer see their marks for this examination until results are released again.',
      confirmText: releasing ? 'Release results' : 'Withdraw results',
      tone: releasing ? 'default' : 'danger',
    }).then(function (confirmed) {
      if (!confirmed) return;
      RB.api('api/admin/exams/' + examId + '/results-publish', {
        method: 'PATCH',
        json: { published: releasing },
      })
        .then(function () {
          RB.toast(releasing ? 'Results released to students.' : 'Results withdrawn.', 'success');
          load();
        })
        .catch(function (error) {
          RB.handleError(error);
        });
    });
  }

  function removeExam(button) {
    RB.confirm({
      title: 'Delete examination',
      message: 'Delete "' + exam.title + '" permanently? This cannot be undone, and examinations with attempts cannot be deleted.',
      confirmText: 'Delete examination',
      tone: 'danger',
    }).then(function (confirmed) {
      if (!confirmed) return;
      RB.setBusy(button, true, 'Deleting…');
      RB.api('api/admin/exams/' + examId, { method: 'DELETE' })
        .then(function () {
          RB.toast('Examination deleted.', 'success');
          window.location.href = RB.url('admin/exams/');
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error);
        });
    });
  }

  function moveQuestion(index, delta) {
    var target = index + delta;
    if (target < 0 || target >= questions.length) return;
    var ids = questions.map(function (item) { return item.id; });
    var moved = ids[index];
    ids[index] = ids[target];
    ids[target] = moved;

    RB.api('api/admin/exams/' + examId + '/questions/reorder', {
      method: 'POST',
      json: { questionIds: ids },
    })
      .then(function () {
        load();
      })
      .catch(function (error) {
        RB.handleError(error);
      });
  }

  function deleteQuestion(questionId, button) {
    RB.confirm({
      title: 'Delete question',
      message: 'Delete this question and its four options? This cannot be undone.',
      confirmText: 'Delete question',
      tone: 'danger',
    }).then(function (confirmed) {
      if (!confirmed) return;
      RB.setBusy(button, true, 'Deleting…');
      RB.api('api/admin/questions/' + questionId, { method: 'DELETE' })
        .then(function () {
          RB.toast('Question deleted. Total marks recalculated.', 'success');
          load();
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error);
        });
    });
  }

  function openQuestionModal(question) {
    var editing = Boolean(question);
    var optionValues = editing
      ? question.options.map(function (option) { return option.text; })
      : ['', '', '', ''];
    var correctIndex = editing
      ? question.options.findIndex(function (option) { return option.isCorrect; })
      : 0;
    if (correctIndex < 0) correctIndex = 0;

    var optionsHtml = optionValues.map(function (value, index) {
      return (
        '<div class="option-input-row">' +
        '<input class="form-check-input" type="radio" name="correctIndex" value="' + index + '" id="correct-' + index + '"' +
        (index === correctIndex ? ' checked' : '') + '>' +
        '<label class="form-label mb-0" for="option-' + index + '" style="min-width:74px">Option ' + String.fromCharCode(65 + index) + '</label>' +
        '<input class="form-control" type="text" name="option' + index + '" id="option-' + index + '" maxlength="500" required value="' + RB.escape(value) + '">' +
        '</div>'
      );
    }).join('');

    var modal = RB.showModal({
      title: editing ? 'Edit question' : 'Add question',
      body:
        '<form id="questionForm" novalidate>' +
        '<div class="mb-3"><label class="form-label" for="questionText">Question text</label>' +
        '<textarea class="form-control" id="questionText" name="text" rows="3" maxlength="2000" required>' +
        (editing ? RB.escape(question.text) : '') + '</textarea></div>' +
        '<div class="mb-3" style="max-width:200px"><label class="form-label" for="questionMarks">Marks</label>' +
        '<input class="form-control" id="questionMarks" name="marks" type="number" min="1" max="100" required value="' +
        (editing ? question.marks : 1) + '"></div>' +
        '<fieldset><legend class="form-label d-block">Options and correct answer</legend>' +
        '<p class="form-text mt-0 mb-2">Exactly four options are required. Select the radio button beside the correct answer.</p>' +
        optionsHtml + '</fieldset></form>',
      footer:
        '<button type="button" class="btn btn-soft" data-bs-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="questionForm" class="btn btn-maroon" id="saveQuestion">' +
        (editing ? 'Save question' : 'Add question') + '</button>',
    });

    var form = RB.$('#questionForm', modal.element);
    var button = RB.$('#saveQuestion', modal.element);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      RB.clearFieldErrors(form);
      var els = form.elements;
      var text = els.text.value.trim();
      var marks = Number(els.marks.value);
      var options = [0, 1, 2, 3].map(function (index) {
        return els['option' + index].value.trim();
      });
      var selected = form.querySelector('input[name="correctIndex"]:checked');

      var errors = {};
      if (text.length < 3) errors.text = 'Enter the question text.';
      if (!Number.isInteger(marks) || marks < 1 || marks > 100) errors.marks = 'Marks must be between 1 and 100.';
      options.forEach(function (value, index) {
        if (!value) errors['option' + index] = 'Option ' + String.fromCharCode(65 + index) + ' is required.';
      });
      if (Object.keys(errors).length) {
        RB.showFieldErrors(form, errors);
        return;
      }

      RB.setBusy(button, true, 'Saving…');
      var request = editing
        ? RB.api('api/admin/questions/' + question.id, {
            method: 'PATCH',
            json: { text: text, marks: marks, options: options, correctIndex: Number(selected.value) },
          })
        : RB.api('api/admin/exams/' + examId + '/questions', {
            method: 'POST',
            json: { text: text, marks: marks, options: options, correctIndex: Number(selected.value) },
          });

      request
        .then(function () {
          modal.close();
          RB.toast(editing ? 'Question updated.' : 'Question added.', 'success');
          load();
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error, form);
        });
    });
  }
})();
