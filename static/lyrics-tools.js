'use strict';

const toolTabs = [...document.querySelectorAll('.studio-tabs [role="tab"]')];
const reviewForm = byId('review-form');
const geniusForm = byId('genius-form');
const reviewFiles = byId('review-files');
const geniusResult = byId('genius-result');
const copyGenius = byId('copy-genius');
const reviewCards = new Map();
let reviewing = false;
const reviewSubmit = reviewForm.querySelector('button[type="submit"]');

function updateReviewInput() {
  const hasText = Boolean(reviewForm.elements.text.value.trim());
  byId('review-name').hidden = !hasText;
  reviewSubmit.disabled = reviewing || !hasText || !reviewForm.elements.name.value.trim();
}

reviewForm.elements.text.addEventListener('input', updateReviewInput);
reviewForm.elements.name.addEventListener('input', updateReviewInput);

for (const field of document.querySelectorAll('.text-source-field')) {
  const input = field.querySelector('input[type="file"]');
  const text = field.querySelector('textarea');
  const filename = field.querySelector('[data-source-filename]');
  const clear = field.querySelector('[data-source-clear]');
  filename.setAttribute('aria-live', 'polite');

  function showAttachments() {
    filename.textContent = [...input.files].map((file) => file.name).join(', ');
    if (clear) clear.hidden = !input.files.length;
  }

  input.addEventListener('change', () => {
    if (input.files.length && !input.multiple) text.value = '';
    showAttachments();
  });
  text.addEventListener('input', () => {
    if (text.value.trim() && input.files.length && !input.multiple) {
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
    if ((!input.multiple && files.length > 1) || [...files].some((file) => !/\.(docx|txt)$/i.test(file.name))) {
      filename.textContent = input.multiple ? 'Поддерживаются DOCX и TXT.' : 'Добавь один файл DOCX или TXT.';
      return;
    }
    input.files = files;
    input.dispatchEvent(new Event('change'));
  });
}

function openStudioTool(tab) {
  studio.dataset.tool = tab.dataset.tool;
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

async function requestLyricsTool(tool, body) {
  const response = await fetch('/api/lyrics-tools/' + tool, { method: 'POST', body });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : 'Не удалось обработать текст.');
  }
  return response.json();
}

function showReviewTrack(result) {
  const card = document.createElement('article');
  const title = document.createElement('h3');
  title.textContent = result.name;
  const actions = document.createElement('div');
  actions.className = 'text-tool-buttons';
  const previewControls = document.createElement('div');
  previewControls.className = 'review-preview-controls';
  previewControls.setAttribute('role', 'group');
  previewControls.setAttribute('aria-label', 'Просмотр документов');
  const preview = document.createElement('div');
  preview.className = 'review-preview';
  preview.tabIndex = 0;
  preview.setAttribute('role', 'region');
  const previews = [];
  const links = result.documents.map((file, index) => {
    const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = file.name;
    const label = index === 0 ? 'EN площадки' : 'RU CLEAN';
    link.textContent = 'Скачать ' + label;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => showPreview(index));
    previews.push(button);
    return link;
  });
  function showPreview(index) {
    previews.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    preview.setAttribute('aria-label', result.documents[index].name);
    preview.replaceChildren(...(result.documents[index].lines || []).map((line) => {
      const row = document.createElement('div');
      for (const [text, flagged] of line) {
        if (flagged) {
          const span = document.createElement('mark');
          span.textContent = text;
          row.append(span);
        } else row.append(text);
      }
      return row;
    }));
    preview.scrollTop = 0;
  }
  actions.append(...links);
  previewControls.append(...previews);
  if (previews.length) showPreview(0);
  const marked = document.createElement('p');
  marked.textContent = result.marked.length
    ? 'Выделено в EN и удалено в RU: ' + result.marked.map(({ text, count }) => `«${text}»${count > 1 ? ` ×${count}` : ''}`).join(', ')
    : 'Наркотические упоминания не выявлены.';
  card.append(title, actions, previewControls, preview, marked);
  if (result.marked.length) {
    const note = document.createElement('p');
    note.textContent = 'Если удалённые слова звучат в записи, RU CLEAN отличается от аудио. Правка текста не устраняет правовые риски самой записи.';
    card.append(note);
  }
  const existing = reviewCards.get(result.name);
  if (existing) {
    existing.links.forEach((link) => URL.revokeObjectURL(link.href));
    existing.card.replaceWith(card);
  } else byId('review-results').append(card);
  reviewCards.set(result.name, { card, links });
}

async function runReview(files = []) {
  if (reviewing) return;
  reviewing = true;
  reviewFiles.disabled = true;
  updateReviewInput();
  const inputs = files.length ? files : [null];
  const errors = [];
  try {
    for (const [index, file] of inputs.entries()) {
      const data = new FormData();
      if (file) data.set('file', file);
      else {
        data.set('name', reviewForm.elements.name.value);
        data.set('text', reviewForm.elements.text.value);
      }
      showStatus('review-status', files.length > 1 ? `Проверяю трек ${index + 1} из ${files.length}…` : 'Проверяю текст локальной моделью…');
      try {
        showReviewTrack(await requestLyricsTool('review', data));
      } catch (error) {
        errors.push(file ? `${file.name} — ${error.message}` : error.message);
      }
    }
    showStatus('review-status', errors.join('\n') || '', Boolean(errors.length));
  } finally {
    reviewing = false;
    reviewFiles.value = '';
    reviewFiles.disabled = false;
    reviewFiles.dispatchEvent(new Event('change'));
    updateReviewInput();
  }
}

reviewFiles.addEventListener('change', () => {
  if (reviewFiles.files.length) runReview([...reviewFiles.files]);
});
reviewForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runReview();
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
  submit.disabled = true;
  geniusFile.disabled = true;
  geniusResult.hidden = copyGenius.hidden = true;
  showStatus('genius-status', 'Размечаю секции песни…');
  try {
    const result = await requestLyricsTool('genius', data);
    geniusResult.value = result.text;
    geniusResult.hidden = copyGenius.hidden = false;
    showStatus('genius-status', '');
  } catch (error) {
    showStatus('genius-status', error.message, true);
  } finally {
    geniusFile.disabled = false;
    submit.disabled = false;
  }
});

copyGenius.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(geniusResult.value);
    showStatus('genius-status', 'Текст скопирован.');
  } catch {
    geniusResult.select();
    showStatus('genius-status', 'Текст выделен. Нажми Ctrl+C.');
  }
});
