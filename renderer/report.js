const api = window.floatFocus || {};

const reportDate = document.getElementById('report-date');
const btnExport = document.getElementById('btn-export');
const btnRefresh = document.getElementById('btn-refresh');
const btnClose = document.getElementById('btn-close');
const focusTimeEl = document.getElementById('focus-time');
const focusNoteEl = document.getElementById('focus-note');
const totalTimeEl = document.getElementById('total-time');
const breakTimeEl = document.getElementById('break-time');
const focusSessionsEl = document.getElementById('focus-sessions');
const completedFocusEl = document.getElementById('completed-focus');
const trendRangeEl = document.getElementById('trend-range');
const weekChartEl = document.getElementById('week-chart');
const timelineTicksEl = document.getElementById('timeline-ticks');
const timelineEl = document.getElementById('timeline');
const sessionsEl = document.getElementById('sessions');
const sessionCountEl = document.getElementById('session-count');
const statusEl = document.getElementById('status');

let currentData = null;

function formatDuration(seconds) {
  const totalMinutes = Math.max(0, Math.round((Number(seconds) || 0) / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatClock(time) {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayStartMs(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
}

function setStatus(message) {
  statusEl.textContent = message || '';
}

function renderMetrics(day) {
  const focusRatio = day.totalSec ? Math.round((day.focusSec / day.totalSec) * 100) : 0;
  focusTimeEl.textContent = formatDuration(day.focusSec);
  focusNoteEl.textContent = `${focusRatio}% of tracked time`;
  totalTimeEl.textContent = formatDuration(day.totalSec);
  breakTimeEl.textContent = formatDuration(day.breakSec);
  focusSessionsEl.textContent = String(day.focusSessions || 0);
  completedFocusEl.textContent = String(day.completedFocus || 0);
}

function renderWeek(days, selectedDate) {
  const maxFocus = Math.max(1, ...days.map((day) => day.focusSec || 0));
  weekChartEl.innerHTML = '';

  days.forEach((day) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day-pill';
    button.classList.toggle('is-active', day.date === selectedDate);
    button.title = `${day.date} ${formatDuration(day.focusSec)} focus`;

    const bar = document.createElement('i');
    bar.style.height = `${Math.max(3, Math.round((day.focusSec / maxFocus) * 100))}%`;
    const label = document.createElement('b');
    label.textContent = day.date.slice(5);

    button.append(bar, label);
    button.addEventListener('click', () => loadReport(day.date));
    weekChartEl.appendChild(button);
  });

  if (days.length) {
    trendRangeEl.textContent = `${days[0].date.slice(5)} - ${days[days.length - 1].date.slice(5)}`;
  } else {
    trendRangeEl.textContent = '';
  }
}

function renderTimeline(day) {
  const start = dayStartMs(day.date);
  const dayMs = 24 * 60 * 60 * 1000;
  timelineTicksEl.innerHTML = '';
  timelineEl.innerHTML = '';

  [0, 6, 12, 18, 24].forEach((hour) => {
    const tick = document.createElement('span');
    tick.style.left = `${Math.min(100, (hour / 24) * 100)}%`;
    tick.textContent = `${hour}:00`;
    timelineTicksEl.appendChild(tick);
  });

  if (!day.blocks.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No timer activity';
    timelineEl.appendChild(empty);
    return;
  }

  day.blocks.forEach((block) => {
    const left = Math.max(0, Math.min(100, ((block.start - start) / dayMs) * 100));
    const right = Math.max(0, Math.min(100, ((block.end - start) / dayMs) * 100));
    const segment = document.createElement('span');
    segment.className = `timeline-block ${block.kind === 'break' ? 'break' : 'focus'}`;
    segment.style.left = `${left}%`;
    segment.style.width = `${Math.max(0.45, right - left)}%`;
    segment.title = `${block.kind === 'break' ? 'Break' : 'Focus'} ${formatClock(block.start)}-${formatClock(block.end)}`;
    timelineEl.appendChild(segment);
  });
}

function renderSessions(day) {
  sessionsEl.innerHTML = '';
  sessionCountEl.textContent = `${day.blocks.length} blocks`;

  if (!day.blocks.length) {
    const item = document.createElement('li');
    item.className = 'empty';
    item.textContent = 'No sessions recorded for this day.';
    sessionsEl.appendChild(item);
    return;
  }

  day.blocks.slice().reverse().forEach((block) => {
    const item = document.createElement('li');
    const time = document.createElement('span');
    const kind = document.createElement('b');
    const duration = document.createElement('strong');

    time.textContent = `${formatClock(block.start)}-${formatClock(block.end)}`;
    kind.textContent = block.kind === 'break' ? 'Break' : 'Focus';
    duration.textContent = formatDuration(block.seconds);
    item.append(time, kind, duration);
    sessionsEl.appendChild(item);
  });
}

function renderReport(data) {
  currentData = data;
  reportDate.value = data.selectedDate;
  reportDate.max = data.today || '';
  renderMetrics(data.selected);
  renderWeek(data.days || [], data.selectedDate);
  renderTimeline(data.selected);
  renderSessions(data.selected);
}

async function loadReport(date = reportDate.value) {
  if (!api.getReportData) {
    renderReport({
      selectedDate: new Date().toISOString().slice(0, 10),
      days: [],
      selected: {
        date: new Date().toISOString().slice(0, 10),
        focusSec: 0,
        breakSec: 0,
        totalSec: 0,
        focusSessions: 0,
        completedFocus: 0,
        blocks: [],
      },
    });
    setStatus('Report API unavailable in this preview.');
    return;
  }

  setStatus('Refreshing...');
  try {
    const data = await api.getReportData({ date, days: 14 });
    renderReport(data);
    setStatus(`Data: ${data.statsPath}`);
  } catch (error) {
    setStatus('Could not load report data.');
  }
}

async function exportSelectedDay() {
  if (!api.exportDayReport) return;

  btnExport.disabled = true;
  setStatus('Exporting...');
  try {
    const result = await api.exportDayReport(reportDate.value || (currentData && currentData.selectedDate));
    if (result && result.canceled) setStatus('Export canceled.');
    else setStatus(`Exported: ${result.filePath}`);
  } catch (error) {
    setStatus('Export failed.');
  } finally {
    btnExport.disabled = false;
  }
}

reportDate.addEventListener('change', () => loadReport(reportDate.value));
btnRefresh.addEventListener('click', () => loadReport(reportDate.value));
btnExport.addEventListener('click', exportSelectedDay);
btnClose.addEventListener('click', () => {
  if (api.closeWindow) api.closeWindow();
  else window.close();
});

loadReport();
