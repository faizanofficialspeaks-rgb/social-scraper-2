import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cfg = await (await fetch('/api/config')).json();
const supabase = createClient(cfg.url, cfg.anon);
let user = null;

const $ = id => document.getElementById(id);
const api = async (path, opts = {}) => {
  const headers = { ...(opts.body && !(opts.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) };
  if (user) headers.Authorization = `Bearer ${user.access_token}`;
  const res = await fetch(path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function refreshAuth() {
  const { data } = await supabase.auth.getSession();
  user = data.session || null;
  const box = $('authBox');
  if (user) {
    box.innerHTML = `<span style="font-size:13px">${esc(user.user.email)}</span> <button id="logout">Logout</button>`;
    $('logout').onclick = () => supabase.auth.signOut().then(refreshAuth);
    $('app').classList.remove('hidden');
    $('loginPrompt').classList.add('hidden');
    refreshFBStatus();
    refreshQueue();
  } else {
    box.innerHTML = '';
    $('app').classList.add('hidden');
    $('loginPrompt').classList.remove('hidden');
  }
}

async function refreshFBStatus() {
  const chip = $('fbStatus');
  try {
    const s = await api('/api/fb/status');
    chip.className = 'chip' + (s.connected ? ' ok' : ' warn');
    chip.textContent = s.connected ? `Connected ✓ · ${esc(s.page.name)}` : 'Connected nahi — token paste karo';
  } catch (e) { chip.className = 'chip err'; chip.textContent = e.message; }
}

function rowHtml(r) {
  const st = { queued: ['Queued', ''], posted: ['Posted ✓', 'ok'], failed: ['Failed', 'err'], duplicate: ['Duplicate', 'warn'], processing: ['Posting...', ''] }[r.status] || [r.status, ''];
  const when = new Date(r.scheduled_for);
  const local = new Date(when.getTime() - when.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return `<div class="qrow" data-id="${r.id}">
    <div class="top"><span class="name">${esc(r.file_name)}</span><span class="chip ${st[1]}">${st[0]}</span></div>
    <textarea data-field="caption">${esc(r.caption)}</textarea>
    <div class="bottom">
      <input type="datetime-local" data-field="scheduled_for" value="${local}">
      <button data-act="now" class="primary" ${r.status !== 'queued' ? 'disabled' : ''}>Post Now</button>
      <button data-act="del" ${r.status !== 'queued' ? 'disabled' : ''}>Delete</button>
      ${r.error ? `<span class="chip err">${esc(r.error)}</span>` : ''}
    </div></div>`;
}

async function refreshQueue() {
  try {
    const { rows } = await api('/api/queue');
    $('queueCount').textContent = rows.filter(r => r.status === 'queued').length + ' pending';
    $('queueList').innerHTML = rows.length ? rows.map(rowHtml).join('') : '<p class="sub">Koi videos nahi — folder drop karo.</p>';
    document.querySelectorAll('.qrow').forEach(row => {
      const id = row.dataset.id;
      row.querySelector('[data-act=now]').onclick = async () => { await api(`/api/queue/${id}/now`, { method: 'POST' }); refreshQueue(); };
      row.querySelector('[data-act=del]').onclick = async () => { await api(`/api/queue/${id}`, { method: 'DELETE' }); refreshQueue(); };
      const when = row.querySelector('[data-field=scheduled_for]');
      when.onchange = async () => { await api(`/api/queue/${id}/schedule`, { method: 'PATCH', body: JSON.stringify({ scheduled_for: new Date(when.value).toISOString() }) }); refreshQueue(); };
      const cap = row.querySelector('[data-field=caption]');
      cap.onchange = async () => { await api(`/api/queue/${id}/caption`, { method: 'PATCH', body: JSON.stringify({ caption: cap.value }) }); };
    });
  } catch (e) { $('queueList').innerHTML = `<p class="chip err">${esc(e.message)}</p>`; }
}

$('loginBtn').onclick = () => supabase.auth.signInWithOAuth({ provider: 'google' });
$('fbConnect').onclick = async () => {
  const btn = $('fbConnect');
  btn.disabled = true;
  try { await api('/api/fb/connect', { method: 'POST', body: JSON.stringify({ token: $('fbToken').value.trim() }) }); $('fbToken').value = ''; refreshFBStatus(); }
  catch (e) { $('fbStatus').className = 'chip err'; $('fbStatus').textContent = e.message; }
  btn.disabled = false;
};

$('fileInput').onchange = () => uploadFiles($('fileInput').files);
$('dropzone').ondragover = e => { e.preventDefault(); $('dropzone').classList.add('dragover'); };
$('dropzone').ondragleave = () => $('dropzone').classList.remove('dragover');
$('dropzone').ondrop = e => { e.preventDefault(); $('dropzone').classList.remove('dragover'); uploadFiles(e.dataTransfer.files); };

async function uploadFiles(fileList) {
  const files = [...fileList];
  const meta = files.find(f => /metadata\.json$/i.test(f.name));
  const vids = files.filter(f => /\.mp4$/i.test(f.name));
  $('uploadMsg').textContent = vids.length ? `Uploading ${vids.length} videos...` : 'Koi .mp4 video nahi mila folder mein.';
  $('uploadMsg').className = 'chip warn';
  const fd = new FormData();
  vids.forEach(f => fd.append('files', f, f.name));
  if (meta) fd.append('metadata', await meta.text());
  try {
    const r = await api('/api/upload', { method: 'POST', body: fd });
    const parts = [];
    if (r.rows.length) parts.push(`${r.rows.length} queued`);
    if (r.duplicates.length) parts.push(`${r.duplicates.length} duplicate (skip)`);
    if (r.skipped.length) parts.push(`${r.skipped.length} skipped (non-mp4)`);
    $('uploadMsg').textContent = parts.join(' · ') || 'Kuch nahi hua.';
    $('uploadMsg').className = r.duplicates.length || r.skipped.length ? 'chip warn' : 'chip ok';
    refreshQueue();
  } catch (e) { $('uploadMsg').className = 'chip err'; $('uploadMsg').textContent = e.message; }
}

$('postAll').onclick = async () => {
  const { rows } = await api('/api/queue');
  for (const r of rows.filter(r => r.status === 'queued')) await api(`/api/queue/${r.id}/now`, { method: 'POST' });
  refreshQueue();
};

supabase.auth.onAuthStateChange(() => refreshAuth());
refreshAuth();
setInterval(refreshQueue, 5000);