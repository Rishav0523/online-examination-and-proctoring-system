(function () {
  'use strict';

  var exams = [];
  var filters = { search: '', status: 'all' };

  document.addEventListener('DOMContentLoaded', function () {
    RB.initAdmin('exams', 'Examination management', 'Assessments').then(function (current) {
      if (!current) return;
      RB.$('#createExamButton').addEventListener('click', openCreateExam);
      RB.$('#examSearch').addEventListener('input', RB.debounce(function () {
        filters.search = this.value.trim().toLowerCase();
        renderTable();
      }, 200));
      RB.$('#examStatusFilter').addEventListener('change', function () {
        filters.status = this.value;
        renderTable();
      });
      load();
    });
  });

  function load() {
    RB.api('api/admin/exams')
      .then(function (data) {
        exams = data.items || [];
        renderSummary(data.summary || {});
        renderTable();
      })
      .catch(function (error) {
        RB.$('#examsTable').innerHTML =
          '<div class="rb-table-wrap"><div class="table-empty text-danger">' + RB.escape(error.message) + '</div></div>';
      });
  }

  function renderSummary(summary) {
    var items = [
      ['bi-file-earmark', 'Draft', summary.draft || 0, 'Not visible to students', ''],
      ['bi-megaphone', 'Published', summary.published || 0, 'Visible and scheduled', 'accent-info'],
      ['bi-broadcast', 'Active', summary.active || 0, 'Students can start now', 'accent-success'],
      ['bi-lock', 'Closed', summary.closed || 0, 'No new attempts allowed', 'accent-maroon'],
    ];
    RB.$('#examSummary').innerHTML = items.map(function (item) {
      return (
        '<div class="stat-card ' + item[4] + '">' +
        '<span class="stat-icon"><i class="bi ' + item[0] + '"></i></span>' +
        '<div><span class="stat-label">' + item[1] + '</span>' +
        '<div class="stat-value">' + item[2] + '</div>' +
        '<div class="stat-hint">' + item[3] + '</div></div></div>'
      );
    }).join('');
  }

  function renderTable() {
    var host = RB.$('#examsTable');
    var visible = exams.filter(function (exam) {
      if (filters.status !== 'all' && exam.status !== filters.status) return false;
      if (!filters.search) return true;
      return (
        exam.title.toLowerCase().includes(filters.search) ||
        exam.subject.toLowerCase().includes(filters.search)
      );
    });

    if (!visible.length) {
      host.innerHTML = RB.emptyState(
        'bi-journal-bookmark',
        exams.length ? 'No examinations match these filters' : 'No examinations created yet',
        exams.length
          ? 'Adjust the search term or status filter.'
          : 'Create a draft examination, add at least one question, then publish or activate it.',
        '<button class="btn btn-maroon btn-sm-rb" type="button" data-create-exam>Create examination</button>',
      );
      var create = RB.$('[data-create-exam]', host);
      if (create) create.addEventListener('click', openCreateExam);
      return;
    }

    host.innerHTML =
      '<div class="rb-table-wrap"><div class="table-responsive"><table class="table table-rb align-middle">' +
      '<thead><tr><th>Examination</th><th>Schedule</th><th>Status</th><th>Questions</th><th>Attempts</th><th>Results</th><th class="text-end">Actions</th></tr></thead>' +
      '<tbody>' + visible.map(row).join('') + '</tbody></table></div></div>';

    RB.$$('[data-manage]', host).forEach(function (link) {
      link.addEventListener('click', function () {
        window.location.href = RB.url('admin/exam/') + '?id=' + link.getAttribute('data-manage');
      });
    });
    RB.$$('[data-status]', host).forEach(function (button) {
      button.addEventListener('click', function () {
        changeStatus(
          Number(button.getAttribute('data-status')),
          button.getAttribute('data-target'),
          button,
        );
      });
    });
    RB.$$('[data-delete]', host).forEach(function (button) {
      button.addEventListener('click', function () {
        removeExam(Number(button.getAttribute('data-delete')), button);
      });
    });
  }

  function row(exam) {
    var statusAction = '';
    if (exam.status === 'draft') {
      statusAction = '<button class="btn btn-soft btn-sm-rb" type="button" data-status="' + exam.id + '" data-target="published">Publish</button>';
    } else if (exam.status === 'published') {
      statusAction = '<button class="btn btn-soft btn-sm-rb" type="button" data-status="' + exam.id + '" data-target="active">Activate</button>';
    } else if (exam.status === 'active') {
      statusAction = '<button class="btn btn-soft btn-sm-rb" type="button" data-status="' + exam.id + '" data-target="closed">Close</button>';
    }
    var resultsBadge = exam.resultCount > 0
      ? (exam.resultsPublished
          ? '<span class="rb-badge badge-success"><i class="bi bi-eye"></i>Released</span>'
          : '<span class="rb-badge badge-warning"><i class="bi bi-eye-slash"></i>Held</span>')
      : '<span class="text-muted-rb">—</span>';

    return (
      '<tr>' +
      '<td><div class="cell-title">' + RB.escape(exam.title) + '</div>' +
      '<div class="cell-sub">' + RB.escape(exam.subject) + ' · ' + RB.formatDuration(exam.duration) + '</div></td>' +
      '<td class="cell-sub">' + RB.formatDateTime(exam.startTime) + '<br>' + RB.formatDateTime(exam.endTime) + '</td>' +
      '<td>' + RB.badge('examStatus', exam.status) + '</td>' +
      '<td>' + exam.questionCount + ' <span class="cell-sub">' + exam.totalMarks + ' marks</span></td>' +
      '<td>' + exam.attemptCount + '</td>' +
      '<td>' + resultsBadge + '</td>' +
      '<td class="text-end"><div class="table-actions justify-content-end">' +
      statusAction +
      '<button class="btn btn-soft btn-sm-rb" type="button" data-manage="' + exam.id + '">' +
      '<i class="bi bi-sliders me-1"></i>Manage</button>' +
      '<button class="btn btn-outline-brown btn-sm-rb" type="button" data-delete="' + exam.id + '" aria-label="Delete ' + RB.escape(exam.title) + '">' +
      '<i class="bi bi-trash"></i></button>' +
      '</div></td></tr>'
    );
  }

  function changeStatus(examId, target, button) {
    var exam = exams.find(function (item) { return item.id === examId; });
    var label = target === 'active' ? 'activate' : target === 'closed' ? 'close' : 'publish';
    RB.confirm({
      title: (label.charAt(0).toUpperCase() + label.slice(1)) + ' examination',
      message: label === 'close'
        ? 'Students will no longer be able to start this examination. Attempts in progress can still be submitted until they expire.'
        : label === 'activate'
          ? 'Students will be able to start the examination immediately, within its scheduled window.'
          : 'Publishing makes the examination visible to students, but they can only start it once it is active.',
      confirmText: 'Yes, ' + label,
    }).then(function (confirmed) {
      if (!confirmed) return;
      RB.setBusy(button, true, 'Saving…');
      RB.api('api/admin/exams/' + examId, {
        method: 'PATCH',
        json: { status: target },
      })
        .then(function () {
          RB.toast('Examination ' + (target === 'active' ? 'activated.' : target === 'closed' ? 'closed.' : 'published.'), 'success');
          load();
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error);
          if (error.code === 'EXAM_NOT_READY' && exam) {
            RB.toast('Add at least one question in Manage before publishing.', 'info');
          }
        });
    });
  }

  function removeExam(examId, button) {
    var exam = exams.find(function (item) { return item.id === examId; });
    RB.confirm({
      title: 'Delete examination',
      message: 'Delete "' + (exam ? exam.title : 'this examination') +
        '" permanently? Examinations with recorded attempts cannot be deleted.',
      confirmText: 'Delete examination',
      tone: 'danger',
    }).then(function (confirmed) {
      if (!confirmed) return;
      RB.setBusy(button, true, 'Deleting…');
      RB.api('api/admin/exams/' + examId, { method: 'DELETE' })
        .then(function () {
          RB.toast('Examination deleted.', 'success');
          load();
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error);
        });
    });
  }

  function openCreateExam() {
    var modal = RB.showModal({
      title: 'Create examination',
      body:
        '<form id="createExamForm" novalidate>' +
        '<div class="form-grid">' +
        '<div class="full"><label class="form-label" for="examTitle">Examination title</label>' +
        '<input class="form-control" id="examTitle" name="title" maxlength="150" required placeholder="End semester examination"></div>' +
        '<div><label class="form-label" for="examSubject">Subject</label>' +
        '<input class="form-control" id="examSubject" name="subject" maxlength="80" required placeholder="Data Structures"></div>' +
        '<div><label class="form-label" for="examDuration">Duration (minutes)</label>' +
        '<input class="form-control" id="examDuration" name="duration" type="number" min="1" max="600" required value="60"></div>' +
        '<div><label class="form-label" for="examPassing">Passing marks</label>' +
        '<input class="form-control" id="examPassing" name="passingMarks" type="number" min="0" max="5000" required value="40">' +
        '<div class="form-text">Total marks are calculated from the questions you add.</div></div>' +
        '<div><label class="form-label" for="examStart">Start date and time</label>' +
        '<input class="form-control" id="examStart" name="startTime" type="datetime-local" required></div>' +
        '<div><label class="form-label" for="examEnd">End date and time</label>' +
        '<input class="form-control" id="examEnd" name="endTime" type="datetime-local" required></div>' +
        '<div class="full"><label class="form-label" for="examDescription">Description</label>' +
        '<textarea class="form-control" id="examDescription" name="description" rows="2" maxlength="2000" placeholder="Shown on the student examination card"></textarea></div>' +
        '<div class="full"><label class="form-label" for="examInstructions">Special instructions</label>' +
        '<textarea class="form-control" id="examInstructions" name="instructions" rows="3" maxlength="5000" placeholder="Optional instructions shown before the attempt begins"></textarea>' +
        '<div class="form-text">The examination is created as a draft. Add questions before publishing.</div></div>' +
        '</div></form>',
      footer:
        '<button type="button" class="btn btn-soft" data-bs-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="createExamForm" class="btn btn-maroon" id="createExamSubmit">Create draft</button>',
    });

    var form = RB.$('#createExamForm', modal.element);
    var button = RB.$('#createExamSubmit', modal.element);
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      RB.clearFieldErrors(form);

      var els = form.elements;
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

      RB.setBusy(button, true, 'Creating…');
      RB.api('api/admin/exams', { method: 'POST', json: values })
        .then(function (data) {
          RB.toast('Draft examination created. Add questions to continue.', 'success');
          window.location.href = RB.url('admin/exam/') + '?id=' + data.exam.id;
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error, form);
        });
    });
  }
})();
