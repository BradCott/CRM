// Knox CRM — Gmail content script
// Polls every second for Reply buttons and injects a "Log to CRM" button next to each.

const CRM_URL_KEY = 'knoxCrmUrl'
let crmUrl = 'http://localhost:3001'

chrome.storage.sync.get([CRM_URL_KEY], (r) => { if (r[CRM_URL_KEY]) crmUrl = r[CRM_URL_KEY] })
chrome.storage.onChanged.addListener((c) => { if (c[CRM_URL_KEY]) crmUrl = c[CRM_URL_KEY].newValue })

// ── Polling ───────────────────────────────────────────────────────────────────
// setInterval is more reliable than MutationObserver for Gmail's async rendering.
// It naturally catches buttons that appear at any point after page load.

setInterval(scan, 1000)
scan()

function scan() {
  // Anchor on the Forward button — it ONLY appears in the bottom action toolbar,
  // never in the email header area. This prevents the button landing at the top
  // of the email (which happens when matching the header's Reply icon).
  const forwardBtns = [
    ...document.querySelectorAll('[aria-label="Forward"]'),
    ...document.querySelectorAll('[data-tooltip="Forward"]'),
    ...document.querySelectorAll('[title="Forward"]'),
  ]

  for (const fwdBtn of forwardBtns) {
    // Skip if we already handled this toolbar
    if (fwdBtn.dataset.knoxDone) continue

    // Find the Reply button in the same toolbar container.
    // Walk up to 3 levels to handle varying wrapper depths.
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
    if (toolbar.querySelector('.knox-log-btn')) continue // already injected

    fwdBtn.dataset.knoxDone = '1'

    const emailEl =
      fwdBtn.closest('[data-message-id]') ||
      fwdBtn.closest('[data-legacy-message-id]') ||
      null

    // Insert immediately after the Reply button so we sit between Reply and Reply All
    replyBtn.insertAdjacentElement('afterend', buildButton(emailEl))
  }
}

// ── Button ────────────────────────────────────────────────────────────────────

function buildButton(emailEl) {
  const btn = document.createElement('button')
  btn.className   = 'knox-log-btn'
  btn.textContent = 'Log to CRM'
  btn.title       = 'Log this email to Knox CRM'
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
    handleLog(emailEl, btn)
  })
  return btn
}

// ── Email data extraction ─────────────────────────────────────────────────────

function extractEmailData(emailEl) {
  const root = emailEl || document

  // From — Gmail puts the sender email in an [email] attribute on a span
  const allEmailEls = Array.from(root.querySelectorAll('[email]'))
  const senderEl    = allEmailEls[0] || null
  const fromEmail   = (senderEl?.getAttribute('email') || '').toLowerCase().trim()
  const fromName    = senderEl?.textContent?.trim() || fromEmail

  // To — second [email] element in the container, if present
  const toEmail = (allEmailEls[1]?.getAttribute('email') || '').toLowerCase().trim()

  // Subject — Gmail uses an <h2> for the thread subject
  const subject =
    document.querySelector('h2[data-thread-perm-id]')?.textContent?.trim() ||
    document.querySelector('h2')?.textContent?.trim() ||
    ''

  // Date — look for a span whose title attribute contains a parseable date
  let dateIso = new Date().toISOString()
  const titleEls = Array.from(root.querySelectorAll('[title]'))
  for (const el of titleEls) {
    const t = el.getAttribute('title') || ''
    // Gmail date titles look like "Mon, Apr 6, 2026, 10:30 AM"
    if (/\d{4}/.test(t)) {
      const parsed = new Date(t)
      if (!isNaN(parsed)) { dateIso = parsed.toISOString(); break }
    }
  }

  // Body preview — strip quoted text (.gmail_quote is a stable Gmail class)
  let bodyPreview = ''
  const bodyEl = root.querySelector('[dir="ltr"]') || root.querySelector('.a3s') || null
  if (bodyEl) {
    const clone = bodyEl.cloneNode(true)
    clone.querySelectorAll('.gmail_quote, blockquote, style, script').forEach(n => n.remove())
    bodyPreview = (clone.innerText || '').trim().slice(0, 8000)
  }

  // Direction — compare sender to the logged-in Google account
  const myEmail = (
    document.querySelector('a[aria-label*="Google Account"]')?.getAttribute('aria-label')?.match(/\(([^)]+)\)/)?.[1] ||
    document.querySelector('[data-email]')?.getAttribute('data-email') ||
    ''
  ).toLowerCase().trim()

  const direction    = myEmail && fromEmail === myEmail ? 'outbound' : 'inbound'
  const contactEmail = direction === 'inbound' ? fromEmail : toEmail

  return { contactEmail, fromEmail, toEmail, fromName, subject, dateIso, bodyPreview, direction }
}

// ── Log action ────────────────────────────────────────────────────────────────

async function handleLog(emailEl, btn) {
  const { contactEmail, fromEmail, toEmail, fromName, subject, dateIso, bodyPreview, direction } =
    extractEmailData(emailEl)

  if (!contactEmail) {
    return flash(btn, '✗ No email address found', 'error')
  }

  btn.textContent = 'Logging…'
  btn.disabled    = true
  btn.classList.remove('knox-error', 'knox-logged')

  try {
    const res  = await fetch(`${crmUrl}/api/emails/log`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        contact_email: contactEmail,
        subject,
        body_preview:  bodyPreview,
        direction,
        date:          dateIso,
        from_address:  fromName && fromName !== fromEmail ? `${fromName} <${fromEmail}>` : fromEmail,
        to_address:    toEmail,
      }),
    })
    const data = await res.json()

    if (data.ok) {
      btn.textContent = `✓ ${data.personName}`
      btn.classList.add('knox-logged')
      btn.disabled = false
    } else {
      flash(btn, `✗ ${data.error}`, 'error')
    }
  } catch (_) {
    flash(btn, '✗ CRM unreachable', 'error')
  }
}

function flash(btn, msg, cls) {
  btn.textContent = msg
  btn.classList.add(`knox-${cls}`)
  btn.disabled = false
  setTimeout(() => {
    btn.textContent = 'Log to CRM'
    btn.classList.remove(`knox-${cls}`)
  }, 3500)
}
