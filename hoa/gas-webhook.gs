// ═══════════════════════════════════════════════════════════════════════════════
// Oakleaf Ridge HOA — Google Apps Script Webhook
//
// SETUP:
//  1. Open Google Sheets → Extensions → Apps Script
//  2. Paste this entire file, replacing any existing code
//  3. Change ADMIN_KEY below to match admin.js → ADMIN_PASSWORD
//  4. Deploy: click Deploy → New deployment
//       Type: Web app
//       Execute as: Me
//       Who has access: Anyone
//  5. Copy the web app URL into index.html → app.js and admin.js (WEBHOOK_URL)
//  6. On subsequent edits, use Deploy → Manage deployments → edit the existing
//     deployment (don't create a new URL each time)
//
// SHEET COLUMNS (row 1 is a header row, data starts at row 2):
//   A: Timestamp | B: First Name | C: Last Name | D: Email |
//   E: Phone     | F: Lot        | G: Years      | H: Support
// ═══════════════════════════════════════════════════════════════════════════════

const ADMIN_KEY = 'DougRemer86!'; // keep in sync with admin.js → ADMIN_PASSWORD

// ── GET handler ───────────────────────────────────────────────────────────────
function doGet(e) {
  const action = (e.parameter.action || '').trim();

  if (action === 'getRegistrations') {
    return getPublicRegistrations();
  }

  if (action === 'getAll') {
    if (e.parameter.adminKey !== ADMIN_KEY) {
      return jsonResponse({ success: false, error: 'Unauthorized' });
    }
    return getAllRegistrations();
  }

  return jsonResponse({ success: false, error: 'Unknown action' });
}

// Returns only lot + first/last name — safe to expose publicly for the grid.
function getPublicRegistrations() {
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();
  const regs  = [];

  for (let i = 1; i < rows.length; i++) {
    const [, firstName, lastName, , , lot] = rows[i];
    if (lot !== '' && lot !== undefined) {
      regs.push({ lot: String(lot), firstName: String(firstName), lastName: String(lastName) });
    }
  }

  return jsonResponse({ success: true, registrations: regs });
}

// Returns all fields — gated behind ADMIN_KEY.
function getAllRegistrations() {
  const sheet = getSheet();
  const rows  = sheet.getDataRange().getValues();
  const regs  = [];

  for (let i = 1; i < rows.length; i++) {
    const [timestamp, firstName, lastName, email, phone, lot, years, support] = rows[i];
    if (lot !== '' && lot !== undefined) {
      regs.push({
        timestamp: timestamp ? new Date(timestamp).toISOString() : '',
        firstName: String(firstName),
        lastName:  String(lastName),
        email:     String(email),
        phone:     String(phone),
        lot:       String(lot),
        years:     String(years),
        support:   String(support),
      });
    }
  }

  return jsonResponse({ success: true, registrations: regs });
}

// ── POST handler ──────────────────────────────────────────────────────────────
function doPost(e) {
  const p = e.parameter; // form-encoded body parsed by Apps Script automatically

  const firstName = (p.firstName || '').trim();
  const lastName  = (p.lastName  || '').trim();
  const email     = (p.email     || '').trim();
  const lot       = (p.lot       || '').trim();

  if (!firstName || !lastName || !email || !lot) {
    return jsonResponse({ success: false, error: 'Missing required fields' });
  }

  const sheet = getSheet();

  // Prevent duplicate lot registrations — last write wins (overwrite existing row).
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][5]) === lot) { // column F = lot
      sheet.getRange(i + 1, 1, 1, 8).setValues([[
        new Date(),
        firstName,
        lastName,
        email,
        (p.phone || '').trim(),
        lot,
        (p.years || '').trim(),
        (p.support || '').trim(),
      ]]);
      return jsonResponse({ success: true, updated: true });
    }
  }

  // New row
  sheet.appendRow([
    new Date(),
    firstName,
    lastName,
    email,
    (p.phone  || '').trim(),
    lot,
    (p.years  || '').trim(),
    (p.support || '').trim(),
  ]);

  return jsonResponse({ success: true });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getSheet() {
  // Uses the first sheet in the spreadsheet.
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheets()[0];

  // Write headers on first use.
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['Timestamp', 'First Name', 'Last Name', 'Email',
                     'Phone', 'Lot', 'Years at Address', 'Support']);
  }

  return sheet;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
