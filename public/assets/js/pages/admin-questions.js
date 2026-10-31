(function () {
  'use strict';

  var filters = { search: '', examId: '' };
  var loadedExams = false;

  document.addEventListener('DOMContentLoaded', function () {
    RB.initAdmin('questions', 'Question bank', 'Assessments').then(function (current) {
      if (!current) return;
      bindFilters();
      loadExams();
      load();
    });
  });

  function bindFilters() {
    var search = RB.$('#questionSearch');
    search.addEventListener('input', RB.debounce(function () {
      filters.search = search.value.trim();
      load();
    }, 350));
    RB.$('#questionExam').addEventListener('change', function () {
      filters.examId = this.value;
      load();
    });
    RB.$('#resetQuestionFilters').addEventListener('click', function () {
      search.value = '';
      RB.$('#questionExam').value = '';
      filters = { search: '', examId: '' };
      load();
    });
  }

  function loadExams() {
    if (loadedExams) return;
    loadedExams = true;
    RB.api('api/admin/exams')
      .then(function (data) {
        var select = RB.$('#questionExam');
        (data.items || []).forEach(function (exam) {
          var option = document.createElement('option');
          option.value = String(exam.id);
          option.textContent = exam.title;
          select.appendChild(option);
        });
      })
      .catch(function () {
        loadedExams = false;
      });
  }

  function load() {
    var host = RB.$('#questionsTable');
    var params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.examId) params.set('examId', filters.examId);
    var query = params.toString();

    host.innerHTML = '<div class="rb-table-wrap"><div class="table-empty">' +
      '<span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>Loading questions…</div></div>';

    RB.api('api/admin/questions' + (query ? '?' + query : ''))
      .then(function (data) {
        render(data.items || []);
      })
      .catch(function (error) {
        host.innerHTML = '<div class="rb-table-wrap"><div class="table-empty text-danger">' +
          RB.escape(error.message) + '</div></div>';
      });
  }

  function render(questions) {
    var host = RB.$('#questionsTable');
    var totalMarks = questions.reduce(function (sum, question) {
      return sum + Number(question.marks || 0);
    }, 0);
    RB.$('#questionCount').textContent = questions.length + ' ' + RB.plural(questions.length, 'question') +
      ' · ' + totalMarks + ' marks';

    if (!questions.length) {
      host.innerHTML = RB.emptyState(
        'bi-patch-question',
        'No questions found',
        'Add questions from an examination page, or adjust the search filters.',
        '<a class="btn btn-maroon btn-sm-rb" href="admin/exams/">Go to examinations</a>',
      );
      return;
    }

    host.innerHTML =
      '<div class="rb-table-wrap"><div class="table-responsive"><table class="table table-rb align-middle">' +
      '<thead><tr><th style="width:44%">Question</th><th>Examination</th><th>Marks</th><th>Correct answer</th><th class="text-end">Actions</th></tr></thead>' +
      '<tbody>' + questions.map(function (question) {
        var correct = question.options.find(function (option) { return option.isCorrect; });
        return (
          '<tr>' +
          '<td><div class="cell-title">' + RB.escape(question.text) + '</div>' +
          '<div class="cell-sub">' + question.options.length + ' options · position ' + question.order + '</div></td>' +
          '<td><div class="cell-title">' + RB.escape(question.examTitle) + '</div>' +
          '<div class="cell-sub">' + RB.badge('examStatus', question.examStatus) + '</div></td>' +
          '<td>' + question.marks + '</td>' +
          '<td class="cell-sub">' + RB.escape(correct ? correct.text : 'Not set') + '</td>' +
          '<td class="text-end"><div class="table-actions justify-content-end">' +
          '<button class="btn btn-soft btn-sm-rb" type="button" data-preview="' + question.id + '">' +
          '<i class="bi bi-eye me-1"></i>Preview</button>' +
          '<a class="btn btn-soft btn-sm-rb" href="admin/exam/?id=' + question.examId + '#question-' + question.id + '">' +
          '<i class="bi bi-pencil me-1"></i>Manage</a>' +
          '<button class="btn btn-outline-brown btn-sm-rb" type="button" data-delete="' + question.id + '" aria-label="Delete question">' +
          '<i class="bi bi-trash"></i></button>' +
          '</div></td></tr>'
        );
      }).join('') + '</tbody></table></div></div>';

    RB.$$('[data-preview]', host).forEach(function (button) {
      button.addEventListener('click', function () {
        var id = Number(button.getAttribute('data-preview'));
        var question = questions.find(function (item) { return item.id === id; });
        if (question) preview(question);
      });
    });

    RB.$$('[data-delete]', host).forEach(function (button) {
      button.addEventListener('click', function () {
        deleteQuestion(Number(button.getAttribute('data-delete')), button);
      });
    });
  }

  function preview(question) {
    RB.showModal({
      title: 'Question preview',
      body:
        '<p class="mb-2"><strong>' + RB.escape(question.examTitle) + '</strong> · ' +
        question.marks + ' ' + RB.plural(question.marks, 'mark') + '</p>' +
        '<p style="line-height:1.7">' + RB.escape(question.text) + '</p>' +
        '<div class="question-options" style="padding:0;grid-template-columns:1fr">' +
        question.options.map(function (option) {
          return '<div class="question-option' + (option.isCorrect ? ' correct' : '') + '">' +
            '<i class="bi ' + (option.isCorrect ? 'bi-check-circle-fill' : 'bi-circle') + '"></i>' +
            '<span>' + RB.escape(option.text) + '</span></div>';
        }).join('') + '</div>' +
        '<p class="form-text mt-3 mb-0">The highlighted option is the stored correct answer.</p>',
      size: 'modal-md',
    });
  }

  function deleteQuestion(questionId, button) {
    RB.confirm({
      title: 'Delete question',
      message: 'Delete this question and its options? Questions cannot be deleted after students start attempts for the examination.',
      confirmText: 'Delete question',
      tone: 'danger',
    }).then(function (confirmed) {
      if (!confirmed) return;
      RB.setBusy(button, true, 'Deleting…');
      RB.api('api/admin/questions/' + questionId, { method: 'DELETE' })
        .then(function () {
          RB.toast('Question deleted. Examination total marks recalculated.', 'success');
          load();
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error);
        });
    });
  }
})();
