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

// Tenant-contact job roles (extensible list)
export const getTenantRoles   = ()       => req('GET',  '/tenant-roles')
export const createTenantRole = (label)  => req('POST', '/tenant-roles', { label })

// Browser extension
export const getPluginInfo    = ()       => req('GET', '/plugin/info')
export const getPluginManaged = ()       => req('GET', '/plugin/managed')
export const pluginDownloadUrl = ()      => `${BASE}/plugin/download`

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
export const bulkDeletePeople = (ids) => req('POST', '/people/bulk-delete', { ids })
export const setPersonDNC   = (id, v)  => req('PATCH', `/people/${id}/dnc`, { do_not_contact: v ? 1 : 0 })
export const mergePeople    = (keepId, mergeIds) => req('POST', '/people/merge', { keep_id: keepId, merge_ids: mergeIds })
export const getPersonDuplicates = (id) => req('GET', `/people/${id}/duplicates`)

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
export const bulkDeleteProperties  = (ids)    => req('POST', '/properties/bulk-delete', { ids })
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
export const restoreDealApi    = (id)           => req('POST',  `/deals/${id}/restore`)
export const linkDealProperty  = (id, propId)   => req('PATCH', `/deals/${id}/link-property`, { property_id: propId })

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
export const exportPropertiesUrl = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return `/api/properties/export${qs ? '?' + qs : ''}`
}
export const exportPeopleUrl = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return `/api/people/export${qs ? '?' + qs : ''}`
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

export const getImportStats          = () => req('GET', '/import/stats')
export const importRecentSales       = (file) => importCsv('/import/recent-sales', file)
export const clearOwnershipReview    = (id)   => req('PATCH', `/properties/${id}/ownership-review`, { needs_ownership_review: 0 })
export const checkPersonDuplicate    = (params) => req('GET', `/people/check-duplicate?${new URLSearchParams(params)}`)
export const checkPropertyDuplicate  = (params) => req('GET', `/properties/check-duplicate?${new URLSearchParams(params)}`)
export async function previewImport(file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', '/import/salesforce?preview=1', fd)
}
export async function commitImport(file, decisions = {}) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('decisions', JSON.stringify(decisions))
  return req('POST', '/import/salesforce', fd)
}

// Parse a settlement PDF without an existing property (for new portfolio property creation)
export async function parseSettlementPdf(file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', '/accounting/parse-settlement', fd)
}

// Today's Plays + command center
export const getPlays            = ()              => req('GET',   '/plays')
export const patchPlay           = (id, d)         => req('PATCH', `/plays/${id}`, d)
export const createPlay          = (d)             => req('POST',  '/plays', d)
export const claimPlay           = (id)            => req('POST',  `/plays/${id}/claim`)
export const getLauncherCounts   = ()              => req('GET',   '/plays/launcher')
export const getMailStats        = ()              => req('GET',   '/plays/mail-stats')
export const setMailTarget       = (target)        => req('PUT',   '/plays/mail-target', { target })
export const getBrokerLeaderboard = (months)       => req('GET',   `/plays/brokers/leaderboard${months ? `?months=${months}` : ''}`)
export const assignDealBroker    = (dealId, d)     => req('PATCH', `/plays/brokers/deals/${dealId}`, d)

// Dashboard
export const getDashboard           = () => req('GET', '/dashboard')
export const getDashboardFinancials     = () => req('GET', '/dashboard/financials')
export const getDashboardDeadlines      = () => req('GET', '/dashboard/deadlines')
export const getDashboardActivity       = () => req('GET', '/dashboard/activity')
export const getDashboardMapProperties  = () => req('GET', '/dashboard/map-properties')
export const getDashboardLeaseExpirations = () => req('GET', '/dashboard/lease-expirations')
export const getTreasury                   = () => req('GET', '/dashboard/treasury')

// Google OAuth / Drive
// Full-data backup / export (admin)
export const getBackupInfo    = ()     => req('GET', '/admin/backup/info')
export const backupDbUrl      = '/api/admin/backup'
export const exportJsonUrl    = '/api/admin/export-json'
export const exportExcelUrl   = '/api/admin/export-excel'

export const getGoogleStatus  = ()     => req('GET',    '/auth/google/status')
export const disconnectGoogle = ()     => req('DELETE', '/auth/google')
export const diagnoseDrive    = ()       => req('GET',  '/loi-import/diagnose')
export const runDriveWatcher  = (reset)  => req('POST', `/loi-import/run${reset ? '?reset=1' : ''}`)
export const setLoiFolder     = (folder) => req('POST', '/loi-import/set-folder', { folder })
export const syncGmailNow     = ()       => req('POST', '/emails/sync')

// Emails
export const getEmails    = (personId) => req('GET',    `/emails?person_id=${personId}`)
export const createEmail  = (data)     => req('POST',   '/emails', data)
export const deleteEmail  = (id)       => req('DELETE', `/emails/${id}`)

// Accounting
export const getAccountingSummary     = ()              => req('GET',    '/accounting/summary')
export const getAccountingReports     = ()              => req('GET',    '/accounting/reports')
export const getLedger                = (propertyId)    => req('GET',    `/accounting/${propertyId}/transactions`)
export const createTransactions       = (propertyId, d) => req('POST',   `/accounting/${propertyId}/transactions`, d)
export const updateTransaction        = (id, d)         => req('PUT',    `/accounting/transactions/${id}`, d)
export const deleteTransaction        = (id)            => req('DELETE', `/accounting/transactions/${id}`)
export const categorizeTransactions   = (transactions)  => req('POST',   '/accounting/categorize', { transactions })
export const learnCategories          = (items)         => req('POST',   '/accounting/learn-categories', { items })
export const getCategoryRules         = ()              => req('GET',    '/accounting/rules')
export const deleteCategoryRule       = (id)            => req('DELETE', `/accounting/rules/${id}`)
// Charge-type registry
export const getCategories            = ()              => req('GET',    '/accounting/categories')
export const createCategory           = (d)             => req('POST',   '/accounting/categories', d)
export const deleteCategory           = (id)            => req('DELETE', `/accounting/categories/${id}`)
// Split a transaction into multiple lines
export const splitTransaction         = (id, splits)    => req('POST',   `/accounting/transactions/${id}/split`, { splits })

// Loan amortization schedule
export const getAmortization          = (propertyId)    => req('GET',    `/accounting/${propertyId}/amortization`)
export const deleteAmortization       = (id)            => req('DELETE', `/accounting/amortization/${id}`)
export async function uploadAmortization(propertyId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/accounting/${propertyId}/amortization`, fd)
}

// In-app AI copilot
export const askAssistant             = (messages, context) => req('POST', '/assistant/chat', { messages, context })
export const executeAssistantAction   = (action)            => req('POST', '/assistant/execute', action)
export const reconcileTransaction     = (id, val)       => req('PATCH',  `/accounting/transactions/${id}/reconcile`, { reconciled: val })
export const recordTransaction        = (id, d = {})    => req('PATCH',  `/accounting/transactions/${id}/record`, d)
export const unrecordTransaction      = (id)            => req('PATCH',  `/accounting/transactions/${id}/unrecord`)
export const recordAllTransactions    = (propertyId)    => req('POST',   `/accounting/${propertyId}/transactions/record-all`)
export const autoRecordTransactions   = (propertyId)    => req('POST',   `/accounting/${propertyId}/auto-record`)
export const getReviewSuggestions     = (propertyId)    => req('GET',    `/accounting/${propertyId}/review-suggestions`)
export const getPropertyInvestorsList = (propertyId)    => req('GET',    `/accounting/${propertyId}/investors-list`)
export const getCapitalAccounts       = (propertyId)    => req('GET',    `/accounting/${propertyId}/capital-accounts`)
export const setTransactionInvestor   = (id, investorId)=> req('PATCH',  `/accounting/transactions/${id}/investor`, { investor_id: investorId })
export const getInvestorSuggestions   = (propertyId)    => req('GET',    `/accounting/${propertyId}/investor-suggestions`)
export const autoAttributeInvestors   = (propertyId)    => req('POST',   `/accounting/${propertyId}/auto-attribute-investors`)
export const getAccountingSettings    = ()              => req('GET',    '/accounting/settings')
export const updateAccountingSettings = (d)             => req('PATCH',  '/accounting/settings', d)
export const getOpeningBalances       = (propertyId)    => req('GET',    `/accounting/${propertyId}/opening-balances`)
export const saveOpeningBalances      = (propertyId, d) => req('PUT',    `/accounting/${propertyId}/opening-balances`, d)

// Budgets
export const getBudget  = (propertyId, year) => req('GET', `/accounting/${propertyId}/budget?year=${year}`)
export const saveBudget = (propertyId, year, budgets) => req('PUT', `/accounting/${propertyId}/budget`, { year, budgets })

// Bills (Accounts Payable)
export const getBills    = (propertyId)    => req('GET',    `/accounting/${propertyId}/bills`)
export const createBill  = (propertyId, d) => req('POST',   `/accounting/${propertyId}/bills`, d)
export const updateBill  = (id, d)         => req('PUT',    `/accounting/bills/${id}`, d)
export const payBill     = (id, paidDate)  => req('POST',   `/accounting/bills/${id}/pay`, paidDate ? { paid_date: paidDate } : {})
export const deleteBill  = (id)            => req('DELETE', `/accounting/bills/${id}`)

// Investor distributions (property + portfolio views)
export const getPropertyDistributions = (propertyId) => req('GET', `/accounting/${propertyId}/distributions`)
export const getAllDistributions      = ()            => req('GET', '/accounting/distributions')
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
export const linkCapTableInvestor       = (id, investorId)=> req('PATCH',  `/accounting/investors/${id}/link`, { investor_id: investorId })
export const removeInvestorExcelEntries = (propertyId)   => req('DELETE', `/accounting/${propertyId}/investor-excel-entries`)
export const deleteInvestor            = (id)            => req('DELETE', `/accounting/investors/${id}`)
export async function uploadInvestorContributions(propertyId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/accounting/${propertyId}/investors/upload`, fd)
}

// Investors (CRM master profiles)
export const getCRMInvestors = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return req('GET', `/investors${qs ? '?' + qs : ''}`)
}
export const getInvestorProfile  = (id)     => req('GET',    `/investors/${id}`)
export const createInvestor      = (data)   => req('POST',   '/investors', data)
export const updateInvestor      = (id, d)  => req('PATCH',  `/investors/${id}`, d)
export const deleteInvestorRecord = (id)    => req('DELETE', `/investors/${id}`)
export const bulkDeleteInvestors = (opts)   => req('POST',   '/investors/bulk-delete', opts) // { ids } or { all: true }
export const getInvestorContacts   = (id)        => req('GET',    `/investors/${id}/contacts`)
export const addInvestorContact    = (id, data)  => req('POST',   `/investors/${id}/contacts`, data)
export const updateInvestorContact = (cid, data) => req('PATCH',  `/investors/contacts/${cid}`, data)
export const deleteInvestorContact = (cid)       => req('DELETE', `/investors/contacts/${cid}`)
export const matchInvestorNames  = (names)  => req('POST',   '/investors/match', { names })
export const confirmInvestorMatch = (data)  => req('POST',   '/investors/match/confirm', data)

// Investor property links
export const getInvestorLinks   = (investorId)       => req('GET',    `/investors/${investorId}/links`)
export const createInvestorLink = (investorId, data)  => req('POST',   `/investors/${investorId}/links`, data)
export const updateInvestorLink = (linkId, data)      => req('PATCH',  `/investors/links/${linkId}`, data)
export const deleteInvestorLink = (linkId)            => req('DELETE', `/investors/links/${linkId}`)

// Investor distributions
export const getInvestorDistributions  = (investorId)       => req('GET',    `/investors/${investorId}/distributions`)
export const createDistribution        = (investorId, data)  => req('POST',   `/investors/${investorId}/distributions`, data)
export const deleteDistribution        = (distId)            => req('DELETE', `/investors/distributions/${distId}`)

export const bulkImportInvestors = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', '/investors/bulk-import', fd)
}

// Allocations import (preview + confirm)
export const previewAllocations = (file) => {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', '/investors/allocations/preview', fd)
}
export const importAllocations = (file, mapping) => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('mapping', JSON.stringify(mapping))
  return req('POST', '/investors/allocations/import', fd)
}

// Legacy alias kept for any existing code
export const getInvestor = (id) => req('GET', `/investors/${id}`)

// Plaid bank connections
export const createPlaidLinkToken = ()        => req('POST',   '/plaid/link-token')
export const exchangePlaidToken   = (data)    => req('POST',   '/plaid/exchange-token', data)
export const getPlaidConnections  = (propId)  => req('GET',    `/plaid/${propId}/connections`)
export const getPlaidBalance      = (propId)  => req('GET',    `/plaid/${propId}/balance`)
export const syncPlaidConnection  = (connId)  => req('POST',   `/plaid/connections/${connId}/sync`)
export const disconnectPlaid      = (connId)  => req('DELETE', `/plaid/connections/${connId}`)

// Property Management
export const getManagementDashboard  = ()               => req('GET', '/management/dashboard')
export const getAllManagementTasks   = (status = 'pending') =>
  req('GET', `/management/tasks?status=${status}`)

// Tasks
export const getPropertyTasks   = (propId)       => req('GET',    `/management/${propId}/tasks`)
export const createTask         = (propId, data)  => req('POST',   `/management/${propId}/tasks`, data)
export const updateTask         = (id, data)      => req('PUT',    `/management/tasks/${id}`, data)
export const completeTask       = (id)            => req('POST',   `/management/tasks/${id}/complete`)
export const deleteTask         = (id)            => req('DELETE', `/management/tasks/${id}`)

// Insurance
export const getAllInsurance        = ()            => req('GET',    `/management/insurance/all`)
export const getPropertyInsurance  = (propId)      => req('GET',    `/management/${propId}/insurance`)
export const createInsurance       = (propId, data) => req('POST',   `/management/${propId}/insurance`, data)
export const updateInsurance       = (id, data)     => req('PUT',    `/management/insurance/${id}`, data)
export const deleteInsurance       = (id)           => req('DELETE', `/management/insurance/${id}`)
export const markInsurancePaid     = (id, paid)     => req('PATCH',  `/management/insurance/${id}/paid`, { paid })
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

// Handwrytten
export const getHandwryttenCards      = ()          => req('GET', '/handwrytten/cards')
export const getHandwryttenFonts      = ()          => req('GET', '/handwrytten/fonts')
export const sendHandwryttenLetter    = (data)      => req('POST', '/handwrytten/send', data)
export const sendHandwryttenBulk      = (data)      => req('POST', '/handwrytten/send-bulk', data)
export const sendHandwryttenBasket    = (data)      => req('POST', '/handwrytten/send-basket', data) // TEST: one batched order
export async function downloadHandwryttenBulkFile(data) {
  const res = await fetch('/api/handwrytten/bulk-file', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'include', body: JSON.stringify(data),
  })
  if (!res.ok) {
    let msg = 'Failed to generate the bulk file'
    try { msg = (await res.json()).error || msg } catch {}
    throw new Error(msg)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `handwrytten-bulk-${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}
export const getHandwryttenSends      = (params={}) => {
  const qs = new URLSearchParams(params).toString()
  return req('GET', `/handwrytten/sends${qs ? '?' + qs : ''}`)
}
export const getHandwryttenContactSends = (contactId) =>
  req('GET', `/handwrytten/sends/contact/${contactId}`)
export const getHandwryttenCampaigns  = (params={}) => {
  const qs = new URLSearchParams(params).toString()
  return req('GET', `/handwrytten/campaigns${qs ? '?' + qs : ''}`)
}
export const getMailResponseSummary  = ()                  => req('GET',   '/handwrytten/response-summary')
export const markSendResponded       = (id, responded, channel='manual') => req('PATCH', `/handwrytten/sends/${id}/responded`, { responded, channel })
export const setMailPause            = (personId, duration, reason=null)  => req('PATCH', `/people/${personId}/mail-pause`, { duration, reason })

// Drip campaigns (throttled "X letters every N days")
export const createHandwryttenDrip = (data)        => req('POST',  '/handwrytten/drips', data)
export const getHandwryttenDrips   = ()            => req('GET',   '/handwrytten/drips')
export const getHandwryttenDrip    = (id)          => req('GET',   `/handwrytten/drips/${id}`)
export const updateHandwryttenDrip = (id, data)    => req('PATCH', `/handwrytten/drips/${id}`, data)
export const cancelHandwryttenDrip = (id)          => req('POST',  `/handwrytten/drips/${id}/cancel`)
