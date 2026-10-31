(function () {
  'use strict';

  var SEMESTERS = ['1', '2', '3', '4', '5', '6', '7', '8'];

  document.addEventListener('DOMContentLoaded', function () {
    RB.initAdmin('profile', 'Administrator profile', 'Account').then(function (current) {
      if (!current) return;
      render(current);
    });
  });

  function semesterOptions(selected) {
    return SEMESTERS.map(function (value) {
      return '<option value="' + value + '"' + (String(selected) === value ? ' selected' : '') + '>Semester ' + value + '</option>';
    }).join('');
  }

  function render(user) {
    var root = RB.$('#adminProfileRoot');
    root.innerHTML =
      '<div class="student-profile-grid">' +
      '<div class="profile-card">' +
      '<div class="profile-identity">' + RB.avatar(user.fullName, 'avatar-lg') +
      '<div><h2>' + RB.escape(user.fullName) + '</h2>' +
      '<p>Examination administrator</p></div>' +
      '<span class="rb-badge badge-gold ms-auto"><i class="bi bi-shield-lock"></i>Admin</span></div>' +
      '<div class="kv-list">' +
      kv('Email address', user.email) +
      kv('Role', 'Administrator') +
      kv('Department', user.department || 'Not set') +
      kv('Account created', RB.formatDate(user.createdAt)) +
      '</div>' +
      '<p class="form-text mt-3 mb-0">Administrator accounts are created with the local administration command. ' +
      'Public registration never creates administrator accounts.</p>' +
      '</div>' +

      '<div>' +
      '<div class="profile-card mb-3">' +
      '<h2><i class="bi bi-pencil-square"></i>Edit profile</h2>' +
      '<form id="adminProfileForm" novalidate>' +
      '<div class="form-grid">' +
      '<div class="full"><label class="form-label" for="adminFullName">Full name</label>' +
      '<input class="form-control" id="adminFullName" name="fullName" maxlength="120" required value="' + RB.escape(user.fullName) + '"></div>' +
      '<div><label class="form-label" for="adminDepartment">Department</label>' +
      '<input class="form-control" id="adminDepartment" name="department" maxlength="100" required value="' + RB.escape(user.department) + '"></div>' +
      '<div><label class="form-label" for="adminSemester">Semester</label>' +
      '<select class="form-select" id="adminSemester" name="semester" required>' + semesterOptions(user.semester) + '</select>' +
      '<div class="form-text">Stored with the account; administrators are not limited by semester.</div></div>' +
      '</div>' +
      '<button class="btn btn-maroon mt-3" type="submit" id="adminProfileButton">' +
      '<i class="bi bi-check2 me-1"></i>Save changes</button>' +
      '</form></div>' +

      '<div class="profile-card">' +
      '<h2><i class="bi bi-shield-lock"></i>Change password</h2>' +
      '<form id="adminPasswordForm" novalidate>' +
      '<div class="form-grid">' +
      '<div class="full"><label class="form-label" for="adminCurrentPassword">Current password</label>' +
      '<div class="input-group"><input class="form-control" type="password" id="adminCurrentPassword" name="currentPassword" autocomplete="current-password" maxlength="128" required>' +
      '<button class="password-toggle" type="button" data-password-toggle="adminCurrentPassword" aria-label="Show password"><i class="bi bi-eye"></i></button></div></div>' +
      '<div><label class="form-label" for="adminNewPassword">New password</label>' +
      '<div class="input-group"><input class="form-control" type="password" id="adminNewPassword" name="newPassword" autocomplete="new-password" minlength="8" maxlength="128" required>' +
      '<button class="password-toggle" type="button" data-password-toggle="adminNewPassword" aria-label="Show password"><i class="bi bi-eye"></i></button></div>' +
      '<div class="form-text">At least 8 characters with a letter and a number.</div></div>' +
      '<div><label class="form-label" for="adminConfirmPassword">Confirm new password</label>' +
      '<div class="input-group"><input class="form-control" type="password" id="adminConfirmPassword" name="confirmPassword" autocomplete="new-password" maxlength="128" required>' +
      '<button class="password-toggle" type="button" data-password-toggle="adminConfirmPassword" aria-label="Show password"><i class="bi bi-eye"></i></button></div></div>' +
      '</div>' +
      '<button class="btn btn-outline-brown mt-3" type="submit" id="adminPasswordButton">' +
      '<i class="bi bi-key me-1"></i>Update password</button>' +
      '<p class="form-text mt-2 mb-0">Changing your password signs out every other active session.</p>' +
      '</form></div>' +
      '</div></div>';

    RB.bindPasswordToggles(root);
    bindProfileForm();
    bindPasswordForm();
  }

  function kv(label, value) {
    return '<div class="kv-row"><span>' + RB.escape(label) + '</span><strong>' + RB.escape(value) + '</strong></div>';
  }

  function bindProfileForm() {
    var form = RB.$('#adminProfileForm');
    var button = RB.$('#adminProfileButton');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      RB.clearFieldErrors(form);
      var els = form.elements;
      var fullName = els.fullName.value.trim();
      var department = els.department.value.trim();
      var semester = els.semester.value;

      if (fullName.length < 2) {
        RB.showFieldErrors(form, { fullName: 'Enter your full name.' });
        return;
      }
      if (department.length < 2) {
        RB.showFieldErrors(form, { department: 'Enter your department.' });
        return;
      }

      RB.setBusy(button, true, 'Saving…');
      RB.api('api/auth/profile', {
        method: 'PATCH',
        json: { fullName: fullName, department: department, semester: semester },
      })
        .then(function (data) {
          var session = RB.session();
          RB.setSession({ user: data.user, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
          RB.renderAdminSidebar('profile');
          RB.renderAdminTopbar('Administrator profile', 'Account');
          RB.toast('Your profile has been updated.', 'success');
          render(data.user);
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error, form);
        });
    });
  }

  function bindPasswordForm() {
    var form = RB.$('#adminPasswordForm');
    var button = RB.$('#adminPasswordButton');
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      RB.clearFieldErrors(form);
      var els = form.elements;
      var currentPassword = els.currentPassword.value;
      var newPassword = els.newPassword.value;
      var confirmPassword = els.confirmPassword.value;

      if (!currentPassword) {
        RB.showFieldErrors(form, { currentPassword: 'Enter your current password.' });
        return;
      }
      if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
        RB.showFieldErrors(form, { newPassword: 'Use at least 8 characters with a letter and a number.' });
        return;
      }
      if (newPassword !== confirmPassword) {
        RB.showFieldErrors(form, { confirmPassword: 'New passwords do not match.' });
        return;
      }

      RB.setBusy(button, true, 'Updating…');
      RB.api('api/auth/change-password', {
        method: 'POST',
        json: { currentPassword: currentPassword, newPassword: newPassword, confirmPassword: confirmPassword },
      })
        .then(function () {
          RB.setBusy(button, false);
          form.reset();
          RB.toast('Password updated. Other sessions have been signed out.', 'success');
        })
        .catch(function (error) {
          RB.setBusy(button, false);
          RB.handleError(error, form);
        });
    });
  }
})();
