// HR Assistant (AI agent) - a self-contained addition to the existing
// Workforce Intelligence app. Talks to POST /api/workforce/hr-assistant/chat
// (src/aiAssistant/), renders whatever { reply, card, actions } comes back,
// and reuses this page's own setView()/VIEWS (defined in workforce.js,
// loaded just before this file) for any "open X view" action instead of
// duplicating navigation logic.
(function () {
  const btn = document.getElementById('hrAssistantBtn');
  const panel = document.getElementById('hrAssistantPanel');
  const closeBtn = document.getElementById('hrAssistantCloseBtn');
  const messagesEl = document.getElementById('hrAssistantMessages');
  const form = document.getElementById('hrAssistantForm');
  const input = document.getElementById('assistantQuestion');
  const topbar = document.querySelector('.wf-topbar');
  const plusBtn = document.getElementById('hrAssistantPlusBtn');
  const micBtn = document.getElementById('hrAssistantMicBtn');
  const attachmentChip = document.getElementById('hrAssistantAttachmentChip');
  const attachmentName = document.getElementById('hrAssistantAttachmentName');
  const attachmentRemoveBtn = document.getElementById('hrAssistantAttachmentRemove');
  const cameraInput = document.getElementById('hrAssistantCameraInput');
  const photoInput = document.getElementById('hrAssistantPhotoInput');
  const fileInput = document.getElementById('hrAssistantFileInput');
  const sheetBackdrop = document.getElementById('hrAssistantSheetBackdrop');
  const sheet = document.getElementById('hrAssistantSheet');
  const sheetHandle = document.getElementById('hrAssistantSheetHandle');
  const sheetCloseBtn = document.getElementById('hrAssistantSheetCloseBtn');
  const tileCamera = document.getElementById('hrAssistantTileCamera');
  const tilePhotos = document.getElementById('hrAssistantTilePhotos');
  const tileFiles = document.getElementById('hrAssistantTileFiles');
  if (!btn || !panel) return; // this page doesn't have the assistant markup

  const history = [];
  let opened = false;
  let pendingAttachment = null; // { name } - held only in the browser, see setAttachment()
  let savedScrollY = 0;

  // The panel covers everything below the app header while open, so the
  // page content behind/under it shouldn't scroll - not even via an edge
  // swipe/overscroll bounce. overflow on <body> alone doesn't reliably
  // stop the page from scrolling (the document's actual scrolling box can
  // be <html> instead depending on the browser), so both get locked; the
  // scroll position is saved/restored too as a defensive backstop.
  function lockBodyScroll() {
    savedScrollY = window.scrollY;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  function unlockBodyScroll() {
    document.documentElement.style.overflow = '';
    document.body.style.overflow = '';
    window.scrollTo(0, savedScrollY);
  }

  // The panel opens BELOW the app's own header - like Tenure or any other
  // section - down to the bottom of whatever is actually visible, which
  // with an on-screen keyboard open is well above window.innerHeight. vh
  // units and window.innerHeight both describe the full layout viewport
  // (the part still behind the keyboard on iOS Safari), so the only way
  // to track the real visible area on both iOS Safari and Android Chrome
  // is window.visualViewport, kept in sync on every resize/scroll it
  // fires (keyboard show/hide, orientation change, browser chrome
  // show/hide).
  function syncPanelToViewport() {
    if (panel.hidden) return;
    const headerBottom = topbar ? topbar.getBoundingClientRect().bottom : 0;
    const vv = window.visualViewport;
    const visibleTop = vv ? vv.offsetTop : 0;
    const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
    const top = Math.max(headerBottom, visibleTop);
    panel.style.top = top + 'px';
    panel.style.bottom = Math.max(0, window.innerHeight - visibleBottom) + 'px';
    scrollToBottom();
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addBubble(role, text, attachment) {
    const row = document.createElement('div');
    row.className = 'wf-ai-msg ' + role;
    const col = document.createElement('div');
    col.className = 'wf-ai-msg-col';
    if (attachment) {
      const chip = document.createElement('div');
      chip.className = 'wf-ai-msg-attachment';
      chip.textContent = '📎 ' + attachment.name;
      col.appendChild(chip);
    }
    const bubble = document.createElement('div');
    bubble.className = 'wf-ai-bubble';
    bubble.textContent = text;
    col.appendChild(bubble);
    row.appendChild(col);
    messagesEl.appendChild(row);
    scrollToBottom();
    return row;
  }

  // One-time welcome block (first thing shown in an empty conversation) -
  // not a chat bubble, just the first child of the messages list, so it
  // scrolls away with everything else once real messages start stacking
  // below it. `name` is the signed-in user's own first name (read from the
  // profile-driven #drawerName element in openPanel, never hard-coded);
  // an empty string falls back to the name-less greeting.
  function addWelcome(name) {
    const wrap = document.createElement('div');
    wrap.className = 'wf-ai-welcome';

    const badge = document.createElement('div');
    badge.className = 'wf-ai-welcome-badge';
    badge.innerHTML =
      '<svg class="wf-ai-welcome-robot" viewBox="0 0 64 64" width="72" height="72" fill="none">' +
        '<circle cx="15" cy="35" r="5.5" fill="currentColor"/>' +
        '<circle cx="49" cy="35" r="5.5" fill="currentColor"/>' +
        '<rect x="14" y="16" width="36" height="34" rx="12" fill="#fff" stroke="currentColor" stroke-width="2.5"/>' +
        '<line x1="32" y1="16" x2="32" y2="9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
        '<circle cx="32" cy="6.5" r="3" fill="currentColor"/>' +
        '<rect x="20" y="27" width="24" height="12" rx="6" fill="currentColor"/>' +
        '<circle cx="26.5" cy="33" r="2.4" fill="#fff"/>' +
        '<circle cx="37.5" cy="33" r="2.4" fill="#fff"/>' +
        '<path d="M25 43q7 5 14 0" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>' +
      '</svg>' +
      '<svg class="wf-ai-welcome-sparkle" viewBox="0 0 24 24" width="22" height="22" fill="none">' +
        '<path d="M13 2l1.8 5.2L20 9l-5.2 1.8L13 16l-1.8-5.2L6 9l5.2-1.8z" fill="currentColor"/>' +
        '<path d="M20 14l0.9 2.1L23 17l-2.1 0.9L20 20l-0.9-2.1L17 17l2.1-0.9z" fill="currentColor"/>' +
      '</svg>';

    const card = document.createElement('div');
    card.className = 'wf-ai-welcome-card';
    const greeting = document.createElement('p');
    greeting.className = 'wf-ai-welcome-greeting';
    greeting.textContent = name
      ? '👋 Hello ' + name + "! I'm your HR Assistant."
      : "👋 Hello! I'm your HR Assistant.";
    const sub = document.createElement('p');
    sub.className = 'wf-ai-welcome-sub';
    sub.textContent = 'How can I help you today?';
    card.appendChild(greeting);
    card.appendChild(sub);

    wrap.appendChild(badge);
    wrap.appendChild(card);
    messagesEl.appendChild(wrap);
    scrollToBottom();
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

  // Attachments are held only in the browser (as a File object) and never
  // uploaded anywhere - there's no backend endpoint to receive them and the
  // mock/Claude providers have no file-handling capability yet. Picking one
  // just shows a chip above the input row, and once the next message is
  // sent, the same chip moves into that message's bubble as a purely visual
  // record of what was attached; the file's bytes are never sent to
  // /api/workforce/hr-assistant/chat or stored anywhere else.
  function setAttachment(file) {
    if (!file) return;
    pendingAttachment = file;
    attachmentName.textContent = file.name;
    attachmentChip.hidden = false;
  }

  function clearAttachment() {
    pendingAttachment = null;
    attachmentChip.hidden = true;
    cameraInput.value = '';
    photoInput.value = '';
    fileInput.value = '';
  }

  attachmentRemoveBtn.addEventListener('click', clearAttachment);
  cameraInput.addEventListener('change', () => setAttachment(cameraInput.files[0]));
  photoInput.addEventListener('change', () => setAttachment(photoInput.files[0]));
  fileInput.addEventListener('change', () => setAttachment(fileInput.files[0]));

  // "Add to chat" bottom sheet - kept in the DOM with `hidden` toggled and
  // an `.open` class doing the actual slide animation, so the very first
  // open still transitions in (rather than jumping) and it's fully out of
  // the layout/interaction tree while closed.
  function openSheet() {
    sheetBackdrop.hidden = false;
    sheet.hidden = false;
    void sheet.offsetHeight; // force reflow so the transform transition runs
    sheetBackdrop.classList.add('open');
    sheet.classList.add('open');
  }

  function closeSheet() {
    sheetBackdrop.classList.remove('open');
    sheet.classList.remove('open');
    sheet.style.transform = '';
    const finish = () => {
      sheet.hidden = true;
      sheetBackdrop.hidden = true;
      sheet.removeEventListener('transitionend', finish);
    };
    sheet.addEventListener('transitionend', finish);
    setTimeout(finish, 300); // fallback if transitionend doesn't fire (reduced motion, etc.)
  }

  plusBtn.addEventListener('click', openSheet);
  sheetCloseBtn.addEventListener('click', closeSheet);
  sheetBackdrop.addEventListener('click', closeSheet);

  tileCamera.addEventListener('click', () => { closeSheet(); cameraInput.click(); });
  tilePhotos.addEventListener('click', () => { closeSheet(); photoInput.click(); });
  tileFiles.addEventListener('click', () => { closeSheet(); fileInput.click(); });

  // Swipe-down-to-dismiss, dragging from the handle.
  let dragStartY = null;
  let dragDelta = 0;
  function onDragStart(e) {
    dragStartY = e.touches ? e.touches[0].clientY : e.clientY;
    dragDelta = 0;
    sheet.classList.add('dragging');
  }
  function onDragMove(e) {
    if (dragStartY === null) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    dragDelta = Math.max(0, y - dragStartY);
    sheet.style.transform = 'translateY(' + dragDelta + 'px)';
  }
  function onDragEnd() {
    if (dragStartY === null) return;
    sheet.classList.remove('dragging');
    if (dragDelta > 90) {
      closeSheet();
    } else {
      sheet.style.transform = '';
    }
    dragStartY = null;
    dragDelta = 0;
  }
  sheetHandle.addEventListener('touchstart', onDragStart, { passive: true });
  sheetHandle.addEventListener('touchmove', onDragMove, { passive: true });
  sheetHandle.addEventListener('touchend', onDragEnd);

  // Voice input - Web Speech API. Feature-detected at load with no
  // permission prompt (the mic permission dialog only appears once
  // recognition.start() is actually called, i.e. on first tap); hidden
  // entirely on browsers that don't support it rather than showing a
  // control that would just fail.
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let recognizing = false;

  if (!SpeechRecognitionCtor) {
    micBtn.hidden = true;
  } else {
    micBtn.addEventListener('click', () => {
      if (recognizing) {
        if (recognition) recognition.stop();
        return;
      }
      recognition = new SpeechRecognitionCtor();
      recognition.lang = navigator.language || 'en-US';
      recognition.continuous = false;
      recognition.interimResults = true;
      let finalTranscript = '';
      recognition.onstart = () => {
        recognizing = true;
        micBtn.classList.add('recording');
      };
      recognition.onresult = (event) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) finalTranscript += transcript;
          else interim += transcript;
        }
        input.value = (finalTranscript + interim).trim();
      };
      recognition.onerror = () => {
        recognizing = false;
        micBtn.classList.remove('recording');
      };
      recognition.onend = () => {
        recognizing = false;
        micBtn.classList.remove('recording');
        recognition = null;
      };
      try {
        recognition.start();
      } catch (err) {
        recognizing = false;
        micBtn.classList.remove('recording');
      }
    });
  }

  function openPanel() {
    panel.hidden = false;
    lockBodyScroll();
    syncPanelToViewport();
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncPanelToViewport);
      window.visualViewport.addEventListener('scroll', syncPanelToViewport);
    }
    window.addEventListener('orientationchange', syncPanelToViewport);
    if (!opened) {
      opened = true;
      const name = (document.getElementById('drawerName') && document.getElementById('drawerName').textContent.trim()) || '';
      const greetName = name && name !== '—' ? name.split(' ')[0] : '';
      addWelcome(greetName);
    }
    // Deliberately no auto-focus here - the keyboard should only open when
    // the person actually taps the input, not the moment the panel opens.
  }

  function closePanel() {
    panel.hidden = true;
    unlockBodyScroll();
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', syncPanelToViewport);
      window.visualViewport.removeEventListener('scroll', syncPanelToViewport);
    }
    window.removeEventListener('orientationchange', syncPanelToViewport);
  }

  btn.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  // Re-sync right on focus/blur too, in addition to the visualViewport
  // listeners above - covers the moment the keyboard is animating in/out
  // before the viewport has finished settling, so the input bar doesn't
  // visibly lag behind it.
  input.addEventListener('focus', () => setTimeout(syncPanelToViewport, 50));
  input.addEventListener('blur', () => setTimeout(syncPanelToViewport, 50));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    const attachment = pendingAttachment;
    if (!text && !attachment) return;
    input.value = '';
    input.disabled = true;
    const sendBtn = form.querySelector('.wf-ai-send-btn');
    if (sendBtn) sendBtn.disabled = true;
    clearAttachment();

    addBubble('user', text || ('Shared a file: ' + attachment.name), attachment);

    // Attachments aren't wired to anything yet - neither provider can see or
    // analyze the file (see setAttachment above, it never leaves the
    // browser), so this says so explicitly rather than silently answering
    // only the typed text and leaving the person to guess whether the file
    // was used.
    if (attachment) {
      addBubble('assistant', "I can't analyze attachments yet - that'll work once the AI provider is connected. " + (text ? "I'll answer your question below, but I haven't looked at " + attachment.name + '.' : "I haven't looked at " + attachment.name + '.'));
    }

    if (!text) {
      input.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      input.focus();
      return;
    }

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
