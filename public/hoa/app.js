// ── Config ────────────────────────────────────────────────────────────────────
const WEBHOOK_URL    = 'https://script.google.com/macros/s/AKfycbwSreJEU5kPtUM_wNmHq2XWgZ74aH3WlJw7kVLVtr0Hfba7aS_E1eUw6KDISkw3_do/exec';
const LOT_STORAGE_KEY = 'hoa-lot-polygons';
const REG_CACHE_KEY   = 'hoa-registrations';

// ── State ─────────────────────────────────────────────────────────────────────
const registrations = {}; // lot (string) → { firstName, lastName, firstName2?, lastName2? }

// ── Default lot polygons ──────────────────────────────────────────────────────
function r(x1, y1, x2, y2) {
  return [[x1,y1],[x2,y1],[x2,y2],[x1,y2]];
}
const LOT_ZONES_DEFAULT = {
   1: r(  5,   8, 142, 330),
   2: r(142, 157, 370, 406),
   3: r(142,   8, 370, 157),
   4: r(370,   8, 532, 157),
   5: r(370, 157, 532, 406),
   6: r(370, 406, 532, 551),
   7: r(370, 551, 532, 790),
   8: r(260, 406, 370, 551),
   9: r(142, 406, 260, 551),
  10: r(  5, 330, 142, 551),
  11: r(  5, 551, 142, 957),
  12: r(142, 551, 260, 790),
  13: r(260, 551, 370, 790),
  14: r(142, 790, 370, 957),
  15: r(370, 790, 668, 957),
  16: r(532, 630, 668, 790),
  17: r(532, 551, 668, 630),
  18: r(532, 292, 668, 551),
  19: r(668, 292, 804, 551),
  20: r(532, 157, 804, 292),
  21: r(532,   8, 804, 157),
  22: r(804,   8,1080, 157),
  23: r(804, 157,1080, 292),
  24: r(804, 292,1080, 406),
  25: r(804, 406,1080, 551),
  26: r(668, 551, 804, 790),
  27: r(804, 790,1080, 957),
  28: r(804, 551,1080, 790),
  29: r(532, 957, 668,1082),
  30: r(370, 957, 532,1082),
  31: r(142, 957, 370,1082),
};

function loadLotZones() {
  try {
    const saved = localStorage.getItem(LOT_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      const merged = {};
      for (const lot of Object.keys(LOT_ZONES_DEFAULT)) {
        merged[lot] = parsed[lot] || LOT_ZONES_DEFAULT[lot];
      }
      return merged;
    }
  } catch (e) { /* ignore */ }
  return { ...LOT_ZONES_DEFAULT };
}

// ── Registration cache (localStorage) ────────────────────────────────────────
function saveRegCache() {
  try { localStorage.setItem(REG_CACHE_KEY, JSON.stringify(registrations)); } catch (e) {}
}

function loadRegCache() {
  try {
    const saved = localStorage.getItem(REG_CACHE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      for (const [lot, data] of Object.entries(parsed)) {
        registrations[lot] = data;
      }
    }
  } catch (e) {}
}

// ── SVG helpers ───────────────────────────────────────────────────────────────
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl  = tag => document.createElementNS(SVG_NS, tag);

function ptsToStr(pts) {
  return pts.map(p => p.join(',')).join(' ');
}

function centroid(pts) {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return [Math.round(cx), Math.round(cy)];
}

// ── Map rendering ─────────────────────────────────────────────────────────────
function buildMap() {
  const svg = document.getElementById('lot-svg');
  svg.innerHTML = '';
  const LOT_ZONES = loadLotZones();

  for (const [lot, pts] of Object.entries(LOT_ZONES)) {
    const lotNum = Number(lot);
    const [cx, cy] = centroid(pts);

    const g = svgEl('g');
    g.dataset.lot = lotNum;
    g.classList.add('lot-zone');
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `Lot ${lotNum}`);

    const title = svgEl('title');
    title.textContent = `Lot ${lotNum}`;
    g.appendChild(title);

    const poly = svgEl('polygon');
    poly.setAttribute('points', ptsToStr(pts));
    g.appendChild(poly);

    const numLabel = svgEl('text');
    numLabel.classList.add('lot-number-label');
    numLabel.setAttribute('x', cx);
    numLabel.setAttribute('y', cy);
    numLabel.setAttribute('text-anchor', 'middle');
    numLabel.setAttribute('dominant-baseline', 'middle');
    numLabel.textContent = lotNum;
    g.appendChild(numLabel);

    const text = svgEl('text');
    text.classList.add('lot-owner-label');
    text.setAttribute('x', cx);
    text.setAttribute('y', cy);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'central');
    text.style.display = 'none';
    g.appendChild(text);

    const reg = registrations[String(lotNum)];
    if (reg) applyZoneRegistered(g, reg.firstName, reg.lastName);

    svg.appendChild(g);
  }
}

function applyZoneRegistered(g, firstName, lastName) {
  g.classList.add('registered');
  const text = g.querySelector('.lot-owner-label');
  if (!text) return;
  const lastInitial = lastName ? lastName.trim().charAt(0).toUpperCase() + '.' : '';
  text.textContent = `${firstName} ${lastInitial}`;
  text.style.display = '';
}

function applyRegistered(lotNumber, firstName, lastName) {
  const g = document.querySelector(`#lot-svg [data-lot="${lotNumber}"]`);
  if (g) applyZoneRegistered(g, firstName, lastName);
  buildRoster();
}

// ── Owners roster ─────────────────────────────────────────────────────────────
function buildRoster() {
  const section = document.getElementById('owners-section');
  const tbody   = document.getElementById('owners-tbody');
  const entries = Object.entries(registrations)
    .map(([lot, r]) => ({ lot: Number(lot), ...r }))
    .sort((a, b) => a.lot - b.lot);

  if (entries.length === 0) {
    section.classList.add('hidden');
    return;
  }

  tbody.innerHTML = entries.map(({ lot, firstName, lastName, email, phone, firstName2, lastName2, email2, phone2, kids }) => {
    const name1 = `${escHtml(firstName || '')} ${escHtml(lastName || '')}`.trim();
    const name2 = firstName2 ? `${escHtml(firstName2)} ${escHtml(lastName2 || '')}`.trim() : '';
    const nameCell  = name2 ? `${name1}<br><span class="roster-name2">${name2}</span>` : name1;
    const emailCell = email
      ? `<a href="mailto:${escHtml(email)}">${escHtml(email)}</a>`
        + (email2 ? `<br><a href="mailto:${escHtml(email2)}" class="roster-sub">${escHtml(email2)}</a>` : '')
      : '—';
    const phoneCell = phone
      ? escHtml(phone) + (phone2 ? `<br><span class="roster-sub">${escHtml(phone2)}</span>` : '')
      : (phone2 ? escHtml(phone2) : '—');
    const kidsCell = kids ? escHtml(kids) : '—';
    return `
    <tr>
      <td class="roster-lot">Lot ${lot}</td>
      <td>${nameCell}</td>
      <td class="roster-email">${emailCell}</td>
      <td class="roster-phone">${phoneCell}</td>
      <td class="roster-kids">${kidsCell}</td>
    </tr>`;
  }).join('');

  section.classList.remove('hidden');
}

// ── Map interaction ───────────────────────────────────────────────────────────
document.getElementById('lot-svg').addEventListener('click', e => {
  const g = e.target.closest('.lot-zone');
  if (!g) return;
  openModal(Number(g.dataset.lot));
});

document.getElementById('lot-svg').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const g = document.activeElement;
  if (!g || !g.classList.contains('lot-zone')) return;
  e.preventDefault();
  openModal(Number(g.dataset.lot));
});

// ── Modal ─────────────────────────────────────────────────────────────────────
let activeLot = null;

function openModal(lotNumber) {
  activeLot = lotNumber;
  const existing = registrations[String(lotNumber)];
  const isEdit   = !!existing;

  document.getElementById('modal-lot-label').textContent = `Lot ${lotNumber}`;
  document.getElementById('modal-intro').textContent = isEdit
    ? 'Update your registration below.'
    : 'Your information is shared only with campaign organizers.';
  document.getElementById('submit-btn').textContent = isEdit
    ? 'Update Registration'
    : 'Submit Registration';

  // Reset then pre-fill if editing
  document.getElementById('registration-form').reset();
  document.getElementById('lotNumber').value = lotNumber;
  setMessage('', '');

  if (isEdit) {
    document.getElementById('firstName').value  = existing.firstName  || '';
    document.getElementById('lastName').value   = existing.lastName   || '';
    document.getElementById('email').value      = existing.email      || '';
    document.getElementById('phone').value      = existing.phone      || '';
    document.getElementById('years').value      = existing.years      || '';
    document.getElementById('support').value    = existing.support    || '';
    document.getElementById('firstName2').value = existing.firstName2 || '';
    document.getElementById('lastName2').value  = existing.lastName2  || '';
    document.getElementById('email2').value     = existing.email2     || '';
    document.getElementById('phone2').value     = existing.phone2     || '';
    document.getElementById('kids').value       = existing.kids       || '';
  }

  document.getElementById('modal-overlay').classList.remove('hidden');
  document.getElementById('firstName').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  activeLot = null;
}

function resetForm() {
  const lotVal = document.getElementById('lotNumber').value;
  document.getElementById('registration-form').reset();
  document.getElementById('lotNumber').value = lotVal;
  setMessage('', '');
}

document.getElementById('modal-close').addEventListener('click', closeModal);

document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeModal();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});

// ── Form submission ───────────────────────────────────────────────────────────
document.getElementById('registration-form').addEventListener('submit', async e => {
  e.preventDefault();

  const form    = e.target;
  const btn     = document.getElementById('submit-btn');
  const first   = form.firstName.value.trim();
  const last    = form.lastName.value.trim();
  const email   = form.email.value.trim();
  const phone   = form.phone.value.trim();
  const lot     = form.lotNumber.value;
  const years   = form.years.value.trim();
  const support = form.support.value;
  const first2  = form.firstName2.value.trim();
  const last2   = form.lastName2.value.trim();
  const email2  = form.email2.value.trim();
  const phone2  = form.phone2.value.trim();
  const kids    = form.kids.value.trim();

  if (!first || !last || !email || !support) {
    setMessage('Please fill in all required fields.', 'error');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setMessage('Please enter a valid email address.', 'error');
    return;
  }
  if (email2 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email2)) {
    setMessage('Please enter a valid email for Resident 2.', 'error');
    return;
  }

  const isUpdate = !!registrations[String(lot)];
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  const payload = new URLSearchParams({
    action: isUpdate ? 'update' : 'register',
    firstName: first,
    lastName:  last,
    email,
    phone,
    lot,
    years,
    support,
    firstName2: first2,
    lastName2:  last2,
    email2,
    phone2,
    kids,
  });

  try {
    await fetch(WEBHOOK_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload,
    });
  } catch (err) {
    setMessage('Network error — please check your connection and try again.', 'error');
    btn.disabled    = false;
    btn.textContent = isUpdate ? 'Update Registration' : 'Submit Registration';
    return;
  }

  // Save to state + localStorage
  registrations[String(lot)] = {
    firstName: first, lastName: last,
    email, phone, years, support,
    firstName2: first2 || undefined,
    lastName2:  last2  || undefined,
    email2:     email2 || undefined,
    phone2:     phone2 || undefined,
    kids:       kids   || undefined,
  };
  saveRegCache();
  applyRegistered(lot, first, last);

  setMessage(isUpdate ? 'Updated — thank you!' : 'Registration submitted — thank you!', 'success');
  btn.disabled    = false;
  btn.textContent = isUpdate ? 'Update Registration' : 'Submit Registration';

  setTimeout(closeModal, 1600);
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function setMessage(text, type) {
  const el = document.getElementById('form-message');
  el.textContent = text;
  el.className   = 'form-message' + (type ? ` ${type}` : '');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const statusEl = document.getElementById('grid-status');
  statusEl.classList.remove('hidden');

  // Load from localStorage cache first (instant)
  loadRegCache();

  // Then try to fetch from webhook (overwrites cache with server data)
  try {
    const res  = await fetch(`${WEBHOOK_URL}?action=getRegistrations`);
    const data = await res.json();
    if (data.success && Array.isArray(data.registrations)) {
      // Clear and reload from server
      for (const key of Object.keys(registrations)) delete registrations[key];
      data.registrations.forEach(r => {
        registrations[String(r.lot)] = {
          firstName:  r.firstName,
          lastName:   r.lastName,
          firstName2: r.firstName2 || undefined,
          lastName2:  r.lastName2  || undefined,
          email:      r.email,
          phone:      r.phone,
          years:      r.years,
          support:    r.support,
        };
      });
      saveRegCache();
    }
  } catch (err) {
    console.warn('Could not load registrations from server, using local cache:', err);
  }

  statusEl.classList.add('hidden');
  buildMap();
  buildRoster();
})();
