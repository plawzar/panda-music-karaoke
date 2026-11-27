'use strict';

const toolTabs = [...document.querySelectorAll('.studio-tabs [role="tab"]')];
const reviewForm = byId('review-form');
const geniusForm = byId('genius-form');
const reviewFile = byId('review-file');
const reviewSoundToggle = byId('review-sound-toggle');
const geniusResult = byId('genius-result');
const copyGenius = byId('copy-genius');
const reviewResults = byId('review-results');
let reviewing = false;
const reviewSubmit = reviewForm.querySelector('button[type="submit"]');

const reviewSoundKey = 'panda-review-sound';
let reviewSoundEnabled = localStorage.getItem(reviewSoundKey) !== 'off';
let reviewAudioContext;
let reviewSoundBuffer;
let activeReviewCue;

function updateReviewSoundToggle() {
  reviewSoundToggle.setAttribute('aria-pressed', String(reviewSoundEnabled));
  reviewSoundToggle.title = reviewSoundEnabled ? 'Выключить звук проверки' : 'Включить звук проверки';
  reviewSoundToggle.querySelector('use').setAttribute('href', reviewSoundEnabled ? '#icon-volume-2' : '#icon-volume-x');
}

function stopReviewSound() {
  const source = activeReviewCue?.source;
  activeReviewCue = null;
  if (!source) return;
  source.onended = null;
  source.disconnect();
  source.stop();
}

async function prepareReviewSound() {
  try {
    if (!window.AudioContext) return null;
    if (!reviewAudioContext) {
      reviewAudioContext = new AudioContext();
      reviewSoundBuffer = fetch('/static/review-start.mp3').then(async (response) => {
        if (!response.ok) return null;
        return reviewAudioContext.decodeAudioData(await response.arrayBuffer());
      }).catch(() => null);
    }
    if (reviewAudioContext.state !== 'running') await reviewAudioContext.resume();
    return reviewSoundBuffer;
  } catch {
    return null;
  }
}

async function playReviewSound(cue) {
  try {
    const buffer = await prepareReviewSound();
    if (activeReviewCue !== cue || !buffer || reviewAudioContext.state !== 'running') return;
    const source = reviewAudioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(reviewAudioContext.destination);
    source.onended = () => {
      source.disconnect();
      if (activeReviewCue === cue) activeReviewCue = null;
    };
    if (!player.paused) player.pause();
    source.start();
    cue.source = source;
  } catch {
    // Audio is optional, so an unavailable device or decoder cannot fail a review.
  }
}

updateReviewSoundToggle();
reviewSoundToggle.addEventListener('click', () => {
  reviewSoundEnabled = !reviewSoundEnabled;
  if (!reviewSoundEnabled) stopReviewSound();
  else prepareReviewSound();
  localStorage.setItem(reviewSoundKey, reviewSoundEnabled ? 'on' : 'off');
  updateReviewSoundToggle();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopReviewSound();
});
window.addEventListener('pagehide', stopReviewSound);

function updateReviewInput() {
  const hasText = Boolean(reviewForm.elements.text.value.trim());
  byId('review-name').hidden = !hasText;
  reviewSubmit.disabled = reviewing || !hasText;
}

reviewForm.elements.text.addEventListener('input', updateReviewInput);

for (const field of document.querySelectorAll('.text-source-field')) {
  const input = field.querySelector('input[type="file"]');
  const text = field.querySelector('textarea');
  const filename = field.querySelector('[data-source-filename]');
  const clear = field.querySelector('[data-source-clear]');
  filename.setAttribute('aria-live', 'polite');

  function showAttachments() {
    filename.textContent = input.files[0]?.name || '';
    filename.title = filename.textContent;
    filename.removeAttribute('data-invalid');
    if (clear) clear.hidden = !input.files.length;
  }

  input.addEventListener('change', () => {
    if (input.files.length) text.value = '';
    showAttachments();
  });
  text.addEventListener('input', () => {
    if (text.value.trim() && input.files.length) {
      input.value = '';
      input.dispatchEvent(new Event('change'));
    }
    showAttachments();
  });
  clear?.addEventListener('click', () => {
    if (input.disabled) return;
    input.value = '';
    input.dispatchEvent(new Event('change'));
    text.focus();
  });
  if (input === lyricsFile) continue; // The sync screen accepts an audio and lyrics pair anywhere.

  const dropArea = field.closest('.text-tool');
  dropArea.addEventListener('dragover', (event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = input.disabled ? 'none' : 'copy';
    field.classList.toggle('is-dragging', !input.disabled);
  });
  dropArea.addEventListener('dragleave', (event) => {
    if (!dropArea.contains(event.relatedTarget)) field.classList.remove('is-dragging');
  });
  dropArea.addEventListener('drop', (event) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    field.classList.remove('is-dragging');
    if (input.disabled) return;
    const files = event.dataTransfer.files;
    if (files.length !== 1 || !/\.(docx|txt)$/i.test(files[0].name)) {
      filename.textContent = 'Добавь один файл DOCX или TXT.';
      filename.title = '';
      filename.setAttribute('data-invalid', '');
      return;
    }
    input.files = files;
    input.dispatchEvent(new Event('change'));
  });
}

function openStudioTool(tab) {
  studio.dataset.tool = tab.dataset.tool;
  reviewSoundToggle.hidden = tab.dataset.tool !== 'review';
  if (reviewSoundToggle.hidden) stopReviewSound();
  else if (reviewSoundEnabled) prepareReviewSound();
  for (const button of toolTabs) {
    const selected = button === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    byId(button.getAttribute('aria-controls')).hidden = !selected;
  }
  document.documentElement.classList.remove('file-drag-active');
  for (const field of document.querySelectorAll('.text-source-field.is-dragging')) field.classList.remove('is-dragging');
  for (const button of document.querySelectorAll('[data-use-track]')) button.disabled = !currentStudioText();
}

for (const [index, tab] of toolTabs.entries()) {
  tab.addEventListener('click', () => openStudioTool(tab));
  tab.addEventListener('keydown', (event) => {
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return;
    event.preventDefault();
    const step = key === 'ArrowLeft' ? -1 : 1;
    const next = key === 'Home' ? 0 : key === 'End' ? toolTabs.length - 1
      : (index + step + toolTabs.length) % toolTabs.length;
    openStudioTool(toolTabs[next]);
    toolTabs[next].focus();
  });
}

for (const button of document.querySelectorAll('[data-use-track]')) {
  button.addEventListener('click', () => {
    const track = currentStudioText();
    if (!track) return;
    const form = button.form;
    if (form === reviewForm) {
      form.elements.name.value = track.name;
    }
    form.elements.text.value = track.text;
    form.elements.text.dispatchEvent(new Event('input'));
    form.elements.text.focus();
  });
}

async function requestLyricsTool(tool, body, signal) {
  const response = await fetch('/api/lyrics-tools/' + tool, { method: 'POST', body, signal });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Не удалось обработать текст.');
  }
  return response.json();
}

function makeLyricDocx(data) {
  const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

function showReviewTrack(result) {
  const card = document.createElement('article');
  const title = document.createElement('h3');
  title.textContent = result.name;
  const previewControls = document.createElement('div');
  previewControls.className = 'review-preview-controls';
  previewControls.setAttribute('role', 'group');
  previewControls.setAttribute('aria-label', 'Версии документа');
  const preview = document.createElement('div');
  preview.className = 'review-preview';
  preview.tabIndex = 0;
  preview.setAttribute('role', 'region');
  preview.dataset.selectableText = '';
  preview.setAttribute('aria-keyshortcuts', 'Control+A Meta+A');
  const previews = [];
  const links = result.documents.map((file, index) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(makeLyricDocx(file.data));
    const label = index === 0 ? 'Для площадок вне СНГ (Оригинал)' : 'Для площадок СНГ (Clean)';
    link.download = result.name + ' — ' + label + '.docx';
    link.className = 'review-download';
    link.title = 'Скачать DOCX';
    link.setAttribute('aria-label', 'Скачать ' + label);
    link.append(studioIcon('download'));
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = index === 0 ? 'Оригинал · вне СНГ' : 'Clean · СНГ';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => {
      showPreview(index);
      preview.focus({ preventScroll: true });
    });
    previews.push(button);
    const version = document.createElement('div');
    version.className = 'review-version';
    version.append(button, link);
    previewControls.append(version);
    return link;
  });
  function showPreview(index) {
    previews.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    preview.setAttribute('aria-label', links[index].download);
    preview.replaceChildren(...(result.documents[index].lines || []).map((line) => {
      const row = document.createElement('div');
      for (const [text, flagged] of line) {
        if (flagged) {
          const span = document.createElement('mark');
          if (flagged === 'yellow') span.className = 'review-highlight-yellow';
          span.textContent = text;
          row.append(span);
        } else row.append(text);
      }
      return row;
    }));
    preview.scrollTop = 0;
  }
  if (previews.length) showPreview(0);
  card.append(title, previewControls, preview);
  const labels = {
    red: 'Красным — наркотический контекст, удалено из Clean',
    yellow: 'Жёлтым — проверь контекст, фрагменты сохранены в Clean',
  };
  for (const [color, label] of Object.entries(labels)) {
    const words = result.marked.filter(item => item.color === color);
    if (!words.length) continue;
    const marked = document.createElement('p');
    marked.textContent = label + ': ' + words.map(({ text, count }) => `«${text}»${count > 1 ? ` ×${count}` : ''}`).join(', ');
    card.append(marked);
  }
  if (!result.marked.length) {
    const message = document.createElement('p');
    message.textContent = 'Нет совпадений для автоматического выделения.';
    card.append(message);
  }
  if (result.suggestions?.length) {
    const suggestions = document.createElement('details');
    const heading = document.createElement('summary');
    heading.className = 'icon-summary';
    heading.append(studioIcon('chevron-down'), 'На ручную проверку (' + result.suggestions.length + ')');
    const list = document.createElement('ul');
    for (const { line, text, reason } of result.suggestions) {
      const item = document.createElement('li');
      item.textContent = 'Строка ' + line + ' · «' + text + '» · ' + reason;
      list.append(item);
    }
    suggestions.append(heading, list);
    card.append(suggestions);
  }
  if (result.marked.some(item => item.color === 'red')) {
    const note = document.createElement('p');
    note.textContent = 'Если удалённые слова звучат в записи, версия Clean отличается от аудио. Правка текста не устраняет правовые риски самой записи.';
    card.append(note);
  }
  reviewResults.replaceChildren(card);
}

async function runReview(file) {
  if (reviewing) return;
  reviewing = true;
  reviewFile.disabled = true;
  updateReviewInput();
  for (const link of reviewResults.querySelectorAll('.review-download')) URL.revokeObjectURL(link.href);
  reviewResults.replaceChildren();
  const controller = beginOperation(reviewSubmit, 'Проверяю текст…');
  const { signal } = controller;
  const data = new FormData();
  if (file) data.set('file', file);
  else {
    data.set('name', reviewForm.elements.name.value);
    data.set('text', reviewForm.elements.text.value);
  }
  showStatus('review-status', '');
  let cue;
  let reviewSucceeded = false;
  try {
    stopReviewSound();
    if (reviewSoundEnabled && studio.dataset.tool === 'review' && !document.hidden) {
      cue = {};
      activeReviewCue = cue;
      void playReviewSound(cue);
    }
    const checker = await fetch('/api/lyrics-tools/review', { signal });
    if (!checker.ok || (await checker.json()).policyVersion !== 6) {
      throw new Error('Студия запущена со старым проверщиком. Перезапусти её, чтобы использовать словарь.');
    }
    const result = await requestLyricsTool('review', data, signal);
    signal.throwIfAborted();
    if (!Array.isArray(result.suggestions)) {
      throw new Error('Студия запущена со старым проверщиком. Перезапусти её, чтобы использовать словарь.');
    }
    showReviewTrack(result);
    reviewSucceeded = true;
  } catch (error) {
    showStatus('review-status', signal.aborted ? 'Проверка остановлена.' : error.message, !signal.aborted);
  } finally {
    // Let an audible start cue finish, but cancel playback still waiting for the MP3.
    if (cue && activeReviewCue === cue && (!reviewSucceeded || !cue.source)) stopReviewSound();
    reviewing = false;
    reviewFile.value = '';
    reviewFile.disabled = false;
    reviewFile.dispatchEvent(new Event('change'));
    updateReviewInput();
    endOperation(controller);
  }
}

reviewFile.addEventListener('change', () => {
  const [file] = reviewFile.files;
  if (!file) return;
  reviewForm.elements.name.value = '';
  runReview(file);
});
reviewForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!reviewSubmit.disabled) runReview();
});

const distributionForm = byId('distribution-form');
const distributionFile = distributionForm.elements.file;
const distributionResult = byId('distribution-result');
const distributionSubmit = distributionForm.querySelector('button[type="submit"]');
const distributionActions = byId('distribution-actions');
let distributionDocument;

function updateDistributionInput() {
  distributionSubmit.disabled = distributionFile.disabled
    || !(distributionFile.files.length || distributionForm.elements.text.value.trim());
}

distributionForm.elements.text.addEventListener('input', updateDistributionInput);
distributionFile.addEventListener('change', updateDistributionInput);
updateDistributionInput();

distributionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (distributionSubmit.disabled) return;
  const data = new FormData(distributionForm);
  if (!distributionFile.files.length) data.delete('file');
  const controller = beginOperation(distributionSubmit, 'Оформляю текст…');
  const { signal } = controller;
  distributionFile.disabled = true;
  updateDistributionInput();
  distributionResult.hidden = distributionActions.hidden = true;
  distributionDocument = null;
  showStatus('distribution-status', '');
  try {
    const result = await requestLyricsTool('distribution', data, signal);
    signal.throwIfAborted();
    distributionResult.value = result.text;
    distributionDocument = result.document;
    distributionResult.hidden = distributionActions.hidden = false;
  } catch (error) {
    showStatus('distribution-status', signal.aborted ? 'Оформление остановлено.' : error.message, !signal.aborted);
  } finally {
    distributionFile.disabled = false;
    updateDistributionInput();
    endOperation(controller);
  }
});

byId('copy-distribution').addEventListener('click', () => copyLyricText(distributionResult, 'distribution-status'));
byId('download-distribution').addEventListener('click', () => {
  if (!distributionDocument) return;
  const link = document.createElement('a');
  const url = URL.createObjectURL(makeLyricDocx(distributionDocument.data));
  link.href = url;
  link.download = distributionDocument.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
});

const geniusFile = geniusForm.elements.file;
geniusFile.addEventListener('change', () => {
  if (geniusFile.files.length) geniusForm.requestSubmit();
});

geniusForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = event.submitter || geniusForm.querySelector('button[type="submit"]');
  if (submit.disabled) return;
  const data = new FormData(geniusForm);
  if (!geniusFile.files.length) data.delete('file');
  const controller = beginOperation(submit, 'Оформляю текст…');
  const { signal } = controller;
  submit.disabled = true;
  geniusFile.disabled = true;
  copyGenius.disabled = true;
  showStatus('genius-status', '');
  try {
    const result = await requestLyricsTool('genius', data, signal);
    signal.throwIfAborted();
    if (result.formatVersion !== 5) {
      throw new Error('Сервер Genius ещё работает со старыми правилами. Перезапусти студию.');
    }
    geniusResult.value = result.text;
    geniusResult.hidden = copyGenius.hidden = false;
    const operation = activeOperations.get(controller);
    if (studio.dataset.tool === 'genius' && [operation.stop, document.body].includes(document.activeElement)) {
      geniusResult.focus({ preventScroll: true });
    }
    const messages = {
      ai: 'Добавлены предположительные секции.',
      source: 'Использованы секции из исходника.',
      fallback: 'При необходимости расставь недостающие секции.',
    };
    const warnings = result.warnings || [];
    const message = messages[result.mode] || messages.fallback;
    showStatus('genius-quality', [message, ...warnings].join(' '));
    showStatus('genius-status', '');
  } catch (error) {
    showStatus('genius-status', signal.aborted ? 'Оформление остановлено.' : error.message, !signal.aborted);
  } finally {
    geniusFile.disabled = false;
    submit.disabled = false;
    copyGenius.disabled = !geniusResult.value.trim();
    endOperation(controller);
  }
});

geniusResult.addEventListener('input', () => {
  copyGenius.disabled = !geniusResult.value.trim() || geniusFile.disabled;
});

async function copyLyricText(field, statusId) {
  try {
    await navigator.clipboard.writeText(field.value);
    showStatus(statusId, 'Текст скопирован.');
  } catch {
    field.select();
    showStatus(statusId, 'Текст выделен. Нажми Ctrl+C.');
  }
}

copyGenius.addEventListener('click', () => copyLyricText(geniusResult, 'genius-status'));
