// ── Config ────────────────────────────────────────────────────────────────────
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwSreJEU5kPtUM_wNmHq2XWgZ74aH3WlJw7kVLVtr0Hfba7aS_E1eUw6KDISkw3_do/exec';
const CIRCLE_R    = 48; // radius in SVG units (1092×1092 space) ≈ 38px at max container width

// ── State ─────────────────────────────────────────────────────────────────────
const registrations = {}; // lot number (string) → { firstName, lastName }

// ── Lot circle centers ────────────────────────────────────────────────────────
// cx/cy are in the 1092×1092 image coordinate space, placed over the lot number
// text that is already printed on the aerial photo.
const LOT_ZONES = {
   1: { cx:  48, cy: 251 },
   2: { cx: 186, cy: 240 },
   3: { cx: 229, cy:  76 },
   4: { cx: 382, cy:  76 },
   5: { cx: 360, cy: 186 },
   6: { cx: 306, cy: 284 },
   7: { cx: 328, cy: 437 },
   8: { cx: 295, cy: 350 },
   9: { cx: 229, cy: 350 },
  10: { cx:  44, cy: 393 },
  11: { cx:  44, cy: 590 },
  12: { cx: 153, cy: 579 },
  13: { cx: 218, cy: 557 },
  14: { cx: 306, cy: 644 },
  15: { cx: 339, cy: 688 },
  16: { cx: 513, cy: 557 },
  17: { cx: 415, cy: 513 },
  18: { cx: 513, cy: 437 },
  19: { cx: 612, cy: 339 },
  20: { cx: 601, cy: 229 },
  21: { cx: 568, cy:  44 },
  22: { cx: 863, cy:  33 },
  23: { cx: 841, cy: 153 },
  24: { cx: 830, cy: 328 },
  25: { cx: 841, cy: 481 },
  26: { cx: 732, cy: 612 },
  27: { cx: 765, cy: 841 },
  28: { cx: 863, cy: 623 },
  29: { cx: 623, cy: 852 },
  30: { cx: 470, cy: 852 },
  31: { cx: 317, cy: 863 },
};

// ── SVG helpers ───────────────────────────────────────────────────────────────
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl  = tag => document.createElementNS(SVG_NS, tag);

// ── Map rendering ─────────────────────────────────────────────────────────────
function buildMap() {
  const svg = document.getElementById('lot-svg');
  svg.innerHTML = '';

  for (const [lot, zone] of Object.entries(LOT_ZONES)) {
    const lotNum = Number(lot);

    const g = svgEl('g');
    g.dataset.lot = lotNum;
    g.classList.add('lot-zone');
    g.setAttribute('tabindex', '0');
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', `Lot ${lotNum}`);

    const title = svgEl('title');
    title.textContent = `Lot ${lotNum}`;
    g.appendChild(title);

    const circle = svgEl('circle');
    circle.setAttribute('cx', zone.cx);
    circle.setAttribute('cy', zone.cy);
    circle.setAttribute('r', CIRCLE_R);
    g.appendChild(circle);

    // Lot number — visible in debug mode, confirms circle is over the right number
    const numLabel = svgEl('text');
    numLabel.classList.add('lot-number-label');
    numLabel.setAttribute('x', zone.cx);
    numLabel.setAttribute('y', zone.cy);
    numLabel.setAttribute('text-anchor', 'middle');
    numLabel.setAttribute('dominant-baseline', 'middle');
    numLabel.textContent = lotNum;
    g.appendChild(numLabel);

    // Owner name — centered in circle, visible when registered
    const text = svgEl('text');
    text.classList.add('lot-owner-label');
    text.setAttribute('x', zone.cx);
    text.setAttribute('y', zone.cy);
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

// ── Debug toggle ──────────────────────────────────────────────────────────────
document.getElementById('debug-toggle').addEventListener('click', function () {
  const svg    = document.getElementById('lot-svg');
  const active = svg.classList.toggle('debug');
  this.setAttribute('aria-pressed', active);
  this.textContent = active ? 'Hide zones' : 'Debug zones';
});

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
