import type { ActivityFile } from './types.js';
import { parseGpx, parseFit } from './parser.js';
import { cacheKey, getManyCached, putManyCached } from './db.js';
import { drawTrack } from './map.js';
import { geocodeActivities } from './geocode.js';

const btnPick        = document.getElementById('btn-pick')          as HTMLButtonElement;
const btnClear       = document.getElementById('btn-clear')         as HTMLButtonElement;
const filterStart    = document.getElementById('filter-start')      as HTMLInputElement;
const filterEnd      = document.getElementById('filter-end')        as HTMLInputElement;
const filterCity     = document.getElementById('filter-city')       as HTMLSelectElement;
const statusEl       = document.getElementById('status')            as HTMLDivElement;
const geoStatusEl    = document.getElementById('geo-status')        as HTMLDivElement;
const tbody          = document.getElementById('activity-tbody')    as HTMLTableSectionElement;
const emptyMsg       = document.getElementById('empty-msg')         as HTMLDivElement;
const progressWrap   = document.getElementById('progress-bar-wrap') as HTMLDivElement;
const progressBar    = document.getElementById('progress-bar')      as HTMLDivElement;

let allActivities: ActivityFile[] = [];

// ── Canvas lazy-render ────────────────────────────────────────────────────────
const pendingCanvases = new Map<HTMLCanvasElement, ActivityFile>();
const canvasObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const canvas = entry.target as HTMLCanvasElement;
    const activity = pendingCanvases.get(canvas);
    if (activity) { drawTrack(canvas, activity.trackPoints); pendingCanvases.delete(canvas); }
    canvasObserver.unobserve(canvas);
  }
}, { rootMargin: '200px 0px' });

// ── Directory picker ──────────────────────────────────────────────────────────
btnPick.addEventListener('click', () => {
  if ('showDirectoryPicker' in window) pickWithFSA(); else pickWithInput();
});

async function pickWithFSA(): Promise<void> {
  let dirHandle: FileSystemDirectoryHandle;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dirHandle = await (window as any).showDirectoryPicker({ mode: 'read' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    setStatus(`Failed to open directory: ${String(err)}`);
    return;
  }
  btnPick.disabled = true;
  setStatus('Scanning…');
  try {
    const files: File[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const [name, handle] of dirHandle as any) {
      if ((handle as FileSystemHandle).kind !== 'file') continue;
      if (!name.endsWith('.gpx') && !name.endsWith('.fit.gz')) continue;
      files.push(await (handle as FileSystemFileHandle).getFile());
    }
    await processFiles(files);
  } finally {
    btnPick.disabled = false;
  }
}

function pickWithInput(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.setAttribute('webkitdirectory', '');
  input.multiple = true;
  input.addEventListener('change', async () => {
    const files = Array.from(input.files ?? [])
      .filter(f => f.name.endsWith('.gpx') || f.name.endsWith('.fit.gz'));
    btnPick.disabled = true;
    try { await processFiles(files); } finally { btnPick.disabled = false; }
  });
  input.click();
}

// ── Core processing with cache ────────────────────────────────────────────────
const BATCH_SIZE = 20;

async function processFiles(files: File[]): Promise<void> {
  if (files.length === 0) {
    setStatus('No .gpx or .fit.gz files found in that directory.');
    allActivities = [];
    resetCityFilter();
    render();
    return;
  }

  const total = files.length;
  const keys  = files.map(cacheKey);

  setStatus(`Checking cache for ${total} file(s)…`);
  const cached = await getManyCached(keys);

  const hits: ActivityFile[] = [];
  const missFiles: File[]    = [];
  const missKeys: string[]   = [];

  for (let i = 0; i < files.length; i++) {
    const hit = cached.get(keys[i]);
    if (hit) {
      if (!hit._cacheKey) hit._cacheKey = keys[i]; // backfill old entries
      hits.push(hit);
    } else {
      missFiles.push(files[i]);
      missKeys.push(keys[i]);
    }
  }

  // Rebuild city filter from cached data before rendering
  resetCityFilter();
  for (const h of hits) { if (h.city) addCityOption(h.city); }

  if (missFiles.length === 0) {
    setStatus(`${total} file(s) loaded from cache.`);
    allActivities = sortByDate([...hits]);
    render();
    startGeocoding(allActivities);
    return;
  }

  progressWrap.style.display = 'block';
  setProgress(0);

  const parsed: ActivityFile[] = [...hits];

  for (let i = 0; i < missFiles.length; i += BATCH_SIZE) {
    const batch     = missFiles.slice(i, i + BATCH_SIZE);
    const batchKeys = missKeys.slice(i, i + BATCH_SIZE);
    const results   = await Promise.allSettled(batch.map(parseFile));

    const toSave: Array<[string, ActivityFile]> = [];
    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const activity: ActivityFile = r.status === 'fulfilled'
        ? r.value
        : { filename: batch[j].name, startTime: null, endTime: null, activityType: 'parse error', fileSizeBytes: batch[j].size, trackPoints: [] };
      activity._cacheKey = batchKeys[j];
      parsed.push(activity);
      if (r.status === 'fulfilled') toSave.push([batchKeys[j], activity]);
    }

    putManyCached(toSave).catch(console.warn);

    const done = Math.min(i + BATCH_SIZE, missFiles.length);
    const note  = hits.length > 0 ? `${hits.length} cached · ` : '';
    setStatus(`${note}parsing ${done} / ${missFiles.length} new…`);
    setProgress(done / missFiles.length);
    await yieldToMain();
  }

  progressWrap.style.display = 'none';
  allActivities = sortByDate(parsed);
  render();
  startGeocoding(allActivities);
}

// ── Geocoding ─────────────────────────────────────────────────────────────────
let geocodeRenderTimer: ReturnType<typeof setTimeout> | null = null;

function startGeocoding(activities: ActivityFile[]): void {
  const needGeo = activities.filter(a => a.city === undefined && a.trackPoints.length > 0);
  if (needGeo.length === 0) { geoStatusEl.textContent = ''; return; }

  geoStatusEl.textContent = `geocoding cities: 0 / ${needGeo.length}`;

  geocodeActivities(
    activities,
    (activity, city) => {
      activity.city = city;

      // Update the city cell in the DOM directly (no re-render needed)
      if (activity._cacheKey) {
        const td = tbody.querySelector(`td[data-ckey="${CSS.escape(activity._cacheKey)}"]`) as HTMLTableCellElement | null;
        if (td) td.textContent = city || '—';
      }

      // Add to the cities dropdown
      if (city) addCityOption(city);

      // Persist updated entry to DB
      if (activity._cacheKey) {
        putManyCached([[activity._cacheKey, activity]]).catch(console.warn);
      }

      // Debounced re-render so city filter reflects new data
      if (geocodeRenderTimer) clearTimeout(geocodeRenderTimer);
      geocodeRenderTimer = setTimeout(render, 1000);
    },
    (done, total) => {
      geoStatusEl.textContent = `geocoding cities: ${done} / ${total}`;
      if (done === total) {
        geoStatusEl.textContent = '';
        render(); // final render to apply any active city filter
      }
    },
  );
}

// ── City filter helpers ───────────────────────────────────────────────────────
function resetCityFilter(): void {
  const prev = filterCity.value;
  filterCity.innerHTML = '<option value="">All cities</option>';
  // Re-select previous value if it still exists (it won't, but good practice)
  filterCity.value = prev === '' ? '' : '';
}

function addCityOption(city: string): void {
  if (!city) return;
  for (const opt of filterCity.options) {
    if (opt.value === city) return;
  }
  const opt = Object.assign(document.createElement('option'), { value: city, textContent: city });
  // Insert in sorted order after the first "All cities" option
  let inserted = false;
  for (let i = 1; i < filterCity.options.length; i++) {
    if ((filterCity.options[i].value ?? '') > city) {
      filterCity.insertBefore(opt, filterCity.options[i]);
      inserted = true;
      break;
    }
  }
  if (!inserted) filterCity.appendChild(opt);
}

// ── Filters ───────────────────────────────────────────────────────────────────
filterStart.addEventListener('input', render);
filterEnd.addEventListener('input', render);
filterCity.addEventListener('change', render);
btnClear.addEventListener('click', () => {
  filterStart.value = '';
  filterEnd.value   = '';
  filterCity.value  = '';
  render();
});

// ── Render ────────────────────────────────────────────────────────────────────
function render(): void {
  canvasObserver.disconnect();
  pendingCanvases.clear();

  const startFilter = filterStart.value ? new Date(filterStart.value) : null;
  const endFilter   = filterEnd.value
    ? (() => { const d = new Date(filterEnd.value); d.setDate(d.getDate() + 1); return d; })()
    : null;
  const cityFilter  = filterCity.value;

  const visible = allActivities.filter(a => {
    if (startFilter && a.startTime && a.startTime < startFilter) return false;
    if (endFilter   && a.startTime && a.startTime >= endFilter)  return false;
    if (cityFilter  && a.city !== cityFilter)                    return false;
    return true;
  });

  setStatus(allActivities.length > 0 ? `${allActivities.length} file(s) loaded` : '');
  tbody.innerHTML = '';

  if (visible.length === 0 && allActivities.length > 0) {
    emptyMsg.style.display = 'block';
    return;
  }
  emptyMsg.style.display = 'none';

  const fragment = document.createDocumentFragment();
  for (const activity of visible) {
    const tr = document.createElement('tr');
    if (activity.activityType === 'parse error') tr.classList.add('row-error');

    // Map canvas
    const mapTd = document.createElement('td');
    mapTd.className = 'map-cell';
    if (activity.trackPoints.length >= 2) {
      const canvas = document.createElement('canvas');
      canvas.width = 100; canvas.height = 52;
      canvas.className = 'track-canvas';
      pendingCanvases.set(canvas, activity);
      canvasObserver.observe(canvas);
      mapTd.appendChild(canvas);
    } else {
      mapTd.textContent = '—';
    }
    tr.appendChild(mapTd);

    tr.appendChild(cell(activity.filename));
    tr.appendChild(cell(formatDateRange(activity.startTime, activity.endTime)));
    tr.appendChild(cell(activity.activityType));

    // City cell — carries data-ckey so geocode results can update it in-place
    const cityTd = document.createElement('td');
    cityTd.dataset.ckey = activity._cacheKey ?? '';
    cityTd.textContent = activity.city === undefined ? '…' : (activity.city || '—');
    tr.appendChild(cityTd);

    tr.appendChild(cell(formatBytes(activity.fileSizeBytes)));
    fragment.appendChild(tr);
  }
  tbody.appendChild(fragment);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseFile(file: File): Promise<ActivityFile> {
  if (file.name.endsWith('.gpx'))    return parseGpx(file);
  if (file.name.endsWith('.fit.gz')) return parseFit(file);
  return Promise.reject(new Error(`Unrecognised extension: ${file.name}`));
}

function sortByDate(activities: ActivityFile[]): ActivityFile[] {
  return activities.sort((a, b) => {
    if (!a.startTime && !b.startTime) return 0;
    if (!a.startTime) return 1;
    if (!b.startTime) return -1;
    return b.startTime.getTime() - a.startTime.getTime();
  });
}

const dtFmt = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
});

function formatDate(d: Date | null): string { return d ? dtFmt.format(d) : '—'; }

function formatDateRange(start: Date | null, end: Date | null): string {
  if (!start && !end) return '—';
  if (!start)         return `? – ${formatDate(end)}`;
  if (!end)           return formatDate(start);
  return `${formatDate(start)} – ${formatDate(end)}`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024)     return `${Math.round(bytes / 1_024)} KB`;
  return `${bytes} B`;
}

function cell(text: string): HTMLTableCellElement {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function setStatus(msg: string): void { statusEl.textContent = msg; }
function setProgress(f: number): void { progressBar.style.width = `${Math.round(f * 100)}%`; }
function yieldToMain(): Promise<void> { return new Promise(r => setTimeout(r, 0)); }
