import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let supabase;
(async () => {
  const cfg = await fetch('/api/config').then(r => r.json());
  supabase = createClient(cfg.url, cfg.anon);
  supabase.auth.onAuthStateChange(() => refreshAuth());
  refreshAuth();
})();

async function api(url, opts = {}) {
  const { data: s } = await supabase.auth.getSession();
  const res = await fetch(url, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${s?.session?.access_token || ''}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

function refreshAuth() {
  const s = supabase?.auth?.getSession?.();
  const loggedIn = !!s?.data?.session;
  $('app').classList.toggle('hidden', !loggedIn);
  $('loginPrompt').classList.toggle('hidden', loggedIn);
  $('authBox').innerHTML = loggedIn
    ? `<button id="logoutBtn" class="secondary">Logout</button>`
    : '';
  if (loggedIn) {
    $('logoutBtn').onclick = () => supabase.auth.signOut();
    refreshFBStatus();
    refreshQueue();
    loadSettings();
  }
}

// ---------- Facebook ----------

async function refreshFBStatus() {
  try {
    const s = await api('/api/fb/status');
    const chip = $('fbStatus');
    chip.className = 'chip' + (s.connected ? ' ok' : ' warn');
    chip.textContent = s.connected ? `Connected ✓ · ${esc(s.page?.name)}` : 'Not connected — paste token';
    const sel = $('fbPages');
    sel.innerHTML = '<option value="">—</option>' + (s.pages || []).map(p =>
      `<option value="${esc(p.id)}" ${p.id === s.page?.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const exp = $('fbExpiry');
    if (s.tokenExpiresAt) {
      const days = Math.round((new Date(s.tokenExpiresAt) - new Date()) / 86400000);
      exp.className = 'chip' + (days < 7 ? ' err' : days < 14 ? ' warn' : ' ok');
      exp.textContent = `Token expires ~${new Date(s.tokenExpiresAt).toLocaleDateString()} (${days}d)`;
    } else exp.textContent = '';
  } catch (e) { $('fbStatus').className = 'chip err'; $('fbStatus').textContent = e.message; }
}

$('fbConnect').onclick = async () => {
  const btn = $('fbConnect');
  btn.disabled = true;
  try {
    await api('/api/fb/connect', { method: 'POST', body: JSON.stringify({ token: $('fbToken').value.trim() }) });
    $('fbToken').value = '';
    refreshFBStatus();
  } catch (e) { $('fbStatus').className = 'chip err'; $('fbStatus').textContent = e.message; }
  btn.disabled = false;
};

$('fbPages').onchange = async () => {
  try { await api('/api/fb/select', { method: 'POST', body: JSON.stringify({ pageId: $('fbPages').value }) }); refreshFBStatus(); }
  catch (e) { $('fbStatus').className = 'chip err'; $('fbStatus').textContent = e.message; }
};

// ---------- Settings ----------

async function loadSettings() {
  try {
    const s = await api('/api/settings');
    $('reelsPerDay').value = s.reels_per_day;
    $('minGap').value = s.min_gap_minutes / 60;
    $('maxGap').value = s.max_gap_minutes / 60;
    $('jitterMin').value = s.jitter_min;
    $('jitterMax').value = s.jitter_max;
    $('autoSchedule').checked = s.auto_schedule;
    renderPatternInputs(s.pattern);
  } catch (e) { $('settingsMsg').className = 'chip err'; $('settingsMsg').textContent = e.message; }
}

function renderPatternInputs(pattern) {
  const n = Number($('reelsPerDay').value);
  const box = $('patternBox');
  box.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const l = document.createElement('label');
    l.textContent = `Post ${i + 1} time`;
    const inp = document.createElement('input');
    inp.type = 'time';
    inp.value = pattern?.[i] || '12:00';
    inp.className = 'pattern-time';
    l.appendChild(inp);
    box.appendChild(l);
  }
}
$('reelsPerDay').onchange = () => renderPatternInputs([...document.querySelectorAll('.pattern-time')].map(x => x.value));

$('learnPattern').onclick = async () => {
  try {
    const { rows } = await api('/api/queue');
    const posted = rows.filter(r => r.status === 'posted' && r.posted_at)
      .map(r => new Date(r.posted_at))
      .sort((a, b) => a - b);
    if (!posted.length) throw new Error('No posted videos yet - pattern learn nahi ho sakta');
    const pattern = [...new Set(posted.map(d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`))].slice(0, 4);
    renderPatternInputs(pattern);
    $('settingsMsg').className = 'chip ok';
    $('settingsMsg').textContent = `Pattern learned: ${pattern.join(', ')}`;
  } catch (e) { $('settingsMsg').className = 'chip err'; $('settingsMsg').textContent = e.message; }
};

$('saveSettings').onclick = async () => {
  try {
    const pattern = [...document.querySelectorAll('.pattern-time')].map(x => x.value).filter(Boolean);
    await api('/api/settings', {
      method: 'POST',
      body: JSON.stringify({
        reels_per_day: Number($('reelsPerDay').value),
        min_gap_minutes: Number($('minGap').value) * 60,
        max_gap_minutes: Number($('maxGap').value) * 60,
        jitter_min: Number($('jitterMin').value),
        jitter_max: Number($('jitterMax').value),
        pattern,
        auto_schedule: $('autoSchedule').checked,
      }),
    });
    $('settingsMsg').className = 'chip ok';
    $('settingsMsg').textContent = 'Settings saved ✓';
  } catch (e) { $('settingsMsg').className = 'chip err'; $('settingsMsg').textContent = e.message; }
};

// ---------- Folder load + upload ----------

$('loadFolder').onclick = async () => {
  const btn = $('loadFolder');
  btn.disabled = true;
  $('uploadMsg').className = 'chip warn';
  $('uploadMsg').textContent = 'Scanning folder...';
  try {
    const r = await api('/api/folder/load', { method: 'POST', body: JSON.stringify({ path: $('folderPath').value.trim() }) });
    const parts = [];
    if (r.queued) parts.push(`${r.queued} queued`);
    if (r.scheduled) parts.push(`${r.scheduled} auto-scheduled`);
    if (r.duplicates) parts.push(`${r.duplicates} duplicate (skip)`);
    if (r.skipped) parts.push(`${r.skipped} non-mp4 (skip)`);
    $('uploadMsg').textContent = parts.join(' · ') || 'Nothing found.';
    $('uploadMsg').className = 'chip ok';
    refreshQueue();
  } catch (e) { $('uploadMsg').className = 'chip err'; $('uploadMsg').textContent = e.message; }
  btn.disabled = false;
};

$('fileInput').onchange = () => uploadFiles($('fileInput').files);
$('dropzone').ondragover = e => { e.preventDefault(); $('dropzone').classList.add('dragover'); };
$('dropzone').ondragleave = () => $('dropzone').classList.remove('dragover');
$('dropzone').ondrop = e => { e.preventDefault(); $('dropzone').classList.remove('dragover'); uploadFiles(e.dataTransfer.files); };

function uploadFiles(fileList) {
  const files = [...fileList];
  const meta = files.find(f => /metadata\.json$/i.test(f.name));
  const vids = files.filter(f => /\.mp4$/i.test(f.name));
  if (!vids.length) { $('uploadMsg').textContent = 'No .mp4 videos found in folder.'; $('uploadMsg').className = 'chip warn'; return; }
  $('uploadMsg').textContent = `Uploading ${vids.length} videos...`;
  $('uploadMsg').className = 'chip warn';
  const fd = new FormData();
  vids.forEach(f => fd.append('files', f, f.name));
  if (meta) fd.append('metadata', meta);
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  supabase.auth.getSession().then(({ data }) => xhr.setRequestHeader('Authorization', `Bearer ${data?.session?.access_token || ''}`));
  $('progressWrap').classList.remove('hidden');
  xhr.upload.onprogress = e => {
    if (e.lengthComputable) $('progressBar').style.width = `${Math.round((e.loaded / e.total) * 100)}%`;
  };
  xhr.onload = () => {
    $('progressWrap').classList.add('hidden');
    const r = JSON.parse(xhr.responseText || '{}');
    if (xhr.status !== 200) { $('uploadMsg').className = 'chip err'; $('uploadMsg').textContent = r.error || 'Upload failed'; return; }
    const parts = [];
    if (r.queued) parts.push(`${r.queued} queued`);
    if (r.scheduled) parts.push(`${r.scheduled} auto-scheduled`);
    if (r.duplicates?.length) parts.push(`${r.duplicates.length} duplicate (skip)`);
    $('uploadMsg').textContent = parts.join(' · ') || 'Nothing happened.';
    $('uploadMsg').className = 'chip ok';
    refreshQueue();
  };
  xhr.onerror = () => { $('progressWrap').classList.add('hidden'); $('uploadMsg').className = 'chip err'; $('uploadMsg').textContent = 'Upload failed'; };
  xhr.send(fd);
}

// ---------- Queue ----------

function rowHtml(r) {
  const st = { queued: ['Queued', ''], posted: ['Posted ✓', 'ok'], failed: ['Failed', 'err'], duplicate: ['Duplicate', 'warn'], processing: ['Posting...', ''] }[r.status] || [r.status, ''];
  const when = new Date(r.scheduled_for);
  const local = new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const canDelete = r.status === 'queued' || r.status === 'failed' || r.status === 'duplicate';
  const postedLink = r.status === 'posted' && r.fb_post_id
    ? `<a class="chip ok" href="https://www.facebook.com/reel/${esc(r.fb_post_id)}" target="_blank">View post ↗</a>`
    : '';
  return `<div class="qrow" data-id="${r.id}">
    <div class="top">
      <input type="checkbox" class="row-check" ${!canDelete ? 'disabled' : ''}>
      <video class="thumb" src="/uploads/${r.id}#t=0.1" muted preload="metadata"></video>
      <span class="name">${esc(r.file_name)}</span>
      <span class="chip ${st[1]}">${st[0]}</span>
    </div>
    <textarea data-field="caption">${esc(r.caption)}</textarea>
    <div class="bottom">
      <input type="datetime-local" data-field="scheduled_for" value="${local}">
      <button data-act="now" class="primary" ${r.status !== 'queued' ? 'disabled' : ''}>Post Now</button>
      <button data-act="retry" class="secondary" ${r.status !== 'failed' ? 'disabled' : ''}>Retry</button>
      <button data-act="del" class="secondary" ${!canDelete ? 'disabled' : ''}>Delete</button>
      ${postedLink}
      ${r.error ? `<span class="chip err">${esc(r.error)}</span>` : ''}
    </div></div>`;
}

async function refreshQueue() {
  try {
    const { rows } = await api('/api/queue');
    const pending = rows.filter(r => r.status === 'queued').length;
    const posted = rows.filter(r => r.status === 'posted').length;
    const failed = rows.filter(r => r.status === 'failed').length;
    $('queueCount').textContent = `${pending} pending · ${posted} posted · ${failed} failed`;
    $('queueList').innerHTML = rows.length ? rows.map(rowHtml).join('') : '<p class="sub">No videos — load a folder.</p>';

    const selectAll = $('selectAll');
    const deleteSelected = $('deleteSelected');
    const checkboxes = document.querySelectorAll('.row-check:not(:disabled)');
    function updateDeleteBtn() {
      const checked = document.querySelectorAll('.row-check:checked').length;
      deleteSelected.disabled = checked === 0;
      selectAll.checked = checked === checkboxes.length && checkboxes.length > 0;
      selectAll.indeterminate = checked > 0 && checked < checkboxes.length;
    }
    selectAll.onchange = () => { checkboxes.forEach(cb => { cb.checked = selectAll.checked; }); updateDeleteBtn(); };
    checkboxes.forEach(cb => { cb.onchange = updateDeleteBtn; });
    deleteSelected.onclick = async () => {
      const ids = [...document.querySelectorAll('.row-check:checked')].map(cb => cb.closest('.qrow').dataset.id);
      for (const id of ids) await api(`/api/queue/${id}`, { method: 'DELETE' });
      refreshQueue();
    };

    document.querySelectorAll('.qrow').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('[data-act=now]').onclick = async () => { await api(`/api/queue/${id}/now`, { method: 'POST' }); refreshQueue(); };
      row.querySelector('[data-act=retry]').onclick = async () => { await api(`/api/queue/${id}/retry`, { method: 'POST' }); refreshQueue(); };
      row.querySelector('[data-act=del]').onclick = async () => { await api(`/api/queue/${id}`, { method: 'DELETE' }); refreshQueue(); };
      const when = row.querySelector('[data-field=scheduled_for]');
      when.onchange = async () => { await api(`/api/queue/${id}/schedule`, { method: 'PATCH', body: JSON.stringify({ scheduled_for: new Date(when.value).toISOString() }) }); refreshQueue(); };
      const cap = row.querySelector('[data-field=caption]');
      cap.onchange = async () => { await api(`/api/queue/${id}/caption`, { method: 'PATCH', body: JSON.stringify({ caption: cap.value }) }); };
    });
  } catch (e) { $('queueList').innerHTML = `<p class="chip err">${esc(e.message)}</p>`; }
}

$('postAll').onclick = async () => {
  const { rows } = await api('/api/queue');
  for (const r of rows.filter(r => r.status === 'queued')) await api(`/api/queue/${r.id}/now`, { method: 'POST' });
  refreshQueue();
};

$('loginEmailBtn').onclick = async () => {
  const msg = $('loginMsg');
  msg.className = 'chip warn';
  msg.textContent = 'Logging in...';
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: $('loginEmail').value.trim(), password: $('loginPassword').value });
    if (error) throw error;
    msg.textContent = '';
  } catch (e) { msg.className = 'chip err'; msg.textContent = e.message; }
};
$('loginEmail').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginEmailBtn').click(); });
$('loginPassword').addEventListener('keydown', e => { if (e.key === 'Enter') $('loginEmailBtn').click(); });

setInterval(refreshQueue, 5000);