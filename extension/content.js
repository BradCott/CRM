// Knox CRM — Gmail content script
// Uses stable aria-label/data attributes instead of obfuscated class names

const CRM_URL_KEY = 'knoxCrmUrl'
let crmUrl = 'http://localhost:3001'

chrome.storage.sync.get([CRM_URL_KEY], (r) => { if (r[CRM_URL_KEY]) crmUrl = r[CRM_URL_KEY] })
chrome.storage.onChanged.addListener((c) => { if (c[CRM_URL_KEY]) crmUrl = c[CRM_URL_KEY].newValue })

// ── Observation ───────────────────────────────────────────────────────────────
// Gmail is a SPA — watch for DOM mutations with a debounced scan

let scanTimer = null
function scheduleScan() {
  clearTimeout(scanTimer)
  scanTimer = setTimeout(scanAndInject, 800)
}

new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true })
scheduleScan()

// ── Injection ─────────────────────────────────────────────────────────────────
// Strategy: find every Reply button by aria-label (stable, accessibility-required).
// Insert our button directly before it — no toolbar class needed.

function scanAndInject() {
  // Gmail must keep aria-label="Reply" for accessibility — much more stable than class names.
  // data-tooltip="Reply" is a secondary signal; both are queried together.
  const replyBtns = document.querySelectorAll(
    '[role="button"][aria-label="Reply"], [role="button"][data-tooltip="Reply"]'
  )

  for (const replyBtn of replyBtns) {
    // Skip "Reply all" variants
    const label = replyBtn.getAttribute('aria-label') || replyBtn.getAttribute('data-tooltip') || ''
    if (/reply\s+all/i.test(label)) continue

    // The marker lives on the immediate parent so we survive Gmail re-renders
    // within the same email (parent rarely changes even when children re-render)
    const anchor = replyBtn.parentElement
    if (!anchor || anchor.dataset.knoxDone) continue

    // Find the email container — Gmail consistently sets data-message-id
    const emailEl =
      replyBtn.closest('[data-message-id]') ||
      replyBtn.closest('[data-legacy-message-id]') ||
      null

    const btn = buildButton(emailEl)
    replyBtn.insertAdjacentElement('beforebegin', btn)
    anchor.dataset.knoxDone = '1'
  }
}

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
// All selectors use stable HTML attributes, not obfuscated class names.

function extractEmailData(emailEl) {
  const root = emailEl || document

  // ── From ──────────────────────────────────────────────────────────────────
  // Gmail sets an "email" attribute on the sender span — very reliable
  const senderEl   = root.querySelector('[email]') || root.querySelector('[data-hovercard-id]')
  const fromEmail  = (
    senderEl?.getAttribute('email') ||
    senderEl?.getAttribute('data-hovercard-id') ||
    ''
  ).toLowerCase().trim()
  const fromName   = senderEl?.textContent?.trim() || fromEmail

  // ── To ────────────────────────────────────────────────────────────────────
  // Recipients also carry the [email] attribute; skip the first hit (that's From)
  const allAddrEls = Array.from(root.querySelectorAll('[email]'))
  const toEmail    = (
    allAddrEls.find(el => el !== senderEl)?.getAttribute('email') || ''
  ).toLowerCase().trim()

  // ── Subject ───────────────────────────────────────────────────────────────
  // Gmail wraps the thread subject in an <h2>; data-thread-perm-id is optional
  const subject =
    document.querySelector('h2[data-thread-perm-id]')?.textContent?.trim() ||
    document.querySelector('h2')?.textContent?.trim() ||
    ''

  // ── Date ──────────────────────────────────────────────────────────────────
  // Gmail puts a human-readable timestamp in a span; the title attribute often
  // has the full date string (e.g. "Mon, Apr 6, 2026, 10:30 AM")
  const timeEl = root.querySelector('[title][data-datestring], [title][data-hovercard-id] ~ * [title]') ||
                 root.querySelector('span[title]')
  const dateRaw = timeEl?.getAttribute('title') || timeEl?.textContent?.trim() || ''
  let dateIso
  try { dateIso = dateRaw ? new Date(dateRaw).toISOString() : new Date().toISOString() }
  catch (_) { dateIso = new Date().toISOString() }

  // ── Body preview ──────────────────────────────────────────────────────────
  // .gmail_quote is a stable class (it's added by Gmail to all quoted text)
  const bodyContainer = root.querySelector('[dir="ltr"]') || root.querySelector('div[class]')
  let bodyPreview = ''
  if (bodyContainer) {
    const clone = bodyContainer.cloneNode(true)
    clone.querySelectorAll('.gmail_quote, blockquote, style, script').forEach(n => n.remove())
    bodyPreview = clone.innerText?.replace(/\s+/g, ' ').trim().slice(0, 600) || ''
  }

  // ── Direction ─────────────────────────────────────────────────────────────
  // The logged-in account email appears in the account menu button
  const myEmail = (
    document.querySelector('[data-email]')?.getAttribute('data-email') ||
    document.querySelector('a[href*="accounts.google.com"] [aria-label]')?.getAttribute('aria-label') ||
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
        from_address:  fromName !== fromEmail ? `${fromName} <${fromEmail}>` : fromEmail,
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
