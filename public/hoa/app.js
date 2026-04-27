// ── Config ────────────────────────────────────────────────────────────────────
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwSreJEU5kPtUM_wNmHq2XWgZ74aH3WlJw7kVLVtr0Hfba7aS_E1eUw6KDISkw3_do/exec';

// ── State ─────────────────────────────────────────────────────────────────────
const registrations = {}; // lot number (string) → { firstName, lastName }

// ── Lot zone definitions ──────────────────────────────────────────────────────
// Polygon coordinates are in the 1092×1092 image coordinate space.
// cx/cy = label anchor point for the registered-owner name overlay.
const LOT_ZONES = {
   1: { points: "0,135 120,135 120,400 0,400",                          cx: 60,  cy: 268 },
   2: { points: "120,195 380,195 380,385 120,385",                      cx: 250, cy: 290 },
   3: { points: "120,0 380,0 380,195 120,195",                          cx: 250, cy: 98  },
   4: { points: "380,0 600,0 600,195 380,195",                          cx: 490, cy: 98  },
   5: { points: "380,195 575,195 575,300 380,300",                      cx: 478, cy: 248 },
   6: { points: "380,300 525,300 525,490 380,490",                      cx: 453, cy: 395 },
   7: { points: "390,490 495,490 495,630 390,665",                      cx: 443, cy: 568 },
   8: { points: "260,385 380,385 380,545 260,545",                      cx: 320, cy: 465 },
   9: { points: "120,385 260,385 260,545 120,545",                      cx: 190, cy: 465 },
  10: { points: "0,400 120,400 120,545 0,545",                          cx: 60,  cy: 473 },
  11: { points: "0,545 120,545 120,820 0,820",                          cx: 60,  cy: 683 },
  12: { points: "120,545 250,545 250,820 120,820",                      cx: 185, cy: 683 },
  13: { points: "250,545 390,545 390,695 310,820 250,820",              cx: 315, cy: 683 },
  14: { points: "345,665 465,665 465,855 345,855",                      cx: 405, cy: 760 },
  15: { points: "440,640 620,640 620,880 495,925 440,880",              cx: 525, cy: 762 },
  16: { points: "545,595 740,595 740,820 605,875 545,820",              cx: 638, cy: 713 },
  17: { points: "492,492 580,492 580,598 492,598",                      cx: 536, cy: 545 },
  18: { points: "580,412 742,412 742,598 580,598",                      cx: 661, cy: 505 },
  19: { points: "580,280 805,280 805,415 580,415",                      cx: 693, cy: 348 },
  20: { points: "580,145 805,145 805,280 580,280",                      cx: 693, cy: 213 },
  21: { points: "580,0 805,0 805,145 580,145",                          cx: 693, cy: 73  },
  22: { points: "805,0 1092,0 1092,145 805,145",                        cx: 949, cy: 73  },
  23: { points: "805,145 1092,145 1092,295 805,295",                    cx: 949, cy: 220 },
  24: { points: "805,295 1092,295 1092,450 805,450",                    cx: 949, cy: 373 },
  25: { points: "805,450 1092,450 1092,600 805,600",                    cx: 949, cy: 525 },
  26: { points: "740,600 805,600 805,820 740,820",                      cx: 773, cy: 710 },
  27: { points: "740,820 1092,820 1092,1020 740,1020",                  cx: 916, cy: 920 },
  28: { points: "805,600 1092,600 1092,820 805,820",                    cx: 949, cy: 710 },
  29: { points: "545,880 740,880 740,1020 545,1020",                    cx: 643, cy: 950 },
  30: { points: "393,858 545,858 545,1020 393,1020",                    cx: 469, cy: 939 },
  31: { points: "255,872 393,872 393,1020 255,1020",                    cx: 324, cy: 946 },
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

    const poly = svgEl('polygon');
    poly.setAttribute('points', zone.points);
    g.appendChild(poly);

    // Lot number label — always in DOM, visible only in debug mode
    const numLabel = svgEl('text');
    numLabel.classList.add('lot-number-label');
    numLabel.setAttribute('x', zone.cx);
    numLabel.setAttribute('y', zone.cy);
    numLabel.setAttribute('text-anchor', 'middle');
    numLabel.setAttribute('dominant-baseline', 'middle');
    numLabel.textContent = lotNum;
    g.appendChild(numLabel);

    // Owner name label — only visible when registered
    const text = svgEl('text');
    text.classList.add('lot-owner-label');
    text.setAttribute('x', zone.cx);
    text.setAttribute('y', zone.cy + 26); // sit below the lot number in debug
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
