// Knox CRM — Gmail content script
// Injects a "Knox CRM" chip into each open email's action toolbar. Clicking it
// opens a panel that lets you (1) attach the sender's address to an existing
// CRM contact and (2) log the email onto that contact.

const CRM_URL_KEY = 'knoxCrmUrl'
const CRM_KEY_KEY = 'knoxCrmKey'
let crmUrl = 'http://localhost:3001'
let crmKey = ''

chrome.storage.sync.get([CRM_URL_KEY, CRM_KEY_KEY], (r) => {
  if (r[CRM_URL_KEY]) crmUrl = r[CRM_URL_KEY]
  if (r[CRM_KEY_KEY]) crmKey = r[CRM_KEY_KEY]
})
chrome.storage.onChanged.addListener((c) => {
  if (c[CRM_URL_KEY]) crmUrl = c[CRM_URL_KEY].newValue
  if (c[CRM_KEY_KEY]) crmKey = c[CRM_KEY_KEY].newValue
})

// ── API helpers ─────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(`${crmUrl}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-crm-key': crmKey, ...(opts.headers || {}) },
  })
  return res.json()
}

// ── Polling — inject a chip next to Reply in each email's action toolbar ──────
setInterval(scan, 1000)
scan()

function scan() {
  // Anchor on the Forward button — it only appears in the bottom action toolbar,
  // so the chip lands there rather than in the email header.
  const forwardBtns = [
    ...document.querySelectorAll('[aria-label="Forward"]'),
    ...document.querySelectorAll('[data-tooltip="Forward"]'),
    ...document.querySelectorAll('[title="Forward"]'),
  ]

  for (const fwdBtn of forwardBtns) {
    if (fwdBtn.dataset.knoxDone) continue

    let toolbar = fwdBtn.parentElement
    let replyBtn = null
    for (let i = 0; i < 3; i++) {
      if (!toolbar) break
      replyBtn =
        toolbar.querySelector('[aria-label="Reply"]:not([aria-label*="all"])') ||
        toolbar.querySelector('[data-tooltip="Reply"]') ||
        toolbar.querySelector('[title="Reply"]')
      if (replyBtn) break
      toolbar = toolbar.parentElement
    }
    if (!replyBtn || !toolbar) continue
    if (toolbar.querySelector('.knox-chip')) continue

    fwdBtn.dataset.knoxDone = '1'

    const emailEl =
      fwdBtn.closest('[data-message-id]') ||
      fwdBtn.closest('[data-legacy-message-id]') ||
      null

    replyBtn.insertAdjacentElement('afterend', buildChip(emailEl))
  }
}

// ── Chip ──────────────────────────────────────────────────────────────────────
function buildChip(emailEl) {
  const chip = document.createElement('button')
  chip.className   = 'knox-chip'
  chip.textContent = 'Knox CRM'
  chip.title       = 'Add to / log in Knox CRM'
  chip.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
    togglePanel(chip, emailEl)
  })

  // Reflect known/unknown at a glance once we can read the sender.
  refreshChipState(chip, emailEl)
  return chip
}

async function refreshChipState(chip, emailEl) {
  const data = extractEmailData(emailEl)
  chip._email = data
  if (!crmKey || !data.contactEmail) return
  try {
    const r = await api(`/api/ext/lookup?email=${encodeURIComponent(data.contactEmail)}&name=${encodeURIComponent(data.fromName || '')}`)
    chip._lookup = r
    if (r.matched) {
      chip.classList.add('knox-known')
      chip.textContent = `✓ ${r.matched.name}`
    } else if (r.candidates && r.candidates.length) {
      chip.classList.add('knox-maybe')
      chip.textContent = '＋ Add to CRM'
    } else {
      chip.textContent = 'Knox CRM'
    }
  } catch (_) { /* offline / bad key — leave the neutral chip, panel shows the error */ }
}

// ── Panel ─────────────────────────────────────────────────────────────────────
let openPanel = null

function closePanel() {
  if (openPanel) { openPanel.remove(); openPanel = null }
  document.removeEventListener('mousedown', onDocDown, true)
}
function onDocDown(e) {
  if (openPanel && !openPanel.contains(e.target) && !e.target.classList.contains('knox-chip')) closePanel()
}

async function togglePanel(chip, emailEl) {
  if (openPanel && openPanel._chip === chip) { closePanel(); return }
  closePanel()

  const data = chip._email || extractEmailData(emailEl)
  const panel = document.createElement('div')
  panel.className = 'knox-panel'
  panel._chip = chip
  positionPanel(panel, chip)
  document.body.appendChild(panel)
  openPanel = panel
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0)

  if (!crmKey) {
    panel.innerHTML = row('⚠ Set your CRM server URL and key in the extension popup first.', 'knox-warn')
    return
  }
  if (!data.contactEmail) {
    panel.innerHTML = row('Could not read the sender address from this email.', 'knox-warn')
    return
  }

  panel.innerHTML = `<div class="knox-hd">${esc(data.fromName || data.contactEmail)}<span>${esc(data.contactEmail)}</span></div><div class="knox-bd">Loading…</div>`
  const body = panel.querySelector('.knox-bd')

  let lookup = chip._lookup
  try {
    if (!lookup) lookup = await api(`/api/ext/lookup?email=${encodeURIComponent(data.contactEmail)}&name=${encodeURIComponent(data.fromName || '')}`)
  } catch (_) {
    body.innerHTML = row('CRM unreachable — check the server URL in the popup.', 'knox-warn')
    return
  }

  renderLookup(panel, body, data, lookup, chip)
}

function renderLookup(panel, body, data, lookup, chip) {
  body.innerHTML = ''

  if (lookup.matched) {
    body.appendChild(el(`<div class="knox-line knox-ok">✓ In CRM: <b>${esc(lookup.matched.name)}</b></div>`))
    body.appendChild(logButton(data, lookup.matched.id, chip))
    body.appendChild(searchBlock(panel, body, data, chip, 'Log to a different contact'))
    return
  }

  // Unknown address → offer to attach it to a contact, then log.
  const head = lookup.candidates && lookup.candidates.length
    ? `Add <b>${esc(data.contactEmail)}</b> to:`
    : `No contact has this address. Search to attach it:`
  body.appendChild(el(`<div class="knox-line">${head}</div>`))

  for (const c of (lookup.candidates || [])) {
    body.appendChild(candidateRow(c, data, panel, body, chip))
  }
  body.appendChild(searchBlock(panel, body, data, chip, lookup.candidates?.length ? 'Search for someone else' : 'Search contacts'))
}

function candidateRow(person, data, panel, body, chip) {
  const sub = [person.city, person.state].filter(Boolean).join(', ')
  const btn = el(`<button class="knox-cand"><span><b>${esc(person.name)}</b>${sub ? ` · ${esc(sub)}` : ''}</span><small>${person.email ? esc(person.email) : 'no email on file'}</small></button>`)
  btn.addEventListener('click', () => attachThenLog(person, data, panel, body, chip))
  return btn
}

function searchBlock(panel, body, data, chip, label) {
  const wrap = el(`<div class="knox-search"><div class="knox-line knox-muted">${label}</div><input class="knox-input" placeholder="Type a name…" /><div class="knox-results"></div></div>`)
  const input   = wrap.querySelector('input')
  const results = wrap.querySelector('.knox-results')
  let t = null
  input.addEventListener('input', () => {
    clearTimeout(t)
    const q = input.value.trim()
    if (q.length < 2) { results.innerHTML = ''; return }
    t = setTimeout(async () => {
      try {
        const rows = await api(`/api/ext/search?q=${encodeURIComponent(q)}`)
        results.innerHTML = ''
        for (const p of rows) results.appendChild(candidateRow(p, data, panel, body, chip))
        if (!rows.length) results.innerHTML = '<div class="knox-line knox-muted">No matches</div>'
      } catch (_) { results.innerHTML = '<div class="knox-line knox-warn">Search failed</div>' }
    }, 250)
  })
  return wrap
}

async function attachThenLog(person, data, panel, body, chip) {
  body.innerHTML = ''
  const status = el(`<div class="knox-line">Attaching to <b>${esc(person.name)}</b>…</div>`)
  body.appendChild(status)
  try {
    const r = await api('/api/ext/attach-email', {
      method: 'POST',
      body: JSON.stringify({ person_id: person.id, email: data.contactEmail }),
    })
    if (!r.ok) { status.className = 'knox-line knox-warn'; status.textContent = `✗ ${r.error}`; return }
    const note = r.already ? 'already on file' : (r.slot === 'email2' ? 'saved as 2nd email' : 'saved')
    status.className = 'knox-line knox-ok'
    status.innerHTML = `✓ ${esc(person.name)} — ${note}`
    body.appendChild(logButton(data, person.id, chip))
    // Reflect the new link on the chip.
    chip.classList.remove('knox-maybe'); chip.classList.add('knox-known')
    chip.textContent = `✓ ${person.name}`
    chip._lookup = { matched: { id: person.id, name: person.name }, candidates: [] }
  } catch (_) {
    status.className = 'knox-line knox-warn'; status.textContent = '✗ CRM unreachable'
  }
}

function logButton(data, personId, chip) {
  const btn = el('<button class="knox-primary">Log this email</button>')
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Logging…'
    try {
      const r = await api('/api/ext/log', {
        method: 'POST',
        body: JSON.stringify({
          person_id:        personId,
          gmail_message_id: data.legacyId || null,
          thread_id:        data.threadId || null,
          subject:          data.subject,
          body_preview:     data.bodyPreview,
          direction:        data.direction,
          date:             data.dateIso,
          from_address:     data.fromDisplay,
          to_address:       data.toEmail,
        }),
      })
      if (r.ok) {
        btn.className = 'knox-primary knox-done'
        btn.textContent = r.duplicate ? '✓ Already logged' : `✓ Logged to ${r.personName}`
      } else {
        btn.className = 'knox-primary knox-warn'; btn.textContent = `✗ ${r.error}`; btn.disabled = false
      }
    } catch (_) {
      btn.className = 'knox-primary knox-warn'; btn.textContent = '✗ CRM unreachable'; btn.disabled = false
    }
  })
  return btn
}

// ── Email data extraction ─────────────────────────────────────────────────────
function extractEmailData(emailEl) {
  const root = emailEl || document

  const allEmailEls = Array.from(root.querySelectorAll('[email]'))
  const senderEl    = allEmailEls[0] || null
  const fromEmail   = (senderEl?.getAttribute('email') || '').toLowerCase().trim()
  const fromName    = senderEl?.getAttribute('name') || senderEl?.textContent?.trim() || fromEmail
  const toEmail     = (allEmailEls[1]?.getAttribute('email') || '').toLowerCase().trim()

  const subject =
    document.querySelector('h2[data-thread-perm-id]')?.textContent?.trim() ||
    document.querySelector('h2')?.textContent?.trim() || ''

  let dateIso = new Date().toISOString()
  for (const el of Array.from(root.querySelectorAll('[title]'))) {
    const t = el.getAttribute('title') || ''
    if (/\d{4}/.test(t)) {
      const parsed = new Date(t)
      if (!isNaN(parsed)) { dateIso = parsed.toISOString(); break }
    }
  }

  let bodyPreview = ''
  const bodyEl = root.querySelector('[dir="ltr"]') || root.querySelector('.a3s') || null
  if (bodyEl) {
    const clone = bodyEl.cloneNode(true)
    clone.querySelectorAll('.gmail_quote, blockquote, style, script').forEach(n => n.remove())
    bodyPreview = (clone.innerText || '').trim().slice(0, 8000)
  }

  const myEmail = (
    document.querySelector('a[aria-label*="Google Account"]')?.getAttribute('aria-label')?.match(/\(([^)]+)\)/)?.[1] ||
    document.querySelector('[data-email]')?.getAttribute('data-email') || ''
  ).toLowerCase().trim()

  const direction    = myEmail && fromEmail === myEmail ? 'outbound' : 'inbound'
  const contactEmail = direction === 'inbound' ? fromEmail : toEmail

  // Gmail's legacy message id equals the Gmail API id, so logging here dedupes
  // against the background sync.
  const legacyId =
    emailEl?.getAttribute?.('data-legacy-message-id') ||
    emailEl?.getAttribute?.('data-message-id') || null
  const threadId = document.querySelector('[data-thread-perm-id]')?.getAttribute('data-thread-perm-id') || null

  return {
    contactEmail, fromEmail, toEmail, fromName, subject, dateIso, bodyPreview, direction,
    legacyId, threadId,
    fromDisplay: fromName && fromName !== fromEmail ? `${fromName} <${fromEmail}>` : fromEmail,
  }
}

// ── Tiny DOM helpers ────────────────────────────────────────────────────────
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild }
function row(text, cls = '') { return `<div class="knox-line ${cls}">${esc(text)}</div>` }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }

function positionPanel(panel, chip) {
  const r = chip.getBoundingClientRect()
  panel.style.position = 'fixed'
  panel.style.top  = `${Math.min(r.bottom + 6, window.innerHeight - 40)}px`
  panel.style.left = `${Math.min(r.left, window.innerWidth - 320)}px`
}
