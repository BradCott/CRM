// ── Config ────────────────────────────────────────────────────────────────────
// Replace with your deployed Google Apps Script web app URL (same as app.js).
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwSreJEU5kPtUM_wNmHq2XWgZ74aH3WlJw7kVLVtr0Hfba7aS_E1eUw6KDISkw3_do/exec';

// This password is also sent to the Apps Script as the admin key, so only
// full registration data (including email/phone) is returned for this key.
// Change both here AND in gas-webhook.gs → ADMIN_KEY.
const ADMIN_PASSWORD = 'DougRemer86!';

// ── Auth ──────────────────────────────────────────────────────────────────────
const loginScreen = document.getElementById('login-screen');
const adminPanel  = document.getElementById('admin-panel');
const loginError  = document.getElementById('login-error');
const pwInput     = document.getElementById('admin-pw');

function showPanel() {
  loginScreen.classList.add('hidden');
  adminPanel.classList.remove('hidden');
  loadRegistrations();
}

// Persist auth for the browser session so a refresh doesn't log out.
if (sessionStorage.getItem('hoa-admin-auth') === 'ok') {
  showPanel();
}

document.getElementById('login-btn').addEventListener('click', attemptLogin);
pwInput.addEventListener('keydown', e => { if (e.key === 'Enter') attemptLogin(); });

function attemptLogin() {
  if (pwInput.value === ADMIN_PASSWORD) {
    sessionStorage.setItem('hoa-admin-auth', 'ok');
    loginError.classList.add('hidden');
    showPanel();
  } else {
    loginError.classList.remove('hidden');
    pwInput.value = '';
    pwInput.focus();
  }
}

document.getElementById('logout-btn').addEventListener('click', () => {
  sessionStorage.removeItem('hoa-admin-auth');
  location.reload();
});

// ── Data loading ──────────────────────────────────────────────────────────────
let allRegistrations = [];

async function loadRegistrations() {
  const tbody  = document.getElementById('reg-tbody');
  const empty  = document.getElementById('admin-empty');
  const stats  = document.getElementById('admin-stats');

  tbody.innerHTML = '<tr><td colspan="8" style="padding:16px;color:#6c757d;">Loading…</td></tr>';
  empty.classList.add('hidden');
  stats.innerHTML = '';

  try {
    const res  = await fetch(
      `${WEBHOOK_URL}?action=getAll&adminKey=${encodeURIComponent(ADMIN_PASSWORD)}`
    );
    const data = await res.json();

    if (!data.success) {
      tbody.innerHTML = `<tr><td colspan="8" style="padding:16px;color:#c0392b;">
        ${escHtml(data.error || 'Failed to load data.')}</td></tr>`;
      return;
    }

    allRegistrations = data.registrations || [];
    renderTable(allRegistrations);
    renderStats(allRegistrations);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:16px;color:#c0392b;">
      Network error — could not reach the data endpoint.</td></tr>`;
    console.error(err);
  }
}

// ── Table rendering ───────────────────────────────────────────────────────────
function renderTable(rows) {
  const tbody = document.getElementById('reg-tbody');
  const empty = document.getElementById('admin-empty');

  if (!rows.length) {
    tbody.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  // Sort by lot number ascending
  const sorted = [...rows].sort((a, b) => Number(a.lot) - Number(b.lot));

  tbody.innerHTML = sorted.map(r => {
    const badgeClass = r.support === 'Yes'
      ? 'support-yes'
      : r.support === 'Want to learn more'
        ? 'support-learn'
        : 'support-none';

    const date = r.timestamp
      ? new Date(r.timestamp).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric',
        })
      : '—';

    return `<tr>
      <td><strong>Lot ${escHtml(String(r.lot))}</strong></td>
      <td>${escHtml(r.firstName)}</td>
      <td>${escHtml(r.lastName)}</td>
      <td><a href="mailto:${escHtml(r.email)}">${escHtml(r.email)}</a></td>
      <td>${escHtml(r.phone || '—')}</td>
      <td>${escHtml(String(r.years || '—'))}</td>
      <td><span class="support-badge ${badgeClass}">${escHtml(r.support)}</span></td>
      <td>${date}</td>
    </tr>`;
  }).join('');
}

function renderStats(rows) {
  const stats    = document.getElementById('admin-stats');
  const total    = rows.length;
  const yes      = rows.filter(r => r.support === 'Yes').length;
  const learning = rows.filter(r => r.support === 'Want to learn more').length;

  stats.innerHTML = `
    <div class="stat-chip"><strong>${total}</strong> Total registrations</div>
    <div class="stat-chip"><strong>${yes}</strong> Support yes</div>
    <div class="stat-chip"><strong>${learning}</strong> Want to learn more</div>
    <div class="stat-chip"><strong>${31 - total}</strong> Lots remaining</div>
  `;
}

// ── CSV export ────────────────────────────────────────────────────────────────
document.getElementById('export-btn').addEventListener('click', () => {
  if (!allRegistrations.length) return;

  const headers = ['Lot', 'First Name', 'Last Name', 'Email', 'Phone', 'Years at Address', 'Support', 'Submitted'];
  const rows = allRegistrations.map(r => [
    r.lot,
    r.firstName,
    r.lastName,
    r.email,
    r.phone || '',
    r.years || '',
    r.support,
    r.timestamp || '',
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `oakleaf-ridge-registrations-${today()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
