const BASE = '/api'

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {},
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `HTTP ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

// Tenant brands
export const getTenantBrands   = ()       => req('GET',    '/tenant-brands')
export const createTenantBrand = (data)   => req('POST',   '/tenant-brands', data)
export const updateTenantBrand = (id, d)  => req('PUT',    `/tenant-brands/${id}`, d)
export const deleteTenantBrand = (id)     => req('DELETE', `/tenant-brands/${id}`)

// People — paginated
export const getPeople    = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return req('GET', `/people${qs ? '?' + qs : ''}`)
}
export const getAllPeople  = ()       => req('GET',    '/people/all')
export const getPerson    = (id)     => req('GET',    `/people/${id}`)
export const createPerson = (data)   => req('POST',   '/people', data)
export const updatePerson = (id, d)  => req('PUT',    `/people/${id}`, d)
export const deletePerson = (id)     => req('DELETE', `/people/${id}`)

// Properties — paginated
export const getProperties   = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return req('GET', `/properties${qs ? '?' + qs : ''}`)
}
export const getAllProperties     = ()       => req('GET',    '/properties/all')
export const getPropertyFeeSummary = ()   => req('GET',    '/properties/fee-summary')
export const getPropertyStates = ()     => req('GET',    '/properties/states')
export const getProperty     = (id)     => req('GET',    `/properties/${id}`)
export const createProperty  = (data)   => req('POST',   '/properties', data)
export const updateProperty  = (id, d)  => req('PUT',    `/properties/${id}`, d)
export const deleteProperty        = (id)     => req('DELETE', `/properties/${id}`)
export const togglePortfolio       = (id, val) => req('PATCH',  `/properties/${id}/portfolio`, { is_portfolio: val })

// Deals
export const getDeals       = ()       => req('GET',    '/deals')
export const createDeal     = (data)   => req('POST',   '/deals', data)
export const updateDeal     = (id, d)  => req('PUT',    `/deals/${id}`, d)
export const patchDealStage = (id, s)  => req('PATCH',  `/deals/${id}/stage`, { stage: s })
export const deleteDeal     = (id)     => req('DELETE', `/deals/${id}`)

// Reports
export const getReports       = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return req('GET', `/reports${qs ? '?' + qs : ''}`)
}
export const getFilterOptions = () => req('GET', '/reports/filter-options')
export const exportReportUrl  = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return `/api/reports/export${qs ? '?' + qs : ''}`
}

// Saved searches
export const getSavedSearches   = ()         => req('GET',    '/saved-searches')
export const createSavedSearch  = (data)     => req('POST',   '/saved-searches', data)
export const deleteSavedSearch  = (id)       => req('DELETE', `/saved-searches/${id}`)

// Import
export async function importCsv(endpoint, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', endpoint, fd)
}

export const getImportStats = () => req('GET', '/import/stats')

// Dashboard
export const getDashboard = () => req('GET', '/dashboard')

// Investors
export const getInvestors    = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return req('GET', `/investors${qs ? '?' + qs : ''}`)
}
export const getInvestor     = (id)     => req('GET',    `/investors/${id}`)
export const createInvestor  = (data)   => req('POST',   '/investors', data)
export const updateInvestor  = (id, d)  => req('PUT',    `/investors/${id}`, d)
export const deleteInvestor  = (id)     => req('DELETE', `/investors/${id}`)
