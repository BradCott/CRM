// ── Config ────────────────────────────────────────────────────────────────────
// Replace with your deployed Google Apps Script web app URL.
const WEBHOOK_URL = 'https://script.google.com/macros/s/AKfycbwSreJEU5kPtUM_wNmHq2XWgZ74aH3WlJw7kVLVtr0Hfba7aS_E1eUw6KDISkw3_do/exec';

const TOTAL_LOTS = 31;

// ── State ─────────────────────────────────────────────────────────────────────
const registrations = {}; // lot number (string) → { firstName, lastName }

// ── Grid ──────────────────────────────────────────────────────────────────────
function buildGrid() {
  const grid = document.getElementById('lot-grid');
  grid.innerHTML = '';

  for (let i = 1; i <= TOTAL_LOTS; i++) {
    const card = document.createElement('div');
    card.className = 'lot-card';
    card.dataset.lot = i;
    card.setAttribute('role', 'listitem');

    const reg = registrations[String(i)];
    if (reg) {
      applyRegistered(card, reg.firstName, reg.lastName);
    } else {
      card.innerHTML = `
        <span class="lot-number">Lot ${i}</span>
        <span class="lot-hint">Click to register</span>
      `;
    }

    grid.appendChild(card);
  }
}

function applyRegistered(card, firstName, lastName) {
  card.classList.add('registered');
  const lastInitial = lastName ? lastName.trim().charAt(0).toUpperCase() + '.' : '';
  card.innerHTML = `
    <span class="lot-number">Lot ${card.dataset.lot}</span>
    <span class="lot-owner">${escHtml(firstName)} ${escHtml(lastInitial)}</span>
    <span class="lot-check">✓ Registered</span>
  `;
}

// Event delegation — registered cards naturally ignored (no handler fires for them)
document.getElementById('lot-grid').addEventListener('click', e => {
  const card = e.target.closest('.lot-card');
  if (!card || card.classList.contains('registered')) return;
  openModal(Number(card.dataset.lot));
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

  const form   = e.target;
  const btn    = document.getElementById('submit-btn');
  const first  = form.firstName.value.trim();
  const last   = form.lastName.value.trim();
  const email  = form.email.value.trim();
  const phone  = form.phone.value.trim();
  const lot    = form.lotNumber.value;
  const years  = form.years.value.trim();
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
    // mode: 'no-cors' is required because Apps Script redirects POST through
    // script.googleusercontent.com, which causes CORS preflight to fail.
    // The data is still received by the sheet; we optimistically update the UI.
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
  const card = document.querySelector(`.lot-card[data-lot="${lot}"]`);
  if (card) applyRegistered(card, first, last);

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
    // Grid still renders — all lots will appear unregistered until reload.
  }

  statusEl.classList.add('hidden');
  buildGrid();
})();
