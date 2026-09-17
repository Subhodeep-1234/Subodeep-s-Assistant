(function () {
  var token = window.location.pathname.split('/').filter(Boolean).pop();
  var loadingEl = document.getElementById('ivLoading');
  var panelEl = document.getElementById('ivPanel');
  var stateAlready = document.getElementById('ivStateAlready');
  var stateDone = document.getElementById('ivStateDone');
  var stateError = document.getElementById('ivStateError');
  var stateErrorMsg = document.getElementById('ivStateErrorMsg');
  var form = document.getElementById('ivForm');
  var submitBtn = document.getElementById('ivSubmitBtn');
  var errorBox = document.getElementById('ivError');
  var workedSelect = document.getElementById('f_workedOnAlcoveProjects');
  var alcoveDetailsWrap = document.getElementById('f_alcoveProjectsDetailsWrap');

  function showOnly(el) {
    [loadingEl, panelEl, stateAlready, stateDone, stateError].forEach(function (e) {
      e.hidden = e !== el;
    });
  }

  workedSelect.addEventListener('change', function () {
    alcoveDetailsWrap.hidden = workedSelect.value !== 'Yes';
  });

  function showError(msg) {
    stateErrorMsg.textContent = msg || 'This link is invalid or has expired.';
    showOnly(stateError);
  }

  fetch('/api/interview/candidate/' + encodeURIComponent(token))
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
      showOnly(panelEl);
    })
    .catch(function () { showError('Something went wrong loading this form. Please try again.'); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorBox.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';

    var fd = new FormData(form);
    var payload = {};
    fd.forEach(function (value, key) { payload[key] = value; });

    fetch('/api/interview/candidate/' + encodeURIComponent(token), {
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
          submitBtn.textContent = 'Submit Application';
          return;
        }
        showOnly(stateDone);
      })
      .catch(function () {
        errorBox.textContent = 'Something went wrong. Please check your connection and try again.';
        errorBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Application';
      });
  });
})();
