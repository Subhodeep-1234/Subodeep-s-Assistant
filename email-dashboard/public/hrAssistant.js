// HR Assistant (AI agent) - a self-contained addition to the existing
// Workforce Intelligence app. Talks to POST /api/workforce/hr-assistant/chat
// (src/aiAssistant/), renders whatever { reply, card, actions } comes back,
// and reuses this page's own setView()/VIEWS (defined in workforce.js,
// loaded just before this file) for any "open X view" action instead of
// duplicating navigation logic.
(function () {
  const btn = document.getElementById('hrAssistantBtn');
  const backdrop = document.getElementById('hrAssistantBackdrop');
  const panel = document.getElementById('hrAssistantPanel');
  const closeBtn = document.getElementById('hrAssistantCloseBtn');
  const messagesEl = document.getElementById('hrAssistantMessages');
  const form = document.getElementById('hrAssistantForm');
  const input = document.getElementById('hrAssistantInput');
  if (!btn || !panel) return; // this page doesn't have the assistant markup

  const history = [];
  let opened = false;

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addBubble(role, text) {
    const row = document.createElement('div');
    row.className = 'wf-ai-msg ' + role;
    const bubble = document.createElement('div');
    bubble.className = 'wf-ai-bubble';
    bubble.textContent = text;
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    scrollToBottom();
    return row;
  }

  function addCard(card) {
    const wrap = document.createElement('div');
    wrap.className = 'wf-ai-card';
    const title = document.createElement('div');
    title.className = 'wf-ai-card-title';
    title.textContent = card.title;
    wrap.appendChild(title);
    (card.rows || []).forEach((r) => {
      const row = document.createElement('div');
      row.className = 'wf-ai-card-row';
      const label = document.createElement('span');
      label.className = 'label';
      label.textContent = r.label;
      const value = document.createElement('span');
      value.className = 'value';
      value.textContent = r.value === '' || r.value === null || r.value === undefined ? '' : String(r.value);
      row.appendChild(label);
      row.appendChild(value);
      wrap.appendChild(row);
    });
    if (card.footer) {
      const footer = document.createElement('div');
      footer.className = 'wf-ai-card-footer';
      footer.innerHTML = '<span>' + escapeHtml(card.footer.label) + '</span><span>' + escapeHtml(String(card.footer.value)) + '</span>';
      wrap.appendChild(footer);
    }
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function addActions(actions) {
    const wrap = document.createElement('div');
    wrap.className = 'wf-ai-actions';
    actions.forEach((a) => {
      const b = document.createElement('button');
      b.className = 'wf-ai-action-btn';
      b.type = 'button';
      b.textContent = a.label;
      b.addEventListener('click', () => {
        if (a.downloadUrl) {
          window.open(a.downloadUrl, '_blank');
          return;
        }
        closePanel();
        if (a.view && typeof setView === 'function') {
          setView(a.view, { resetHistory: true });
          if (a.view === 'letterGenerator' && a.employeeId) {
            // Best-effort prefill - the Letter Generator's own view-reset
            // (setView) already ran, so this fills the search box right
            // after it settles rather than fighting that reset.
            setTimeout(() => {
              const search = document.getElementById('letterGenEmployeeSearch');
              const idField = document.getElementById('letterGenEmployeeId');
              if (search && idField) {
                search.value = a.employeeId;
                idField.value = a.employeeId;
              }
            }, 50);
          }
        }
      });
      wrap.appendChild(b);
    });
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function openPanel() {
    backdrop.hidden = false;
    panel.hidden = false;
    if (!opened) {
      opened = true;
      const name = (document.getElementById('drawerName') && document.getElementById('drawerName').textContent.trim()) || '';
      const greetName = name && name !== '—' ? name.split(' ')[0] : 'there';
      addBubble('assistant',
        'Hello ' + greetName + '! 👋\n\n' +
        "I'm your HR Assistant.\n\n" +
        'I can help you with HR reports, employee data, workforce movement, organization chart, health insurance, interview panel, and other HR tasks.'
      );
    }
    setTimeout(() => input.focus(), 50);
  }

  function closePanel() {
    backdrop.hidden = true;
    panel.hidden = true;
  }

  btn.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  backdrop.addEventListener('click', closePanel);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.disabled = true;
    const sendBtn = form.querySelector('.wf-ai-send-btn');
    if (sendBtn) sendBtn.disabled = true;

    addBubble('user', text);
    history.push({ role: 'user', text });
    const loadingRow = addBubble('assistant', 'AI is thinking…');
    loadingRow.classList.add('loading');

    try {
      const resp = await fetch('/api/workforce/hr-assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: history.slice(-10) })
      });
      loadingRow.remove();
      if (!resp.ok) {
        addBubble('assistant', 'Unable to retrieve the requested information. Please try again.');
        return;
      }
      const data = await resp.json();
      addBubble('assistant', data.reply || 'Done.');
      history.push({ role: 'assistant', text: data.reply || '' });
      if (data.card) addCard(data.card);
      if (data.actions && data.actions.length) addActions(data.actions);
    } catch (err) {
      loadingRow.remove();
      addBubble('assistant', 'Something went wrong. Please try again.');
    } finally {
      input.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      input.focus();
    }
  });
})();
