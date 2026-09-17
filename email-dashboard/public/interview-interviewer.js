(function () {
  var token = window.location.pathname.split('/').filter(Boolean).pop();
  var loadingEl = document.getElementById('ivLoading');
  var panelEl = document.getElementById('ivPanel');
  var stateAlready = document.getElementById('ivStateAlready');
  var stateDone = document.getElementById('ivStateDone');
  var stateWait = document.getElementById('ivStateWait');
  var stateError = document.getElementById('ivStateError');
  var stateErrorMsg = document.getElementById('ivStateErrorMsg');
  var form = document.getElementById('ivForm');
  var submitBtn = document.getElementById('ivSubmitBtn');
  var errorBox = document.getElementById('ivError');
  var candidateBox = document.getElementById('ivCandidateBox');
  var gradeFieldsEl = document.getElementById('ivGradeFields');
  var panelistRowsEl = document.getElementById('ivPanelistRows');
  var addPanelistBtn = document.getElementById('ivAddPanelist');

  var COMPETENCIES = [
    { key: 'gradeIntelligence', label: 'Intelligence' },
    { key: 'gradeAttitude', label: 'Attitude' },
    { key: 'gradePersonality', label: 'Personality' },
    { key: 'gradeConfidence', label: 'Confidence' },
    { key: 'gradeCommunicationSkills', label: 'Communication Skills' },
    { key: 'gradeAcademicPerformance', label: 'Academic Performance' },
    { key: 'gradeJobKnowledge', label: 'Job Knowledge' },
    { key: 'gradeJobSuitability', label: 'Job Suitability' }
  ];
  var GRADES = ['A', 'B+', 'B', 'C', 'D'];

  var CANDIDATE_LABELS = [
    ['name', 'Name'], ['positionAppliedFor', 'Position Applied For'],
    ['contactNo', 'Contact No'], ['email', 'Email'],
    ['qualification', 'Qualification'], ['experience', 'Experience'],
    ['currentPosition', 'Current Position'], ['interviewDate', 'Interview Date'],
    ['interviewPlace', 'Interview Place'], ['interviewMode', 'Interview Mode'],
    ['referenceName', 'Reference Name'], ['presentLastCompany', 'Present/Last Company'],
    ['designation', 'Designation'], ['currentLastSalaryDrawn', 'Current/Last Salary'],
    ['expectedSalary', 'Expected Salary'], ['noticePeriod', 'Notice Period']
  ];

  function showOnly(el) {
    [loadingEl, panelEl, stateAlready, stateDone, stateWait, stateError].forEach(function (e) {
      e.hidden = e !== el;
    });
  }

  function showError(msg) {
    stateErrorMsg.textContent = msg || 'This link is invalid or has expired.';
    showOnly(stateError);
  }

  function buildGradeRow(key, label) {
    var wrap = document.createElement('div');
    wrap.className = 'iv-field';
    var labelEl = document.createElement('label');
    labelEl.textContent = label;
    var req = document.createElement('span');
    req.className = 'iv-required';
    req.textContent = '*';
    labelEl.appendChild(req);
    wrap.appendChild(labelEl);
    var grid = document.createElement('div');
    grid.className = 'iv-grade-grid';
    grid.setAttribute('data-grade-field', key);
    GRADES.forEach(function (g) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'iv-grade-btn';
      btn.setAttribute('data-value', g);
      btn.textContent = g;
      grid.appendChild(btn);
    });
    wrap.appendChild(grid);
    return wrap;
  }

  COMPETENCIES.forEach(function (c) {
    gradeFieldsEl.appendChild(buildGradeRow(c.key, c.label));
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.iv-grade-btn');
    if (!btn) return;
    var grid = btn.closest('.iv-grade-grid');
    Array.prototype.forEach.call(grid.querySelectorAll('.iv-grade-btn'), function (b) {
      b.classList.toggle('active', b === btn);
    });
  });

  function addPanelistRow(prefill) {
    var row = document.createElement('div');
    row.className = 'iv-panelist-row';
    row.innerHTML =
      '<input type="text" placeholder="Name" data-panel="name" />' +
      '<input type="text" placeholder="Designation" data-panel="designation" />' +
      '<input type="text" placeholder="Department" data-panel="department" />' +
      '<button type="button" class="iv-panelist-remove" aria-label="Remove">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>';
    if (prefill) {
      row.querySelector('[data-panel="name"]').value = prefill.name || '';
      row.querySelector('[data-panel="designation"]').value = prefill.designation || '';
      row.querySelector('[data-panel="department"]').value = prefill.department || '';
    }
    row.querySelector('.iv-panelist-remove').addEventListener('click', function () {
      row.remove();
    });
    panelistRowsEl.appendChild(row);
  }

  addPanelistBtn.addEventListener('click', function () { addPanelistRow(); });

  fetch('/api/interview/interviewer/' + encodeURIComponent(token))
    .then(function (r) { return r.json().then(function (data) { return { status: r.status, data: data }; }); })
    .then(function (res) {
      if (res.status === 404 || !res.data.ok) {
        showError(res.data && res.data.error);
        return;
      }
      if (res.data.alreadySubmitted) {
        showOnly(stateAlready);
        return;
      }
      if (res.data.candidateNotReady) {
        showOnly(stateWait);
        return;
      }
      var c = res.data.candidate || {};
      CANDIDATE_LABELS.forEach(function (pair) {
        var key = pair[0], label = pair[1];
        if (!c[key]) return;
        var row = document.createElement('div');
        row.className = 'iv-readonly-row';
        row.innerHTML = '<span></span><span></span>';
        row.children[0].textContent = label;
        row.children[1].textContent = c[key];
        candidateBox.appendChild(row);
      });
      addPanelistRow();
      showOnly(panelEl);
    })
    .catch(function () { showError('Something went wrong loading this form. Please try again.'); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.hidden = true;

    var payload = {};
    var missingGrade = false;
    COMPETENCIES.concat([{ key: 'overallGrade' }]).forEach(function (c) {
      var grid = form.querySelector('[data-grade-field="' + c.key + '"]');
      var active = grid.querySelector('.iv-grade-btn.active');
      if (!active) { missingGrade = true; return; }
      payload[c.key] = active.getAttribute('data-value');
    });
    if (missingGrade) {
      errorBox.textContent = 'Please select a grade for every evaluation criterion, including Overall Grade.';
      errorBox.hidden = false;
      return;
    }

    payload.interviewStatus = document.getElementById('f_interviewStatus').value;
    payload.newRejoinedReplacement = document.getElementById('f_newRejoinedReplacement').value;
    payload.interviewerComments = document.getElementById('f_interviewerComments').value;
    payload.additionalNote = document.getElementById('f_additionalNote').value;
    payload.interviewerSignatureName = document.getElementById('f_interviewerSignatureName').value;
    payload.hrSignatureName = document.getElementById('f_hrSignatureName').value;

    if (!payload.interviewStatus || !payload.interviewerSignatureName) {
      errorBox.textContent = 'Please fill in all required fields.';
      errorBox.hidden = false;
      return;
    }

    payload.panelList = Array.prototype.map.call(panelistRowsEl.children, function (row) {
      return {
        name: row.querySelector('[data-panel="name"]').value,
        designation: row.querySelector('[data-panel="designation"]').value,
        department: row.querySelector('[data-panel="department"]').value
      };
    }).filter(function (p) { return p.name || p.designation || p.department; });

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    fetch('/api/interview/interviewer/' + encodeURIComponent(token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json().then(function (data) { return { status: r.status, data: data }; }); })
      .then(function (res) {
        if (!res.data.ok) {
          errorBox.textContent = res.data.error || 'Could not submit the form. Please try again.';
          errorBox.hidden = false;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Evaluation';
          return;
        }
        showOnly(stateDone);
      })
      .catch(function () {
        errorBox.textContent = 'Something went wrong. Please check your connection and try again.';
        errorBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Evaluation';
      });
  });
})();
