import { load, save } from './storage'
import { newId } from '../utils/id'

const KEY = 'contacts'

export function getContacts() {
  return load(KEY, [])
}

export function saveContact(contact) {
  const contacts = getContacts()
  const now = new Date().toISOString()
  if (contact.id) {
    const idx = contacts.findIndex(c => c.id === contact.id)
    if (idx >= 0) {
      contacts[idx] = { ...contact, updatedAt: now }
    } else {
      contacts.push({ ...contact, updatedAt: now })
    }
  } else {
    contacts.unshift({ ...contact, id: newId(), createdAt: now, updatedAt: now })
  }
  save(KEY, contacts)
  return load(KEY, [])
}

export function deleteContact(id) {
  const contacts = getContacts().filter(c => c.id !== id)
  save(KEY, contacts)
  return contacts
}
