# User manual

The application has two roles. Students register themselves; administrators are created by the
operator with the CLI (never through the website).

- Public site: `/`
- Student login: `/auth/login/` · Registration: `/auth/register/`
- Administrator login: `/auth/admin/`

In production every path is prefixed with `/projects/online-examination-and-proctoring-system/`.
In local development the prefix is empty (`http://localhost:8788/`).

## 1. Public home page

The home page explains the system without forcing a login:

- Hero section with a student login action.
- Thirteen general examination instructions, including a disclaimer that detected signals are not
  automatic proof of misconduct.
- A seven-step workflow from account creation to results.
- Eight feature cards, an about section and a footer.
- The footer year and contact details are rendered dynamically where applicable.

## 2. Student guide

### 2.1 Create an account

1. Open **Create Student Account**.
2. Enter your full name, student ID, email, department, semester, password and confirmation.
3. Choose a password of 8–128 characters containing at least one letter and one number.
4. Submit. You are signed in automatically after successful registration.

Student IDs and emails must be unique. Registration is rate limited to ten accounts per hour per
IP address.

### 2.2 Sign in

1. Open **Student Login**.
2. Enter either your email address or student ID, then your password.
3. Optionally select **Remember me** for a longer session (720 hours instead of 12).
4. Submit.

Wrong credentials show a generic error. Repeated failures are limited to 20 attempts per 10 minutes
per role and IP. An inactive account is blocked even with the correct password.

### 2.3 Dashboard

The dashboard shows:

- Counts of available, upcoming, ongoing and completed examinations, plus released results.
- Your examination list with state badges (`Available`, `Upcoming`, `Ongoing`, `Completed`,
  `Ended`, `Locked`) and actions.
- Links to **My examinations**, **History**, **Results** and **Profile**.

### 2.4 Start an examination

1. Open an available examination.
2. Read the description, duration, marks, schedule and instructions.
3. Read the monitoring statement and tick the consent checkbox.
4. Select **Start examination**. The browser may ask for camera permission.

If you previously started the same examination and time remains, the server resumes that attempt;
it does not create a second one. Only one attempt per student per examination is allowed.

### 2.5 During the attempt

- The timer is fixed by the server. Refreshing or closing the tab does not add time.
- Answers save automatically after each selection; a restore indicator confirms saved answers when
  you reload.
- Answer every question you can. Unanswered questions score zero.
- Keep the exam tab focused and stay in fullscreen if requested.
- Monitoring may record:
  - no face visible for a sustained period (medium),
  - more than one face (high),
  - camera disconnection (high),
  - tab switch or page hidden (medium),
  - window focus loss (low),
  - leaving fullscreen (medium).

Warnings are visible on screen. Repeated identical signals are throttled, and a maximum of 500
events are stored per attempt. No video or images are recorded or uploaded.

If the camera is unavailable, the page explains the fallback; the examination itself is not
blocked by camera denial, but the absence of face signals is visible to the administrator.

### 2.6 Submit

1. Select **Submit examination**.
2. Confirm the dialog.
3. The server evaluates the attempt from stored answers. Submitting twice is safe: the second
   request returns the existing result and no second result is created.
4. If you do not submit, the attempt is closed automatically shortly after the deadline. An
   8-second grace period covers a submission already in flight.

### 2.7 Results

Results are not visible immediately after submission. The administrator must release them for the
examination. Until then the Results page shows a pending count. After release you see obtained
marks, total marks, percentage, pass/fail and the evaluation time.

### 2.8 Profile and password

- **Profile** updates your name, department and semester; email and student ID are fixed.
- **Change password** requires the current password. A successful change signs out your other
  browsing sessions; the current session stays valid.
- **Log out** revokes the current session on the server.

## 3. Administrator guide

### 3.1 Sign in

Use the administrator email and password created with `scripts/create-admin.mjs`. There is no
administrator sign-up page. Students cannot use the administrator login and vice versa.

### 3.2 Dashboard

Live D1 statistics: total students, examinations, active/closed exams, attempts, proctoring events,
unreviewed events and pass/fail counts. Chart.js panels show attempts by exam, proctoring events by
type and the results distribution; recent proctoring events link to the review screen.

### 3.3 Student management

- Search by name, email or student ID; filter by status and department.
- Open a student to see profile details, attempts and results.
- **Deactivate** immediately blocks login and deletes active sessions.
- **Reactivate** restores access; the student can sign in again.

### 3.4 Examination management

Create an examination with title, subject, description, duration, passing marks, start/end time,
instructions and status.

Lifecycle:

1. **Draft** — not visible to students. Add questions here.
2. **Published** — visible in student lists, but not yet startable. Requires at least one question.
3. **Active** — students can start inside the schedule window.
4. **Closed** — no new attempts.

Safety rules:

- Total marks are recalculated from questions.
- Passing marks cannot exceed total marks; publishing validates this.
- The schedule must end after it starts.
- Questions can be edited or deleted only before the first attempt exists.
- An examination with attempts cannot be deleted; close it instead.
- **Release results** makes marks visible to students. Hiding results again removes them from the
  student view.

Use the exam detail page to review attempts, scores and question lock state.

### 3.5 Question bank

- Add multiple-choice questions with exactly four options and exactly one correct answer.
- Set marks and question order; reorder questions from the exam detail page.
- The question bank lists questions across examinations with their parent exam.

### 3.6 Results

The results page lists attempts, obtained/total marks, percentage, pass/fail and release state. Use
the examination release action to publish or hide student results.

### 3.7 Proctoring reports

- Filter by examination, review status, severity and free text.
- Open an event to read its description, student, exam and timestamp.
- Mark an event **reviewed** or **dismissed**, or return it to **unreviewed**.
- Treat events as signals for human review. A single low-severity event is not proof of misconduct;
  context, repeated patterns and severity matter.

### 3.8 Administrator profile

Update your name and department, change your password, or sign out. Administrators have no student
ID, and email addresses are fixed after creation.

## 4. Privacy and fairness

- Consent is recorded before an attempt starts.
- The camera preview stays in the browser; only event metadata (type, severity, description, time)
  reaches the server.
- No recordings are stored by default.
- Face detection is a lightweight local model and can produce false positives or miss faces in poor
  lighting, glasses glare, face coverings or unusual camera angles.
- The system cannot reliably detect other operating-system applications, physical devices, screen
  sharing or assistance from another person. It must not be used as the sole basis for a
  disciplinary decision.

## 5. Common problems

| Problem | What to do |
| --- | --- |
| “Please sign in to continue” | The session expired or the cookie was cleared; sign in again |
| “Your security token has expired” | Reload the page so a fresh CSRF token is issued |
| “This examination is not currently open” | The administrator has not activated it or the window has not started |
| “The examination window has ended” | The server deadline has passed; contact the administrator |
| Camera prompt does not appear | Allow camera permission in the browser; close other apps using the camera |
| Face warnings despite being present | Improve lighting, centre your face and remove obstructions; false positives are possible |
| Results show as pending | The administrator has not released results for that exam |
| “Too many attempts” | Wait for the rate-limit window or contact the administrator |
