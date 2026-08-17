// Per-user handwritten-mail profile. Each user can store their own return address,
// from-name, and signature so mailers go out AS them. When a user hasn't set up a
// complete return address, we fall back to the historical Knox default so mail
// still sends. Used by every Handwrytten send path + the drip engine.
import db from '../db.js'

// The historical hardcoded sender, used as the fallback.
export const KNOX_DEFAULTS = {
  from_first: 'Knox', from_last: 'Capital', business: 'Knox Capital',
  line1: '7500 W 160th St Ste 101', line2: '', city: 'Stilwell', state: 'KS', zip: '66085',
  country_id: 1, signature_id: '1427BC',
}
// Some paths historically signed as Brad specifically.
export const BRAD_DEFAULTS = { ...KNOX_DEFAULTS, from_first: 'Brad', from_last: 'Cottam' }

// Load a user's mailing profile. Only adopts their return address if it's complete
// (line1 + city + state + zip); otherwise returns the fallback address. A saved
// signature is always honored if present.
export function getMailProfile(userId, fallback = KNOX_DEFAULTS) {
  const u = userId
    ? db.prepare(`
        SELECT mail_from_first, mail_from_last, mail_return_business,
               mail_return_line1, mail_return_line2, mail_return_city,
               mail_return_state, mail_return_zip, mail_signature_id
        FROM users WHERE id = ?
      `).get(userId)
    : null

  const hasAddr = !!(u && u.mail_return_line1 && u.mail_return_city && u.mail_return_state && u.mail_return_zip)
  if (!hasAddr) {
    return { ...fallback, signature_id: (u && u.mail_signature_id) || fallback.signature_id }
  }
  return {
    from_first:   u.mail_from_first || fallback.from_first,
    from_last:    u.mail_from_last  || fallback.from_last,
    business:     u.mail_return_business || '',
    line1:        u.mail_return_line1,
    line2:        u.mail_return_line2 || '',
    city:         u.mail_return_city,
    state:        u.mail_return_state,
    zip:          u.mail_return_zip,
    country_id:   1,
    signature_id: u.mail_signature_id || fallback.signature_id,
  }
}

// The Handwrytten singleStepOrder sender_* fields for a profile.
export function senderFields(profile) {
  return {
    sender_first_name: profile.from_first || '',
    sender_last_name:  profile.from_last || '',
    sender_address1:   profile.line1 || '',
    sender_address2:   profile.line2 || '',
    sender_city:       profile.city || '',
    sender_state:      profile.state || '',
    sender_zip:        profile.zip || '',
    sender_country_id: profile.country_id || 1,
  }
}
