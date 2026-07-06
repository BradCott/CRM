// Knox CRM — Gmail content script
// A floating "Knox CRM" button sits in the bottom-right of Gmail. Click it while
// reading an email to (1) attach the sender's address to an existing CRM contact
// and (2) log the email onto that contact. No dependency on Gmail's own buttons.

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

// DOM-visible marker so we can confirm the script loaded from the page console.
document.documentElement.setAttribute('data-knox-loaded', '1')

// Broad territory regions (mirror of the CRM's list).
const REGIONS = ['Nationwide', 'Northeast', 'Southeast', 'Midwest', 'Southwest', 'West']

async function api(path, opts = {}) {
  const res = await fetch(`${crmUrl}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-crm-key': crmKey, ...(opts.headers || {}) },
  })
  return res.json()
}

// ── Floating button ───────────────────────────────────────────────────────────
function ensureFab() {
  if (document.getElementById('knox-fab')) return
  if (!document.body) return
  const fab = document.createElement('button')
  fab.id = 'knox-fab'
  fab.className = 'knox-fab'
  fab.textContent = 'Knox CRM'
  fab.title = 'Add sender / log this email to Knox CRM'
  fab.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onFabClick(fab) })
  document.body.appendChild(fab)
}
setInterval(ensureFab, 1500)
ensureFab()

// The most recently rendered message in the open conversation.
function currentMessageEl() {
  const msgs = Array.from(document.querySelectorAll('[data-message-id], [data-legacy-message-id]'))
  return msgs.length ? msgs[msgs.length - 1] : null
}

// ── Panel ─────────────────────────────────────────────────────────────────────
let openPanel = null

function closePanel() {
  if (openPanel) { openPanel.remove(); openPanel = null }
  document.removeEventListener('mousedown', onDocDown, true)
}
function onDocDown(e) {
  if (openPanel && !openPanel.contains(e.target) && e.target.id !== 'knox-fab') closePanel()
}

async function onFabClick(fab) {
  if (openPanel) { closePanel(); return }

  const panel = document.createElement('div')
  panel.className = 'knox-panel'
  panel._anchor = fab
  document.body.appendChild(panel)
  openPanel = panel
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0)

  if (!crmKey) {
    panel.innerHTML = wrapHd('Not set up', '') + `<div class="knox-bd">${row('⚠ Open the extension popup (puzzle-piece icon) and set the CRM URL + key first.', 'knox-warn')}</div>`
    return
  }

  const data = extractEmailData(currentMessageEl())
  if (!data.contactEmail) {
    panel.innerHTML = wrapHd('No email open', '') + `<div class="knox-bd">${row('Open an email (click one so you\'re reading it), then click Knox CRM again.', 'knox-warn')}</div>`
    return
  }

  panel.innerHTML = wrapHd(data.contactName || data.contactEmail, data.contactEmail) + `<div class="knox-bd">Loading…</div>`
  const body = panel.querySelector('.knox-bd')

  let lookup
  try {
    lookup = await api(`/api/ext/lookup?email=${encodeURIComponent(data.contactEmail)}&name=${encodeURIComponent(data.contactName || '')}`)
  } catch (_) {
    body.innerHTML = row('CRM unreachable — check the server URL/key in the popup.', 'knox-warn')
    return
  }
  if (lookup && lookup.error) {
    body.innerHTML = row(`✗ ${lookup.error}`, 'knox-warn')
    return
  }

  renderLookup(body, data, lookup, fab)
}

function renderLookup(body, data, lookup, fab) {
  body.innerHTML = ''

  if (lookup.matched) {
    body.appendChild(el(`<div class="knox-line knox-ok">✓ In CRM: <b>${esc(lookup.matched.name)}</b></div>`))
    body.appendChild(logButton(data, lookup.matched.id, fab))
    const ph = addPhoneButton(lookup.matched, data)
    if (ph) body.appendChild(ph)
    body.appendChild(searchBlock(body, data, fab, 'Log to a different contact'))
    body.appendChild(createContactBtn(body, data, fab))
    return
  }

  const head = lookup.candidates && lookup.candidates.length
    ? `<b>${esc(data.contactName || data.contactEmail)}</b> isn't in the CRM — add new, or link to:`
    : `<b>${esc(data.contactName || data.contactEmail)}</b> isn't in the CRM yet.`
  body.appendChild(el(`<div class="knox-line">${head}</div>`))

  // "Add as new" is the primary action for an unknown sender — show it first.
  body.appendChild(createContactBtn(body, data, fab))

  for (const c of (lookup.candidates || [])) body.appendChild(candidateRow(c, data, body, fab))
  body.appendChild(searchBlock(body, data, fab, lookup.candidates?.length ? 'Or search for someone else' : 'Or search contacts'))
}

function createContactBtn(body, data, fab) {
  const b = el('<button class="knox-primary knox-alt">＋ New tenant contact</button>')
  b.addEventListener('click', () => openCreateForm(body, data, fab))
  return b
}

// ── Create a tenant contact from the open email ──────────────────────────────
function fieldInput(label, val) {
  const row = el(`<label class="knox-field"><span>${esc(label)}</span><input class="knox-input" /></label>`)
  const input = row.querySelector('input'); input.value = val || ''
  return { row, input }
}
function chipToggle(label, set) {
  const b = el(`<button type="button" class="knox-toggle">${esc(label)}</button>`)
  b.addEventListener('click', () => {
    if (set.has(label)) { set.delete(label); b.classList.remove('on') }
    else { set.add(label); b.classList.add('on') }
  })
  return b
}

async function openCreateForm(body, data, fab) {
  body.innerHTML = ''
  body.appendChild(el('<div class="knox-line knox-muted">New tenant contact</div>'))

  const nameI  = fieldInput('Name', data.contactName || data.contactEmail)
  const phoneI = fieldInput('Phone', data.phone || '')
  const tenantI = fieldInput('Tenant (company)', '')
  const titleI = fieldInput('Title', '')
  const statesI = fieldInput('States (comma-sep, e.g. TN, GA)', '')

  const datalist = el('<datalist id="knox-brands"></datalist>')
  tenantI.input.setAttribute('list', 'knox-brands')

  const emailNote  = el(`<div class="knox-sub">${esc(data.contactEmail)}</div>`)
  const rolesBox   = el('<div><div class="knox-sub">Roles</div><div class="knox-chips"></div></div>')
  const regionsBox = el('<div><div class="knox-sub">Regions</div><div class="knox-chips"></div></div>')
  const saveBtn    = el('<button class="knox-primary">Create + log email</button>')

  body.append(nameI.row, emailNote, phoneI.row, tenantI.row, datalist, titleI.row, rolesBox, regionsBox, statesI.row, saveBtn)

  const roles = new Set(), regions = new Set()
  for (const rg of REGIONS) regionsBox.querySelector('.knox-chips').appendChild(chipToggle(rg, regions))
  try {
    const [roleTypes, brands] = await Promise.all([api('/api/ext/roles'), api('/api/ext/brands')])
    for (const rt of roleTypes) rolesBox.querySelector('.knox-chips').appendChild(chipToggle(rt.label, roles))
    for (const br of brands) { const o = document.createElement('option'); o.value = br.name; datalist.appendChild(o) }
  } catch (_) { /* offline — the form still works for name/email */ }

  saveBtn.addEventListener('click', async () => {
    const nm = nameI.input.value.trim()
    if (!nm) { nameI.input.focus(); return }
    saveBtn.disabled = true; saveBtn.textContent = 'Creating…'
    const states = statesI.input.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    try {
      const r = await api('/api/ext/create-contact', {
        method: 'POST',
        body: JSON.stringify({
          name: nm, email: data.contactEmail, phone: phoneI.input.value.trim(), title: titleI.input.value.trim(),
          tenant_brand_name: tenantI.input.value.trim(),
          tenant_roles: [...roles], territory_states: states, territory_regions: [...regions],
        }),
      })
      if (r.ok) {
        body.innerHTML = ''
        body.appendChild(el(`<div class="knox-line knox-ok">✓ Created <b>${esc(r.personName)}</b></div>`))
        body.appendChild(logButton(data, r.personId, fab))
        fab.textContent = `✓ ${r.personName}`
      } else {
        saveBtn.className = 'knox-primary knox-warn'; saveBtn.textContent = `✗ ${r.error}`; saveBtn.disabled = false
      }
    } catch (_) {
      saveBtn.className = 'knox-primary knox-warn'; saveBtn.textContent = '✗ CRM unreachable'; saveBtn.disabled = false
    }
  })
}

function candidateRow(person, data, body, fab) {
  const sub = [person.city, person.state].filter(Boolean).join(', ')
  const btn = el(`<button class="knox-cand"><span><b>${esc(person.name)}</b>${sub ? ` · ${esc(sub)}` : ''}</span><small>${person.email ? esc(person.email) : 'no email on file'}</small></button>`)
  btn.addEventListener('click', () => attachThenLog(person, data, body, fab))
  return btn
}

function searchBlock(body, data, fab, label) {
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
        for (const p of rows) results.appendChild(candidateRow(p, data, body, fab))
        if (!rows.length) results.innerHTML = '<div class="knox-line knox-muted">No matches</div>'
      } catch (_) { results.innerHTML = '<div class="knox-line knox-warn">Search failed</div>' }
    }, 250)
  })
  return wrap
}

async function attachThenLog(person, data, body, fab) {
  body.innerHTML = ''
  const status = el(`<div class="knox-line">Attaching to <b>${esc(person.name)}</b>…</div>`)
  body.appendChild(status)
  try {
    const r = await api('/api/ext/attach-email', {
      method: 'POST',
      body: JSON.stringify({ person_id: person.id, email: data.contactEmail }),
    })
    if (!r.ok) { status.className = 'knox-line knox-warn'; status.textContent = `✗ ${r.error}`; return }
    const note = r.already ? 'already on file' : (r.slot === 'email2' ? 'saved as 2nd email' : 'email saved')
    status.className = 'knox-line knox-ok'
    status.innerHTML = `✓ ${esc(person.name)} — ${note}`
    body.appendChild(logButton(data, person.id, fab))
    const ph = addPhoneButton(person, data)
    if (ph) body.appendChild(ph)
  } catch (_) {
    status.className = 'knox-line knox-warn'; status.textContent = '✗ CRM unreachable'
  }
}

function logButton(data, personId, fab) {
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

  const myEmail = (
    document.querySelector('a[aria-label*="Google Account"]')?.getAttribute('aria-label')?.match(/\(([^)]+)\)/)?.[1] ||
    document.querySelector('[data-email]')?.getAttribute('data-email') || ''
  ).toLowerCase().trim()

  const allEmailEls = Array.from(root.querySelectorAll('[email]'))
  const senderEl    = allEmailEls[0] || null
  const fromEmail   = (senderEl?.getAttribute('email') || '').toLowerCase().trim()
  const fromName    = senderEl?.getAttribute('name') || senderEl?.textContent?.trim() || fromEmail
  const toEmail     = (allEmailEls[1]?.getAttribute('email') || '').toLowerCase().trim()

  // The contact is the OTHER party — the first participant that isn't me. Look in
  // this message first, then the whole thread. This avoids picking my own reply.
  const isExternal = (e) => { const a = (e.getAttribute('email') || '').toLowerCase().trim(); return a && a !== myEmail }
  const contactEl =
    allEmailEls.find(isExternal) ||
    Array.from(document.querySelectorAll('[email]')).find(isExternal) ||
    senderEl
  const contactEmail = (contactEl?.getAttribute('email') || '').toLowerCase().trim()
  const contactName  = contactEl?.getAttribute('name') || contactEl?.textContent?.trim() || contactEmail

  const subject =
    document.querySelector('h2[data-thread-perm-id]')?.textContent?.trim() ||
    document.querySelector('h2')?.textContent?.trim() || ''

  let dateIso = new Date().toISOString()
  for (const node of Array.from(root.querySelectorAll('[title]'))) {
    const t = node.getAttribute('title') || ''
    if (/\d{4}/.test(t)) {
      const parsed = new Date(t)
      if (!isNaN(parsed)) { dateIso = parsed.toISOString(); break }
    }
  }

  let bodyPreview = ''
  const bodyEl = root.querySelector('.a3s') || root.querySelector('[dir="ltr"]') || null
  if (bodyEl) {
    const clone = bodyEl.cloneNode(true)
    clone.querySelectorAll('.gmail_quote, blockquote, style, script').forEach(n => n.remove())
    bodyPreview = (clone.innerText || '').trim().slice(0, 8000)
  }

  const direction = myEmail && fromEmail === myEmail ? 'outbound' : 'inbound'

  // Pull a phone number out of the CONTACT's own message(s) — not my replies —
  // so a signature phone can be offered for the contact.
  const phoneDigits = contactPhoneDigits(contactEmail)
  const phone = fmtPhone(phoneDigits)

  const legacyId =
    emailEl?.getAttribute?.('data-legacy-message-id') ||
    emailEl?.getAttribute?.('data-message-id') || null
  const threadId = document.querySelector('[data-thread-perm-id]')?.getAttribute('data-thread-perm-id') || null

  return {
    contactEmail, contactName, fromEmail, toEmail, fromName, subject, dateIso, bodyPreview, direction,
    phone, phoneDigits, legacyId, threadId,
    fromDisplay: fromName && fromName !== fromEmail ? `${fromName} <${fromEmail}>` : fromEmail,
  }
}

// ── Phone detection ─────────────────────────────────────────────────────────
function normPhone(s) { let d = (s || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d.length === 10 ? d : '' }
function fmtPhone(d)  { return d && d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : '' }
function findPhone(text) {
  if (!text) return ''
  const matches = text.match(/(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/g) || []
  for (const m of matches) { const d = normPhone(m); if (d) return d }
  return ''
}
// Scan messages authored by the contact (by sender email) for a phone number.
function contactPhoneDigits(contactEmail) {
  if (!contactEmail) return ''
  const msgs = Array.from(document.querySelectorAll('[data-message-id], [data-legacy-message-id]'))
  for (const m of msgs) {
    const sender = (m.querySelector('[email]')?.getAttribute('email') || '').toLowerCase().trim()
    if (sender && sender === contactEmail) {
      const d = findPhone((m.querySelector('.a3s') || m).innerText || '')
      if (d) return d
    }
  }
  return ''
}

// An "Add phone" button — shown when the email has a phone the contact lacks.
function phoneOnFile(person, digits) {
  const n = (s) => { let d = (s || '').replace(/\D/g, ''); if (d.length === 11 && d[0] === '1') d = d.slice(1); return d }
  return [person.phone, person.mobile].some(p => n(p) === digits && digits)
}
function addPhoneButton(person, data) {
  if (!data.phoneDigits || phoneOnFile(person, data.phoneDigits)) return null
  const btn = el(`<button class="knox-primary knox-alt">Add phone ${esc(data.phone)}</button>`)
  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Adding…'
    try {
      const r = await api('/api/ext/attach-phone', {
        method: 'POST',
        body: JSON.stringify({ person_id: person.id, phone: data.phone }),
      })
      if (r.ok) {
        btn.className = 'knox-primary knox-done'
        btn.textContent = r.already ? '✓ Phone already on file' : '✓ Phone added'
      } else {
        btn.className = 'knox-primary knox-warn'; btn.textContent = `✗ ${r.error}`; btn.disabled = false
      }
    } catch (_) {
      btn.className = 'knox-primary knox-warn'; btn.textContent = '✗ CRM unreachable'; btn.disabled = false
    }
  })
  return btn
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild }
function row(text, cls = '') { return `<div class="knox-line ${cls}">${esc(text)}</div>` }
function wrapHd(title, sub) { return `<div class="knox-hd">${esc(title)}${sub ? `<span>${esc(sub)}</span>` : ''}</div>` }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])) }
