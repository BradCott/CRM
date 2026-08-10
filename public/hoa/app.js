// ── Config ────────────────────────────────────────────────────────────────────
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwSreJEU5kPtUM_wNmHq2XWgZ74aH3WlJw7kVLVtr0Hfba7aS_E1eUw6KDISkw3_do/exec';
const LOT_STORAGE_KEY = 'hoa-lot-polygons';

// ── State ─────────────────────────────────────────────────────────────────────
const registrations = {}; // lot number (string) → { firstName, lastName }

// ── Default lot polygons ──────────────────────────────────────────────────────
// Each lot is an array of [x,y] corner points in the 1092×1092 SVG coordinate space.
// These are rectangles approximated from the aerial photo boundary lines.
// Use calibrate.html to drag corners into precise positions.
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

// Load saved polygon positions from localStorage (admin edits via calibrate.html)
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

    // Lot number — visible in debug mode
    const numLabel = svgEl('text');
    numLabel.classList.add('lot-number-label');
    numLabel.setAttribute('x', cx);
    numLabel.setAttribute('y', cy);
    numLabel.setAttribute('text-anchor', 'middle');
    numLabel.setAttribute('dominant-baseline', 'middle');
    numLabel.textContent = lotNum;
    g.appendChild(numLabel);

    // Owner name — centered in polygon, visible when registered
    const text = svgEl('text');
    text.classList.add('lot-owner-label');
    text.setAttribute('x', cx);
    text.setAttribute('y', cy);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('dominant-baseline', 'middle');
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
  text.textContent = `${escHtml(firstName)} ${escHtml(lastInitial)}`;
  text.style.display = '';
}

// Public entry point called after form submission
function applyRegistered(lotNumber, firstName, lastName) {
  const g = document.querySelector(`#lot-svg [data-lot="${lotNumber}"]`);
  if (g) applyZoneRegistered(g, firstName, lastName);
}

// ── Map interaction ───────────────────────────────────────────────────────────
document.getElementById('lot-svg').addEventListener('click', e => {
  const g = e.target.closest('.lot-zone');
  if (!g || g.classList.contains('registered')) return;
  openModal(Number(g.dataset.lot));
});

document.getElementById('lot-svg').addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const g = document.activeElement;
  if (!g || !g.classList.contains('lot-zone') || g.classList.contains('registered')) return;
  e.preventDefault();
  openModal(Number(g.dataset.lot));
});

// ── Modal ─────────────────────────────────────────────────────────────────────
let activeLot = null;

function openModal(lotNumber) {
  activeLot = lotNumber;
  document.getElementById('modal-lot-label').textContent = `Lot ${lotNumber}`;
  document.getElementById('lotNumber').value = lotNumber;
  resetForm();
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

  if (!first || !last || !email || !support) {
    setMessage('Please fill in all required fields.', 'error');
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setMessage('Please enter a valid email address.', 'error');
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Submitting…';

  const payload = new URLSearchParams({
    action: 'register',
    firstName: first,
    lastName: last,
    email,
    phone,
    lot,
    years,
    support,
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
    btn.textContent = 'Submit Registration';
    return;
  }

  // Optimistic UI update
  registrations[String(lot)] = { firstName: first, lastName: last };
  applyRegistered(lot, first, last);

  setMessage('Registration submitted — thank you!', 'success');
  btn.disabled    = false;
  btn.textContent = 'Submit Registration';

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

  try {
    const res  = await fetch(`${WEBHOOK_URL}?action=getRegistrations`);
    const data = await res.json();
    if (data.success && Array.isArray(data.registrations)) {
      data.registrations.forEach(r => {
        registrations[String(r.lot)] = {
          firstName: r.firstName,
          lastName:  r.lastName,
        };
      });
    }
  } catch (err) {
    console.warn('Could not load existing registrations:', err);
  }

  statusEl.classList.add('hidden');
  buildMap();
})();
