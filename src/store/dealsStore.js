import { load, save } from './storage'
import { newId } from '../utils/id'

const KEY = 'deals'

export function getDeals() {
  return load(KEY, [])
}

export function saveDeal(deal) {
  const deals = getDeals()
  const now = new Date().toISOString()
  if (deal.id) {
    const idx = deals.findIndex(d => d.id === deal.id)
    if (idx >= 0) {
      deals[idx] = { ...deal, updatedAt: now }
    } else {
      deals.push({ ...deal, updatedAt: now })
    }
  } else {
    deals.unshift({ ...deal, id: newId(), createdAt: now, updatedAt: now })
  }
  save(KEY, deals)
  return load(KEY, [])
}

export function deleteDeal(id) {
  const deals = getDeals().filter(d => d.id !== id)
  save(KEY, deals)
  return deals
}

export function reorderDeals(newOrder) {
  save(KEY, newOrder)
  return newOrder
}
