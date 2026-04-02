const PREFIX = 'crm:'

export function load(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw !== null ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

export function save(key, data) {
  localStorage.setItem(PREFIX + key, JSON.stringify(data))
}

export function clear(key) {
  localStorage.removeItem(PREFIX + key)
}
