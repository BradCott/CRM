const BASE = '/api'

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'include',
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
export const getDroppedDeals = ()      => req('GET',    '/deals/dropped')
export const createDeal     = (data)   => req('POST',   '/deals', data)
export const updateDeal     = (id, d)  => req('PUT',    `/deals/${id}`, d)
export const patchDealStage = (id, s)  => req('PATCH',  `/deals/${id}/stage`, { stage: s })
export const deleteDeal     = (id)     => req('DELETE', `/deals/${id}`)
export const closeDealApi   = (id)     => req('POST',   `/deals/${id}/close`)
export const dropDealApi    = (id)     => req('POST',   `/deals/${id}/drop`)
export const restoreDealApi = (id)     => req('POST',   `/deals/${id}/restore`)

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

// Google OAuth / Drive
export const getGoogleStatus  = ()     => req('GET',    '/auth/google/status')
export const disconnectGoogle = ()     => req('DELETE', '/auth/google')

// Emails
export const getEmails    = (personId) => req('GET',    `/emails?person_id=${personId}`)
export const createEmail  = (data)     => req('POST',   '/emails', data)
export const deleteEmail  = (id)       => req('DELETE', `/emails/${id}`)

// Accounting
export const getAccountingSummary     = ()              => req('GET',    '/accounting/summary')
export const getLedger                = (propertyId)    => req('GET',    `/accounting/${propertyId}/transactions`)
export const createTransactions       = (propertyId, d) => req('POST',   `/accounting/${propertyId}/transactions`, d)
export const deleteTransaction        = (id)            => req('DELETE', `/accounting/transactions/${id}`)
export async function uploadSettlement(propertyId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/accounting/${propertyId}/settlement`, fd)
}
export async function uploadBankStatement(propertyId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/accounting/${propertyId}/bank-statement`, fd)
}

// Journal entries
export const getJournalEntries  = (propertyId)    => req('GET',  `/accounting/${propertyId}/journal-entries`)
export const saveJournalEntry   = (propertyId, d) => req('POST', `/accounting/${propertyId}/journal-entries`, d)

// Investor contributions
export const getInvestors              = (propertyId)    => req('GET',    `/accounting/${propertyId}/investors`)
export const saveInvestors             = (propertyId, d) => req('POST',   `/accounting/${propertyId}/investors`, d)
export const updateInvestorContribution = (id, amount)   => req('PATCH',  `/accounting/investors/${id}`, { contribution: amount })
export const deleteInvestor            = (id)            => req('DELETE', `/accounting/investors/${id}`)
export async function uploadInvestorContributions(propertyId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/accounting/${propertyId}/investors/upload`, fd)
}

// Investors (CRM)
export const getInvestor     = (id)     => req('GET',    `/investors/${id}`)
export const createInvestor  = (data)   => req('POST',   '/investors', data)
export const updateInvestor  = (id, d)  => req('PUT',    `/investors/${id}`, d)
export const deleteInvestorRecord = (id) => req('DELETE', `/investors/${id}`)

export const getCRMInvestors = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return req('GET', `/investors${qs ? '?' + qs : ''}`)
}

// Property Management
export const getManagementDashboard = () => req('GET', '/management/dashboard')

// Tasks
export const getPropertyTasks   = (propId)       => req('GET',    `/management/${propId}/tasks`)
export const createTask         = (propId, data)  => req('POST',   `/management/${propId}/tasks`, data)
export const updateTask         = (id, data)      => req('PUT',    `/management/tasks/${id}`, data)
export const completeTask       = (id)            => req('POST',   `/management/tasks/${id}/complete`)
export const deleteTask         = (id)            => req('DELETE', `/management/tasks/${id}`)

// Insurance
export const getPropertyInsurance  = (propId)      => req('GET',    `/management/${propId}/insurance`)
export const createInsurance       = (propId, data) => req('POST',   `/management/${propId}/insurance`, data)
export const updateInsurance       = (id, data)     => req('PUT',    `/management/insurance/${id}`, data)
export const deleteInsurance       = (id)           => req('DELETE', `/management/insurance/${id}`)
export async function uploadInsurancePdf(propId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/management/${propId}/insurance/upload`, fd)
}

// Taxes
export const getPropertyTaxes  = (propId)      => req('GET',    `/management/${propId}/taxes`)
export const createTax         = (propId, data) => req('POST',   `/management/${propId}/taxes`, data)
export const updateTax         = (id, data)     => req('PUT',    `/management/taxes/${id}`, data)
export const deleteTax         = (id)           => req('DELETE', `/management/taxes/${id}`)

// Maintenance
export const getPropertyMaintenance  = (propId)      => req('GET',    `/management/${propId}/maintenance`)
export const createMaintenance       = (propId, data) => req('POST',   `/management/${propId}/maintenance`, data)
export const updateMaintenance       = (id, data)     => req('PUT',    `/management/maintenance/${id}`, data)
export const deleteMaintenance       = (id)           => req('DELETE', `/management/maintenance/${id}`)

// Contacts
export const getPropertyContacts  = (propId)      => req('GET',    `/management/${propId}/contacts`)
export const createContact        = (propId, data) => req('POST',   `/management/${propId}/contacts`, data)
export const updateContact        = (id, data)     => req('PUT',    `/management/contacts/${id}`, data)
export const deleteContact        = (id)           => req('DELETE', `/management/contacts/${id}`)
