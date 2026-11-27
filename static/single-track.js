'use strict';
// PANDA MUSIC single-track workspace, 2026-11-27.

const byId = (id) => document.getElementById(id);
const form = byId('track-form');
const audioFile = byId('track-file');
const lyricsText = byId('lyrics-text');
const lyricsFile = byId('lyrics-file');
const language = byId('lyrics-language');
const sync = byId('sync');
const manual = byId('manual');
const result = byId('result');
const studio = byId('studio');
const emptyWorkspace = byId('empty-workspace');
const importPanel = byId('track-import');
const inspector = byId('project-inspector');
const uploadTab = byId('upload-tab');
const projectTab = byId('project-tab');
const player = byId('player');
const seek = byId('seek');
const lineList = byId('line-list');
const cancelSync = byId('cancel-sync');
const boundaryStepMs = 50;
const saveTimes = byId('save-times');
const resume = byId('resume');
const downloadButtons = [byId('export-ttml'), byId('export-lrc')];
const edits = new Map();
const autoShift = byId('auto-shift');
const autoFollow = byId('auto-follow');
const back = byId('undo');
const forward = byId('redo');
const reset = byId('reset-edits');
const helpDialog = byId('help-dialog');
const lyricsPanel = byId('lyrics-panel');
const editLyrics = byId('edit-lyrics');
const recheckTiming = byId('recheck-timing');
const clearTimings = byId('clear-timings');
const lyricsEditor = byId('lyrics-editor');
const themeToggle = byId('theme-toggle');
const metadataFields = {
  title: byId('track-title'), artist: byId('track-artist'), language: byId('track-language'),
};
const undoStack = [];
const redoStack = [];
let metadata;
let metadataEdit;
let project;
let draftLines;
let busy = false;
let activeLine = 0;
let recheckAnchor;
let tapping = false;
let tappedStart = null;
let syncController;
let peaks = [];

const help = {
  shift: ['Автосдвиг строк', [
    'При изменении начала или конца строки следующие отметки сдвигаются на ту же величину. Слоги сдвигаются вместе со своими строками.',
    'Если перенос начала назад создаёт пересечение, конец текущей строки подстраивается под начало следующей.',
    'При выключенном автосдвиге меняется только выбранная строка. Проверка таймингов отмечает пересечения.',
  ]],
  follow: ['Автосмена строки', [
    'Во время воспроизведения выделение и список следуют за текущей строкой. В паузах выделение остаётся на месте.',
    'При выключенной автосмене выбранная строка остаётся активной. В режиме разметки пробелом переход выполняется после отметки конца.',
  ]],
  keyboard: ['Горячие клавиши', [
    'Пробел — начало выбранной строки, второй пробел — конец. Esc — прервать разметку.',
    'Клик по строке запускает трек с её начала. Shift + × очищает тайминги от выбранной строки до той, где нажали ×.',
    'Ctrl+Z — отменить. Ctrl+Shift+Z или Ctrl+Y — повторить.',
  ]],
};

for (const button of document.querySelectorAll('[data-help]')) {
  button.addEventListener('click', () => {
    const [title, paragraphs] = help[button.dataset.help];
    byId('help-title').textContent = title;
    byId('help-content').replaceChildren(...paragraphs.map((content) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = content;
      return paragraph;
    }));
    helpDialog.showModal();
  });
}

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  themeToggle.textContent = dark ? '☀' : '☾';
  themeToggle.setAttribute('aria-pressed', String(dark));
  const label = dark ? 'Светлая тема' : 'Тёмная тема';
  themeToggle.setAttribute('aria-label', label);
  themeToggle.title = label;
  drawWaveform();
}

themeToggle.addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  localStorage.setItem('panda-editor-theme', dark ? 'dark' : 'light');
  applyTheme(dark);
});
for (const control of [autoShift, autoFollow]) {
  const key = 'panda-' + control.id;
  control.checked = localStorage.getItem(key) === 'true';
  control.addEventListener('change', () => localStorage.setItem(key, String(control.checked)));
}

document.addEventListener('keydown', (event) => {
  if (studio.dataset.tool !== 'sync' || busy || !project || helpDialog.open || !lyricsPanel.hidden || event.altKey || !(event.ctrlKey || event.metaKey)
    || event.target.matches?.('textarea, select, input[type="text"], [contenteditable="true"]')) return;
  if (event.code === 'KeyZ' || event.code === 'KeyY') {
    event.preventDefault();
    if (event.shiftKey || event.code === 'KeyY') moveHistory(redoStack, undoStack);
    else moveHistory(undoStack, redoStack);
  }
});

const savedMetadata = () => ({
  title: project.tracks[0].title || '',
  artist: project.tracks[0].artist || '',
  language: project.language || 'ru',
});
const savedLines = () => project.tracks[0].lyrics.lines;
const lines = () => draftLines;
const hasChanges = () => !!project && (edits.size > 0 || lines() !== savedLines()
  || JSON.stringify(metadata) !== JSON.stringify(savedMetadata()));
const audioDuration = () => Number.isFinite(player.duration) ? player.duration : (project?.tracks[0].duration || 0);

function captureDraft() {
  return structuredClone({ lines: lines(), rows: lines().map((_, index) => currentRows(index)), metadata, activeLine, tapping, recheckAnchor });
}

function setDraftLines(next) {
  draftLines = JSON.stringify(next) === JSON.stringify(savedLines()) ? savedLines() : next;
}

function rememberDraft() {
  undoStack.push(captureDraft());
  if (undoStack.length > 60) undoStack.shift();
  redoStack.length = 0;
}

function showMetadata() {
  for (const [key, field] of Object.entries(metadataFields)) field.value = metadata[key];
  byId('result-title').textContent = metadata.title.trim() || 'Тайминги';
}

function restoreDraft(snapshot) {
  edits.clear();
  setDraftLines(snapshot.lines);
  snapshot.rows.forEach((rows, index) => setTimingDraft(index, rows));
  metadata = snapshot.metadata;
  metadataEdit = null;
  activeLine = Math.min(snapshot.activeLine, lines().length - 1);
  recheckAnchor = snapshot.recheckAnchor;
  showMetadata();
  setTapMode(snapshot.tapping);
  updateTimingDraft();
}

function moveHistory(from, to) {
  if (busy || !project || !from.length) return;
  to.push(captureDraft());
  restoreDraft(from.pop());
}

back.addEventListener('click', () => moveHistory(undoStack, redoStack));
forward.addEventListener('click', () => moveHistory(redoStack, undoStack));
reset.addEventListener('click', () => {
  if (busy || !hasChanges()) return;
  rememberDraft();
  restoreDraft({ lines: savedLines(), rows: savedLines().map(readTimingRows), metadata: savedMetadata(), activeLine, tapping });
  showStatus('result-status', 'Восстановлена последняя сохранённая версия.');
});

metadataFields.language.replaceChildren(...[...language.options].map((option) => option.cloneNode(true)));
for (const [key, field] of Object.entries(metadataFields)) {
  field.addEventListener('focus', () => { metadataEdit = null; });
  field.addEventListener('input', () => {
    if (!project || busy || field.value === metadata[key]) return;
    if (metadataEdit !== field) rememberDraft();
    metadataEdit = field;
    metadata[key] = field.value;
    byId('result-title').textContent = metadata.title.trim() || 'Тайминги';
    showStatus('result-status', hasChanges() ? 'Сохрани правки перед скачиванием.' : '');
    updateControls();
  });
}

function validateTimeline() {
  const counts = { missing: 0, invalid: 0, syllables: 0, overlaps: new Set() };
  const timed = [];
  const duration = audioDuration();
  lines().forEach((_, index) => {
    const [line, ...parts] = currentRows(index);
    const start = Number(line.start);
    const end = Number(line.end);
    if (line.start === '' || line.end === '') {
      counts.missing++;
      return;
    }
    if (!validRange(line.start, line.end) || start < 0 || (duration && end > duration + 0.001)) {
      counts.invalid++;
      return;
    }
    if (parts.some((part) => !validRange(part.start, part.end) || Number(part.start) < start || Number(part.end) > end)) {
      counts.syllables++;
    }
    timed.push({ index, start, end });
  });
  let longest;
  for (const line of timed.sort((a, b) => a.start - b.start)) {
    if (longest && Math.round(line.start * 1000) < Math.round(longest.end * 1000)) {
      counts.overlaps.add(longest.index);
      counts.overlaps.add(line.index);
    }
    if (!longest || line.end > longest.end) longest = line;
  }
  return counts;
}

function showValidation(counts) {
  const box = byId('validation');
  const notices = [
    counts.missing ? 'Без обеих отметок: ' + counts.missing : '',
    counts.invalid ? 'Ошибки тайминга: ' + counts.invalid : '',
    counts.syllables ? 'Проблемы со слогами: ' + counts.syllables : '',
  ].filter(Boolean);
  box.textContent = notices.join(' · ') || (counts.overlaps.size ? '' : 'Тайминги проверены');
  if (counts.overlaps.size) {
    const links = document.createElement('span');
    links.className = 'overlap-links';
    links.append('Пересекаются строки ');
    for (const index of [...counts.overlaps].sort((a, b) => a - b)) {
      const jump = document.createElement('button');
      jump.type = 'button';
      jump.textContent = String(index + 1);
      jump.title = 'Перейти к строке ' + (index + 1);
      jump.disabled = busy;
      jump.addEventListener('click', () => {
        selectLine(index, true);
        lineList.children[index].querySelector('.line-text').focus();
      });
      links.append(jump);
    }
    box.append(links);
  }
  box.dataset.state = counts.invalid ? 'error' : notices.length || counts.overlaps.size ? 'warning' : 'ok';
}

function showStatus(id, message, isError = false) {
  const status = byId(id);
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle('error', isError);
}

function getRecheckAnchor() {
  const { index, boundary } = recheckAnchor || { index: activeLine, boundary: 'start' };
  const fromStart = boundary === 'start';
  const time = currentRows(index)[0][boundary];
  const offset = fromStart ? index : index + 1;
  return time !== '' && Number(time) >= 0 && Number(time) < audioDuration() && offset < lines().length
    ? { index, fromStart, anchor: Number(time), offset } : null;
}

function updateRecheckControl() {
  const point = project && getRecheckAnchor();
  recheckTiming.disabled = busy || tapping || !point;
  recheckTiming.title = point
    ? `С ${point.fromStart ? 'начала' : 'конца'} строки ${point.index + 1} (${clock(point.anchor)})`
    : 'Отметь начало строки, с которой сбились тайминги';
}

function updateControls() {
  const changes = hasChanges();
  const validation = project && validateTimeline();
  const audioName = audioFile.files[0]?.name;
  byId('track-file-name').textContent = audioName || 'Выбрать файл';
  audioFile.closest('.file-picker').classList.toggle('picked', Boolean(audioName));
  for (const input of [audioFile, lyricsText, lyricsFile, language]) input.disabled = busy;
  sync.disabled = busy || !audioFile.files.length || !(lyricsFile.files.length || lyricsText.value.trim());
  manual.disabled = sync.disabled;
  for (const button of downloadButtons) {
    button.disabled = busy || changes || !validation || validation.missing > 0 || validation.invalid > 0;
  }
  for (const button of lineList.querySelectorAll('button')) button.disabled = busy || button.dataset.unset === 'true';
  for (const input of [...Object.values(metadataFields), autoShift, autoFollow]) input.disabled = busy;
  back.disabled = busy || !undoStack.length;
  forward.disabled = busy || !redoStack.length;
  reset.disabled = busy || !changes;
  editLyrics.disabled = busy || !project;
  updateRecheckControl();
  clearTimings.disabled = busy || !project || !lines().some((_, index) => {
    const [{ start, end }] = currentRows(index);
    return start !== '' || end !== '';
  });
  saveTimes.disabled = busy || !changes;
  resume.disabled = busy;
  if (validation) showValidation(validation);
}

async function post(path, body, signal) {
  const options = body instanceof FormData
    ? { body }
    : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } };
  const response = await fetch(path, { method: 'POST', signal, ...options });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Студия не смогла завершить операцию. Попробуй ещё раз.');
  }
  return response;
}

function selectTrackFiles(files) {
  if (busy || !files.length) return;
  selectSidebarTab(uploadTab);
  importPanel.scrollIntoView({ block: 'nearest' });
  const selections = new Map();
  for (const file of files) {
    const extension = file.name.match(/\.[^.]+$/)?.[0].toLowerCase();
    const field = [audioFile, lyricsFile].find((input) => input.accept.split(',').includes(extension));
    if (!field || selections.has(field)) {
      const message = field ? 'Добавь по одному аудиофайлу и файлу с текстом.'
        : `Формат файла «${file.name}» не поддерживается. Текст можно загрузить в DOCX или TXT.`;
      showStatus('file-drop-status', message, true);
      return;
    }
    selections.set(field, file);
  }
  for (const [field, file] of selections) {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    field.files = transfer.files;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (audioFile.files.length && lyricsFile.files.length) form.requestSubmit(sync);
}

const isFileDrag = (event) => studio.dataset.tool === 'sync' && event.dataTransfer.types.includes('Files');
let fileDragDepth = 0;
function clearFileDrag() {
  fileDragDepth = 0;
  document.documentElement.classList.remove('file-drag-active');
}
window.addEventListener('dragenter', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  fileDragDepth += 1;
  document.documentElement.classList.toggle('file-drag-active', !busy);
});
window.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  document.documentElement.classList.toggle('file-drag-active', !busy);
  event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
});
window.addEventListener('dragleave', (event) => {
  if (isFileDrag(event) && --fileDragDepth <= 0) clearFileDrag();
});
window.addEventListener('drop', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  clearFileDrag();
  selectTrackFiles(event.dataTransfer.files);
});

audioFile.addEventListener('change', () => {
  showStatus('file-drop-status', '');
  updateControls();
});
lyricsText.addEventListener('input', () => {
  if (lyricsText.value.trim()) lyricsFile.value = '';
  showStatus('file-drop-status', '');
  updateControls();
});
lyricsFile.addEventListener('change', () => {
  if (lyricsFile.files.length) lyricsText.value = '';
  showStatus('file-drop-status', '');
  updateControls();
});
language.addEventListener('change', () => localStorage.setItem('panda-track-language', language.value));
const previousLanguage = localStorage.getItem('panda-track-language');
if ([...language.options].some((option) => option.value === previousLanguage)) language.value = previousLanguage;

function showSyncProgress(message) {
  sync.textContent = message || 'Синхронизировать';
  sync.toggleAttribute('data-progress', Boolean(message));
  sync.setAttribute('aria-busy', String(Boolean(message)));
  byId('sync-status').classList.toggle('sync-announcement', Boolean(message));
  if (message) showStatus('sync-status', message);
}

function finishImport(imported) {
  audioFile.value = lyricsFile.value = lyricsText.value = '';
  lyricsFile.dispatchEvent(new Event('change'));
  showProject(imported);
  localStorage.setItem('panda-last-track-project', imported.id);
}

function placeUntimedLines(track) {
  if (!track.unplacedLines?.length) return;
  track.lyrics.lines = track.unplacedLines.map(withoutTimings);
  track.unplacedLines = [];
}

cancelSync.addEventListener('click', () => syncController?.abort());

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const hasTextDraft = !lyricsPanel.hidden && lyricsEditor.value !== lines().map(formatLineText).join('\n');
  if (sync.disabled || ((hasChanges() || hasTextDraft) && !confirm('Начать новую синхронизацию? Несохранённые правки будут сброшены.'))) return;
  const selectedAudio = audioFile.files[0];
  const manualOnly = event.submitter === manual;
  const document = lyricsFile.files[0];
  const fromFile = document || new Blob([lyricsText.value], { type: 'text/plain' });
  const extension = document?.name.match(/\.[^.]+$/)?.[0] || '.txt';
  const audio = new FormData();
  audio.append('files', selectedAudio);
  let pending;
  const controller = manualOnly ? null : new AbortController();
  const signal = controller?.signal;
  syncController = controller;
  cancelSync.hidden = !controller;
  busy = true;
  updateControls();
  try {
    if (manualOnly) showStatus('sync-status', 'Загружаю аудио и текст…');
    else {
      showSyncProgress('Загружаю файлы…');
      sync.scrollIntoView({ block: 'nearest' });
    }
    const uploaded = await (await post('/api/project/upload_audio', audio, signal)).json();
    const lyrics = new FormData();
    const stem = selectedAudio.name.replace(/\.[^.]+$/, '');
    lyrics.append('files', fromFile, stem + extension);
    const assigned = await (await post('/api/project/' + uploaded.project_id + '/upload_lyrics', lyrics, signal)).json();
    if (!assigned.matched_count) {
      throw new Error(assigned.import_errors?.length
        ? 'Не удалось прочитать документ Word. Проверь, что в файле DOCX есть текст.'
        : 'Не удалось привязать текст к треку.');
    }
    if (assigned.project.tracks[0].status === 'empty') throw new Error('В файле нет текста песни.');
    pending = assigned.project;
    pending.language = language.value;
    if (manualOnly) placeUntimedLines(pending.tracks[0]);
    await post('/api/project/save_project', pending, signal);
    if (manualOnly) {
      finishImport(pending);
      setTapMode(true);
      showStatus('sync-status', '');
      return;
    }
    showSyncProgress('Синхронизирую…');
    const aligned = await (await post('/api/project/' + pending.id + '/align_track', {
      track_id: pending.tracks[0].id,
      language: pending.language,
      whisper_model: 'base',
      mode: 'studio_ai',
      cancellable: true,
    }, signal)).json();
    signal.throwIfAborted();
    if (!aligned.track?.lyrics?.lines?.length) throw new Error('Не удалось найти строки в аудио.');
    pending.tracks[0] = aligned.track;
    finishImport(pending);
    showStatus('sync-status', 'Тайминги готовы.');
    result.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    if (!project && pending && !signal?.aborted) {
      placeUntimedLines(pending.tracks[0]);
      showProject(pending);
      setTapMode(true);
      showStatus('result-status', 'Автосинхронизация не удалась. Запусти трек и отмечай начало и конец строк пробелом.', true);
    } else {
      selectSidebarTab(uploadTab);
      showStatus('sync-status', signal?.aborted ? 'Синхронизация отменена.' : error.message, !signal?.aborted);
    }
  } finally {
    cancelSync.hidden = true;
    syncController = null;
    showSyncProgress('');
    busy = false;
    updateControls();
  }
});

function showProject(saved) {
  project = saved;
  draftLines = savedLines();
  edits.clear();
  undoStack.length = 0;
  redoStack.length = 0;
  metadataEdit = null;
  metadata = savedMetadata();
  activeLine = 0;
  recheckAnchor = undefined;
  setTapMode(false);
  setLyricsPanel(false);
  player.src = saved.tracks[0].audioUrl;
  loadWaveform(player.src);
  showMetadata();
  renderLineList();
  result.hidden = false;
  emptyWorkspace.hidden = true;
  projectTab.disabled = false;
  studio.classList.remove('studio-empty');
  selectSidebarTab(projectTab);
  resume.hidden = true;
  showStatus('result-status', '');
}

function selectSidebarTab(tab) {
  for (const button of [uploadTab, projectTab]) {
    const active = button === tab;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
  }
  importPanel.hidden = tab !== uploadTab;
  inspector.hidden = tab !== projectTab;
  importPanel.parentElement.scrollTop = 0;
}

for (const tab of [uploadTab, projectTab]) {
  tab.addEventListener('click', () => selectSidebarTab(tab));
  tab.addEventListener('keydown', (event) => {
    if (projectTab.disabled || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === 'Home' ? uploadTab : event.key === 'End' ? projectTab
      : tab === uploadTab ? projectTab : uploadTab;
    selectSidebarTab(target);
    target.focus();
  });
}


function currentStudioText() {
  return project ? { name: metadata.title, text: lines().map(formatLineText).join('\n') } : null;
}

async function findLastTrack() {
  let id = localStorage.getItem('panda-last-track-project');
  if (!id) {
    try { id = JSON.parse(localStorage.getItem('lrcgen_active_project'))?.id; } catch {}
  }
  if (!id) return;
  try {
    const response = await fetch('/api/project/' + encodeURIComponent(id));
    if (!response.ok) return;
    const saved = await response.json();
    if (project || saved.tracks?.length !== 1 || !saved.tracks[0].lyrics?.lines?.length) return;
    resume.hidden = false;
    resume.onclick = () => {
      showProject(saved);
      result.scrollIntoView({ block: 'start' });
      updateControls();
    };
  } catch {}
}

const clock = (seconds) => {
  const total = Math.round(seconds * 1000);
  const ms = Math.abs(total);
  const minutes = String(Math.floor(ms / 60000)).padStart(2, '0');
  const rest = ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
  return (total < 0 ? '−' : '') + minutes + ':' + rest;
};
const syllableGroups = (line) => [...(line.rawSyllabi || []), ...(line.adlibSyllabi || [])];
const validRange = (start, end) => start !== '' && end !== '' && Number.isFinite(Number(start))
  && Number.isFinite(Number(end)) && Number(end) > Number(start);
const currentRows = (index) => edits.get(index) || readTimingRows(lines()[index]);

function formatLineText(line) {
  const adlib = line.adlib && line.adlib !== line.text ? '(' + line.adlib + ')' : '';
  return [line.text, adlib].filter(Boolean).join(' ');
}

function withoutTimings(line) {
  return { ...line, start: 0, end: 0, rawSyllabi: [], adlibSyllabi: [], isSimultaneous: false, laneIndex: 0 };
}

clearTimings.addEventListener('click', () => {
  if (clearTimings.disabled || !confirm('Очистить все тайминги и начать разметку с первой строки?')) return;
  rememberDraft();
  edits.clear();
  setDraftLines(lines().map(withoutTimings));
  player.pause();
  if (Number.isFinite(player.duration)) player.currentTime = 0;
  activeLine = 0;
  recheckAnchor = undefined;
  setTapMode(true);
  lineList.scrollTop = 0;
  updatePlayhead();
  updateTimingDraft();
  showStatus('result-status', 'Тайминги очищены. Запусти трек и отмечай границы пробелом.');
  lineList.children[0].querySelector('.line-text').focus();
});

function clearTimingRange(first, last) {
  rememberDraft();
  const next = [...lines()];
  for (let i = first; i <= last; i++) {
    next[i] = withoutTimings(next[i]);
    edits.delete(i);
  }
  setDraftLines(next);
  activeLine = first;
  recheckAnchor = undefined;
  setTapMode(true);
  updateTimingDraft();
  selectLine(first, true);
  lineList.children[first].querySelector('.line-text').focus({ preventScroll: true });
}

function normalizedLine(text) {
  return text.toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim() || text;
}

function orderedMatches(oldLength, newLength, score) {
  const totals = Array.from({ length: oldLength + 1 }, () => new Uint32Array(newLength + 1));
  for (let a = oldLength - 1; a >= 0; a--) {
    for (let b = newLength - 1; b >= 0; b--) {
      const weight = score(a, b);
      totals[a][b] = Math.max(totals[a + 1][b], totals[a][b + 1], weight ? totals[a + 1][b + 1] + weight : 0);
    }
  }
  const pairs = [];
  let a = 0;
  let b = 0;
  while (a < oldLength && b < newLength) {
    const weight = score(a, b);
    if (weight && totals[a][b] === totals[a + 1][b + 1] + weight) {
      pairs.push([a++, b++]);
    } else if (totals[a + 1][b] >= totals[a][b + 1]) {
      a++;
    } else {
      b++;
    }
  }
  return pairs;
}

function lineMatches(before, after) {
  const oldKeys = before.map(normalizedLine);
  const newKeys = after.map(normalizedLine);
  const oldSet = new Set(oldKeys);
  const newSet = new Set(newKeys);
  // Unchanged lines anchor the match. Replacements are considered only in the gaps.
  const exact = orderedMatches(oldKeys.length, newKeys.length, (a, b) => oldKeys[a] === newKeys[b] ? 1 : 0);
  const result = new Map(exact.map(([a, b]) => [b, a]));
  const bigrams = (text) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2)));
  const oldBigrams = oldKeys.map(bigrams);
  const newBigrams = newKeys.map(bigrams);
  const canReplace = (a, b) => !newSet.has(oldKeys[a]) && !oldSet.has(newKeys[b]);
  let oldStart = 0;
  let newStart = 0;
  for (const [a, b] of [...exact, [oldKeys.length, newKeys.length]]) {
    const oldCount = a - oldStart;
    const newCount = b - newStart;
    if (oldCount === 1 && newCount === 1) {
      if (canReplace(oldStart, newStart)) result.set(newStart, oldStart);
    } else if (oldCount && newCount) {
      const replacements = orderedMatches(oldCount, newCount, (i, j) => {
        if (!canReplace(oldStart + i, newStart + j)) return 0;
        const left = oldBigrams[oldStart + i];
        const right = newBigrams[newStart + j];
        const common = [...left].filter((pair) => right.has(pair)).length;
        const similarity = 2 * common / (left.size + right.size || 1);
        return similarity >= 0.55 ? Math.round(similarity * 100) : 0;
      });
      for (const [i, j] of replacements) result.set(newStart + j, oldStart + i);
    }
    oldStart = a + 1;
    newStart = b + 1;
  }
  return result;
}

function parseEditedLine(value) {
  const adlibs = [];
  const text = value.replace(/\(([^()]+)\)/g, (_, adlib) => {
    adlibs.push(adlib.trim());
    return '';
  }).replace(/\s+/g, ' ').trim();
  return { text, adlib: adlibs.join(' ') || null };
}

function setLyricsPanel(open) {
  lyricsPanel.hidden = !open;
  editLyrics.setAttribute('aria-expanded', String(open));
}

editLyrics.addEventListener('click', () => {
  if (busy || !project) return;
  if (!lyricsPanel.hidden) {
    setLyricsPanel(false);
    return;
  }
  lyricsEditor.value = lines().map(formatLineText).join('\n');
  showStatus('lyrics-edit-error', '');
  setLyricsPanel(true);
  lyricsEditor.focus({ preventScroll: true });
});
function closeLyricsEditor() {
  setLyricsPanel(false);
  editLyrics.focus({ preventScroll: true });
}
byId('cancel-lyrics-edit').addEventListener('click', closeLyricsEditor);
lyricsPanel.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeLyricsEditor();
});

byId('lyrics-edit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const after = lyricsEditor.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!after.length) {
    showStatus('lyrics-edit-error', 'Добавь хотя бы одну строку.', true);
    return;
  }
  const before = lines().map(formatLineText);
  if (before.length === after.length && before.every((line, index) => line === after[index])) {
    closeLyricsEditor();
    return;
  }

  rememberDraft();
  const matches = lineMatches(before, after);
  const sourceLines = lines();
  const sourceRows = sourceLines.map((_, index) => currentRows(index));
  const nextRows = [];
  const nextLines = after.map((value, index) => {
    const oldIndex = matches.get(index);
    if (oldIndex === undefined) {
      return withoutTimings({ id: crypto.randomUUID(), ...parseEditedLine(value), agent: 'v1', side: 'right' });
    }
    const unchanged = value === before[oldIndex];
    // Word spans still contain the old text when a line is rewritten.
    nextRows[index] = unchanged ? sourceRows[oldIndex] : [sourceRows[oldIndex][0]];
    if (unchanged) return sourceLines[oldIndex];
    return { ...sourceLines[oldIndex], ...parseEditedLine(value), rawSyllabi: [], adlibSyllabi: [] };
  });

  const selected = [...matches].find(([, oldIndex]) => oldIndex === activeLine)?.[0];
  activeLine = selected ?? Math.min(activeLine, nextLines.length - 1);
  tappedStart = null;
  recheckAnchor = undefined;
  edits.clear();
  setDraftLines(nextLines);
  nextRows.forEach((rows, index) => setTimingDraft(index, rows));
  closeLyricsEditor();
  renderTapHint();
  updateTimingDraft();
  selectLine(activeLine, true);
  const unmatched = nextLines.length - matches.size;
  const message = unmatched ? 'Текст обновлён. Строк без перенесённых таймингов: ' + unmatched + '.' : 'Текст обновлён.';
  showStatus('result-status', message + ' Сохрани правки.');
});

function selectLine(index, scroll = false) {
  const previous = lineList.children[activeLine];
  if (!scroll && recheckAnchor?.index !== index) recheckAnchor = undefined;
  if (activeLine !== index) {
    if (tappedStart !== null && previous) {
      const time = currentRows(activeLine)[0].start;
      previous.querySelector('output').textContent = time === '' ? '—' : clock(Number(time));
    }
    tappedStart = null;
  }
  activeLine = index;
  previous?.classList.remove('selected');
  previous?.querySelector('.line-text').setAttribute('aria-pressed', 'false');
  const row = lineList.children[index];
  row.classList.add('selected');
  row.querySelector('.line-text').setAttribute('aria-pressed', 'true');
  if (scroll) {
    const listRect = lineList.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.bottom > listRect.bottom) lineList.scrollTop += rowRect.bottom - listRect.bottom;
    if (rowRect.top < listRect.top) lineList.scrollTop -= listRect.top - rowRect.top;
  }
  renderTapHint();
  updateRecheckControl();
  drawWaveform();
}

function renderLineList() {
  byId('line-count').textContent = '(' + lines().length + ')';
  const position = lineList.scrollTop;
  lineList.replaceChildren(...lines().map((line, index) => {
    const row = document.createElement('div');
    row.className = 'line-row' + (index === activeLine ? ' selected' : '');
    const number = document.createElement('span');
    number.className = 'line-number';
    number.textContent = String(index + 1).padStart(2, '0');
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'row-play';
    play.setAttribute('aria-label', 'Играть со строки ' + (index + 1));
    play.title = play.getAttribute('aria-label');
    play.append(document.createElement('span'));
    play.addEventListener('click', () => {
      selectLine(index);
      playLine(index);
    });
    const label = document.createElement('button');
    label.type = 'button';
    label.className = 'line-text';
    label.textContent = formatLineText(line) || 'Строка ' + (index + 1);
    label.title = 'Играть с начала строки';
    label.setAttribute('aria-pressed', String(index === activeLine));
    const options = document.createElement('div');
    options.className = 'row-times';
    const times = currentRows(index)[0];
    for (const [key, name] of [['start', 'Начало'], ['end', 'Конец']]) {
      const pair = document.createElement('span');
      pair.className = 'row-time';
      pair.dataset.boundary = key;
      const caption = document.createElement('span');
      caption.className = 'boundary-label';
      caption.textContent = name;
      const time = document.createElement('output');
      const value = key === 'start' && index === activeLine && tappedStart !== null ? tappedStart : times[key];
      time.textContent = value === '' ? '—' : clock(Number(value));
      time.setAttribute('aria-label', name);
      const target = document.createElement('button');
      target.type = 'button';
      target.className = 'target';
      target.dataset.boundary = key;
      target.setAttribute('aria-label', name + ' строки ' + (index + 1) + ' по курсору');
      target.title = target.getAttribute('aria-label');
      target.append(document.createElement('span'));
      target.addEventListener('click', () => stampBoundary(index, key));
      const steps = document.createElement('span');
      steps.className = 'boundary-steps';
      for (const [direction, sign, when] of [[-1, '−', 'раньше'], [1, '+', 'позже']]) {
        const step = document.createElement('button');
        const stepLabel = name + ' строки ' + (index + 1) + ' на 50 мс ' + when;
        step.type = 'button';
        step.className = 'nudge';
        step.textContent = sign;
        step.setAttribute('aria-label', stepLabel);
        step.title = stepLabel;
        step.dataset.step = direction;
        step.dataset.unset = String(times[key] === '');
        step.disabled = busy || times[key] === '';
        step.addEventListener('click', () => {
          const previous = Number(currentRows(index)[0][key]);
          const ms = Math.round(previous * 1000) + direction * boundaryStepMs;
          if (changeBoundary(index, key, ms)) {
            lineList.children[index].querySelector('.row-time[data-boundary="' + key + '"] [data-step="' + direction + '"]')
              ?.focus({ preventScroll: true });
          }
        });
        steps.append(step);
      }
      pair.append(caption, time, steps, target);
      options.append(pair);
    }
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'row-clear';
    clear.textContent = '×';
    clear.setAttribute('aria-label', 'Очистить тайминги строки ' + (index + 1));
    clear.title = 'Очистить тайминги. С Shift — очистить диапазон от выбранной строки.';
    clear.addEventListener('click', (event) => {
      if (busy) return;
      const from = event.shiftKey ? activeLine : index;
      clearTimingRange(Math.min(from, index), Math.max(from, index));
    });
    row.append(number, play, options, label, clear);
    row.addEventListener('click', (event) => {
      if (busy || event.detail > 1 || event.target.closest('.target, .row-play, .nudge, .row-clear')) return;
      selectLine(index);
      playLine(index);
    });
    return row;
  }));
  lineList.scrollTop = position;
}

function updateTimingDraft() {
  renderLineList();
  drawWaveform();
  showStatus('result-status', hasChanges() ? 'Сохрани правки перед скачиванием.' : '');
  updateControls();
}

function setTimingDraft(index, rows) {
  if (JSON.stringify(rows) === JSON.stringify(readTimingRows(lines()[index]))) edits.delete(index);
  else edits.set(index, rows);
}

function setLineRange(index, start, end, boundary = 'end') {
  const rows = currentRows(index);
  const [line, ...syllables] = rows;
  if (line.start === start && line.end === end) return;
  rememberDraft();
  const previousStart = Number(line.start);
  const previousEnd = Number(line.end);
  const changedTime = boundary === 'start' ? start : end;
  const previousTime = line[boundary];
  const shiftMs = autoShift.checked && previousTime !== '' && changedTime !== ''
    ? Math.round(Number(changedTime) * 1000) - Math.round(Number(previousTime) * 1000) : 0;
  if (boundary === 'start' && shiftMs < 0 && end !== '') {
    for (let next = index + 1; next < lines().length; next++) {
      const nextStart = currentRows(next)[0].start;
      if (nextStart === '') continue;
      const maxEnd = Math.max(Math.round(Number(nextStart) * 1000), Math.round(previousEnd * 1000)) + shiftMs;
      if (Math.round(Number(end) * 1000) > maxEnd) end = (maxEnd / 1000).toFixed(3);
      break;
    }
  }
  if (validRange(start, end) && validRange(line.start, line.end)) {
    const resize = syllables.some((part) => Number(part.start) < Number(start) || Number(part.end) > Number(end));
    for (const part of syllables) {
      for (const [key, oldBoundary, newBoundary] of [['start', previousStart, Number(start)], ['end', previousEnd, Number(end)]]) {
        const original = Number(part[key]);
        if (resize) {
          const relative = Math.max(0, Math.min(1, (original - previousStart) / (previousEnd - previousStart)));
          part[key] = (Number(start) + relative * (Number(end) - Number(start))).toFixed(3);
        } else if (Math.abs(original - oldBoundary) <= 0.003) {
          part[key] = newBoundary.toFixed(3);
        }
      }
    }
  }
  line.start = start;
  line.end = end;
  setTimingDraft(index, rows);
  if (shiftMs) {
    const move = (time) => time === '' ? '' : ((Math.round(Number(time) * 1000) + shiftMs) / 1000).toFixed(3);
    for (let next = index + 1; next < lines().length; next++) {
      const following = currentRows(next);
      if (following[0].start === '' && following[0].end === '') continue;
      setTimingDraft(next, following.map((part) => ({ start: move(part.start), end: move(part.end) })));
    }
  }
  updateTimingDraft();
}

function stampBoundary(index, key) {
  if (busy || !Number.isFinite(player.duration)) return;
  changeBoundary(index, key, Math.round(player.currentTime * 1000));
}

function changeBoundary(index, key, ms) {
  if (busy) return false;
  const duration = audioDuration();
  if (ms < 0 || (duration && ms > Math.ceil(duration * 1000))) {
    showStatus('result-status', 'Отметка должна быть в пределах трека.', true);
    return false;
  }
  tappedStart = null;
  selectLine(index);
  const line = currentRows(index)[0];
  const time = (ms / 1000).toFixed(3);
  const start = key === 'start' ? time : line.start;
  const end = key === 'end' ? time : line.end;
  if (start !== '' && end !== '' && !validRange(start, end)) {
    showStatus('result-status', 'Конец строки должен быть позже её начала.', true);
    return false;
  }
  setLineRange(index, start, end, key);
  recheckAnchor = { index, boundary: key };
  updateRecheckControl();
  return true;
}

recheckTiming.addEventListener('click', async () => {
  if (recheckTiming.disabled) return;
  const { fromStart, anchor, offset } = getRecheckAnchor();
  const text = lines().slice(offset).map(formatLineText);
  busy = true;
  recheckTiming.setAttribute('aria-busy', 'true');
  updateControls();
  showStatus('result-status', `Перепроверяю строки с ${offset + 1}-й до конца трека…`);
  try {
    const { suggestions } = await (await post('/api/project/' + project.id + '/recheck_timeline', {
      track_id: project.tracks[0].id, anchor, from_start: fromStart, language: metadata.language, lines: text,
    })).json();
    if (!suggestions.length) {
      showStatus('result-status', 'Уверенных совпадений нет. Попробуй отметить начало следующей строки.', true);
      return;
    }
    const nextLines = [...lines()];
    rememberDraft();
    for (const { index, start, end, rawSyllabi, adlibSyllabi } of suggestions) {
      const i = offset + index;
      nextLines[i] = { ...nextLines[i], start, end, rawSyllabi, adlibSyllabi };
      edits.delete(i);
    }
    setDraftLines(nextLines);
    updateTimingDraft();
    const missed = text.length - suggestions.length;
    const message = `Перепроверено строк: ${suggestions.length}.` + (missed ? ` Без уверенного совпадения: ${missed}.` : '');
    showStatus('result-status', message + (hasChanges() ? ' Сохрани правки.' : ''));
  } catch (error) {
    showStatus('result-status', error.message, true);
  } finally {
    busy = false;
    recheckTiming.removeAttribute('aria-busy');
    updateControls();
  }
});

function renderTapHint() {
  const hint = byId('tap-hint');
  hint.classList.toggle('is-marking', tapping);
  hint.textContent = tapping
    ? 'Строка ' + (activeLine + 1) + ' · Пробел — ' + (tappedStart === null ? 'начало' : 'конец')
    : 'Пробел — начало и конец выбранной строки. Shift + × очищает диапазон.';
}

function setTapMode(enabled) {
  tapping = enabled;
  tappedStart = null;
  renderTapHint();
  updateRecheckControl();
}

document.addEventListener('keydown', (event) => {
  if (studio.dataset.tool !== 'sync' || busy || result.hidden || helpDialog.open || !lyricsPanel.hidden || event.altKey || event.ctrlKey || event.metaKey
    || event.target.closest?.('.editor-sidebar, .result-bar')
    || event.target.matches?.('textarea, select, input:not(#seek), [contenteditable="true"]')) return;
  if (event.code === 'Escape' && tapping) {
    setTapMode(false);
    renderLineList();
    return;
  }
  if (event.code !== 'Space') return;
  event.preventDefault();
  if (event.repeat || !Number.isFinite(player.duration)) return;
  const time = player.currentTime;
  if (tappedStart === null) {
    setTapMode(true);
    tappedStart = time;
    renderLineList();
    renderTapHint();
    return;
  }
  const start = tappedStart.toFixed(3);
  const end = time.toFixed(3);
  if (!validRange(start, end)) {
    showStatus('result-status', 'Поставь конец после начала строки.', true);
    return;
  }
  tappedStart = null;
  setLineRange(activeLine, start, end);
  if (activeLine + 1 < lines().length && currentRows(activeLine + 1)[0].start === '') {
    selectLine(activeLine + 1, true);
  } else setTapMode(false);
});

async function loadWaveform(url) {
  peaks = [];
  seek.disabled = true;
  updatePlayhead();
  let context;
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    context = new AudioContext();
    const audio = await context.decodeAudioData(await response.arrayBuffer());
    if (player.src !== url) return;
    const channel = audio.getChannelData(0);
    const count = Math.min(900, channel.length);
    peaks = Array.from({ length: count }, (_, index) => {
      const first = Math.floor(index * channel.length / count);
      const end = Math.floor((index + 1) * channel.length / count);
      const stride = Math.max(1, Math.ceil((end - first) / 60));
      let peak = 0;
      for (let i = first; i < end; i += stride) peak = Math.max(peak, Math.abs(channel[i]));
      return peak;
    });
    drawWaveform();
  } catch {
    // Keep the time slider usable if the browser cannot decode peaks.
  } finally {
    if (context) await context.close().catch(() => {});
  }
}

function drawWaveform() {
  if (result.hidden) return;
  const canvas = byId('wave');
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(canvas.clientWidth * ratio);
  const height = Math.round(canvas.clientHeight * ratio);
  if (!width || !height) return;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);
  const duration = player.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const colors = getComputedStyle(canvas);
  const playedColor = colors.getPropertyValue('--wave-played').trim();
  const idleColor = colors.getPropertyValue('--wave-idle').trim();
  const line = currentRows(activeLine)[0];
  if (validRange(line.start, line.end)) {
    ctx.fillStyle = colors.getPropertyValue('--wave-selection').trim();
    ctx.fillRect(Number(line.start) / duration * width, 0, (Number(line.end) - Number(line.start)) / duration * width, height);
  }
  const step = width / peaks.length;
  const played = player.currentTime / duration * width;
  for (const [index, peak] of peaks.entries()) {
    const x = index * step;
    const bar = Math.max(2 * ratio, peak * height * 0.94);
    ctx.fillStyle = x <= played ? playedColor : idleColor;
    ctx.fillRect(x, (height - bar) / 2, Math.max(1, step * .68), bar);
  }
}

function updatePlayhead() {
  const duration = Number.isFinite(player.duration) ? player.duration : 0;
  seek.max = duration;
  seek.value = player.currentTime;
  seek.disabled = !duration;
  seek.setAttribute('aria-valuetext', clock(player.currentTime));
  byId('play-time').textContent = clock(player.currentTime) + ' / ' + clock(duration);
  if (autoFollow.checked && project && !tapping && !player.paused) {
    const time = player.currentTime;
    const next = lines().findLastIndex((_, index) => {
      const { start, end } = currentRows(index)[0];
      return validRange(start, end) && time >= Number(start) && time < Number(end);
    });
    if (next >= 0 && next !== activeLine) {
      selectLine(next, true);
      return;
    }
  }
  drawWaveform();
}

seek.addEventListener('input', () => {
  player.currentTime = Number(seek.value);
  updatePlayhead();
});
for (const [id, amount] of [['back-five', -5], ['forward-five', 5]]) {
  byId(id).addEventListener('click', () => {
    const duration = audioDuration();
    if (!duration) return;
    player.currentTime = Math.max(0, Math.min(duration, player.currentTime + amount));
    updatePlayhead();
  });
}
byId('speed').addEventListener('change', (event) => { player.playbackRate = Number(event.target.value); });
byId('play').addEventListener('click', () => {
  if (player.paused) player.play().catch(() => {});
  else player.pause();
});
player.addEventListener('loadedmetadata', updatePlayhead);
player.addEventListener('loadedmetadata', updateControls);
player.addEventListener('timeupdate', updatePlayhead);
player.addEventListener('seeked', updatePlayhead);
player.addEventListener('play', () => { byId('play').textContent = 'Ⅱ Пауза'; });
player.addEventListener('pause', () => { byId('play').textContent = '▶ Слушать'; });
new ResizeObserver(drawWaveform).observe(byId('wave'));

function readTimingRows(line) {
  const timed = line.end > line.start;
  return [
    { start: timed ? line.start.toFixed(3) : '', end: timed ? line.end.toFixed(3) : '' },
    ...syllableGroups(line).map((word) => ({
      start: (word.time / 1000).toFixed(3),
      end: ((word.time + word.duration) / 1000).toFixed(3),
    })),
  ];
}

function playLine(index) {
  if (busy) return;
  const start = currentRows(index)[0].start;
  if (start === '' || !Number.isFinite(Number(start))) {
    showStatus('result-status', 'Сначала отметь начало строки.', true);
    return;
  }
  if (!Number.isFinite(player.duration)) return;
  const from = Math.max(0, Number(start));
  if (from >= player.duration) return;
  player.currentTime = from;
  player.play().catch(() => {
    showStatus('result-status', 'Не удалось запустить воспроизведение.', true);
  });
}

saveTimes.addEventListener('click', async () => {
  if (!project || busy || !hasChanges()) return;
  const updated = structuredClone(project);
  const track = updated.tracks[0];
  track.lyrics.lines = structuredClone(lines());
  track.title = metadata.title.trim();
  track.artist = metadata.artist.trim();
  updated.language = metadata.language;
  if (track.title) updated.title = track.title;
  try {
    for (const [index, rows] of edits) {
      const times = rows.map(({ start, end }) => [Math.round(Number(start) * 1000), Math.round(Number(end) * 1000)]);
      const [[first, last], ...syllables] = times;
      const duration = audioDuration();
      const line = track.lyrics.lines[index];
      if (!validRange(rows[0].start, rows[0].end) || first < 0 || (duration && last > Math.ceil(duration * 1000))) {
        throw new Error('Строка ' + (index + 1) + '. Проверь начало и конец в пределах трека.');
      }
      const original = readTimingRows(line);
      const offset = first - Math.round(line.start * 1000);
      // Shifting an existing line keeps its syllable timings relative to that line.
      const translated = validRange(original[0].start, original[0].end) && original.every((part, i) =>
        times[i][0] === Math.round(Number(part.start) * 1000) + offset
        && times[i][1] === Math.round(Number(part.end) * 1000) + offset);
      if (!translated && syllables.some(([a, b], i) => !validRange(rows[i + 1].start, rows[i + 1].end)
        || b <= a || a < first || b > last)) {
        throw new Error('Строка ' + (index + 1) + '. Слоги должны помещаться в строку.');
      }
      line.start = first / 1000;
      line.end = last / 1000;
      syllableGroups(line).forEach((word, i) => {
        word.time = syllables[i][0];
        word.duration = syllables[i][1] - syllables[i][0];
      });
    }
    const allTimed = track.lyrics.lines.every((line) => validRange(line.start, line.end));
    const hasSyllables = track.lyrics.lines.some((line) => syllableGroups(line).length > 0);
    track.status = allTimed ? (hasSyllables ? 'syllable_synced' : 'line_synced') : 'raw_lyrics';
    track.lyrics.meta = { ...track.lyrics.meta, timingType: hasSyllables ? 'Word' : 'Line' };
    busy = true;
    updateControls();
    await post('/api/project/save_project', updated);
    project = updated;
    draftLines = savedLines();
    edits.clear();
    metadata = savedMetadata();
    metadataEdit = null;
    showMetadata();
    renderLineList();
    showStatus('result-status', 'Правки сохранены.');
  } catch (error) {
    showStatus('result-status', error.message, true);
  } finally {
    busy = false;
    updateControls();
  }
});

async function exportTrack(format) {
  if ((format === 'ttml' ? downloadButtons[0] : downloadButtons[1]).disabled) return;
  const { lyrics, title, artist } = project.tracks[0];
  const segments = lyrics.lines.map((line) => ({ start: line.start, end: line.end, text: formatLineText(line) }));
  const profile = 'streaming';
  const data = format === 'ttml'
    ? { profile, lyrics: { meta: { language: project.language }, lines: segments }, title, artist }
    : { profile, segments, title, artist };
  busy = true;
  updateControls();
  try {
    const response = await post(format === 'ttml' ? '/api/export_ttml' : '/api/export', data);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = (title || 'Текст').replace(/[<>:"/\\|?*]/g, '_') + '.' + format;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (error) {
    showStatus('result-status', error.message, true);
  } finally {
    busy = false;
    updateControls();
  }
}

byId('export-ttml').addEventListener('click', () => exportTrack('ttml'));
byId('export-lrc').addEventListener('click', () => exportTrack('lrc'));
applyTheme(localStorage.getItem('panda-editor-theme') === 'dark');
updateControls();
findLastTrack();
