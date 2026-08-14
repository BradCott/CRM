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
export const mergeTenantBrands = (data)   => req('POST',   '/tenant-brands/merge', data) // { keep_id, merge_ids, name }
export const getOperators      = ()       => req('GET',    '/operators')
export const createOperator    = (data)   => req('POST',   '/operators', data)
export const updateOperator    = (id, d)  => req('PUT',    `/operators/${id}`, d)
export const deleteOperator    = (id)     => req('DELETE', `/operators/${id}`)
export const mergeOperators    = (into, from) => req('POST', '/operators/merge', { into, from })

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
export const getPersonNotes = (id)       => req('GET',    `/people/${id}/notes`)
export const addPersonNote  = (id, note) => req('POST',   `/people/${id}/notes`, { note })
export const deletePersonNote = (noteId) => req('DELETE', `/people/notes/${noteId}`)

// Properties — paginated
export const getProperties   = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return req('GET', `/properties${qs ? '?' + qs : ''}`)
}
export const getAllProperties     = ()       => req('GET',    '/properties/all')
export const getOperatorBreakdown = (params = {}) => {
  const qs = new URLSearchParams(params).toString()
  return req('GET', `/properties/operator-breakdown${qs ? '?' + qs : ''}`)
}
export const getPropertyFeeSummary = ()   => req('GET',    '/properties/fee-summary')
export const getPropertyStates = ()     => req('GET',    '/properties/states')
export const getProperty     = (id)     => req('GET',    `/properties/${id}`)
export const createProperty  = (data)   => req('POST',   '/properties', data)
export const updateProperty  = (id, d)  => req('PUT',    `/properties/${id}`, d)
export const updatePropertyField = (id, column, value) => req('PATCH', `/properties/${id}/field`, { column, value })
// relation ∈ 'tenant' | 'operator' | 'owner'. Pass {id} to link an existing record,
// {name} to find-or-create by name, or {} to clear the link.
export const updatePropertyRelation = (id, relation, payload) => req('PATCH', `/properties/${id}/relation`, { relation, ...payload })
export const deleteProperty        = (id)     => req('DELETE', `/properties/${id}`)
export const getPropertyDriveDocs  = (id, rematch = false) => req('GET', `/properties/${id}/drive-docs${rematch ? '?rematch=1' : ''}`)
// Fetch a Drive file's bytes and wrap it as a File, so it can be fed to the
// settlement / amortization / investor importers exactly like a local upload.
export async function fetchDriveFileAsFile(fileId, name) {
  const res = await fetch(`${BASE}/properties/drive-file/${fileId}`, { credentials: 'include' })
  if (!res.ok) throw new Error((await res.text()) || 'Could not fetch the Drive file')
  const blob = await res.blob()
  return new File([blob], name || 'drive-file', { type: blob.type })
}
export const bulkDeleteProperties  = (ids)    => req('POST', '/properties/bulk-delete', { ids })
export const prepareTenantNotify   = (id)     => req('GET',  `/properties/${id}/tenant-notify/prepare`)
export const sendTenantNotify      = (id, d)  => req('POST', `/properties/${id}/tenant-notify/send`, d)
export const togglePortfolio       = (id, val) => req('PATCH',  `/properties/${id}/portfolio`, { is_portfolio: val })
export const getHistoricalTransactions = ()      => req('GET',   '/properties/historical')
export const markPropertySold      = (id, data)  => req('PATCH', `/properties/${id}/sold`, data)
export const updateHistorical      = (id, data)  => req('PATCH', `/properties/${id}/historical`, data)
export const createHistorical      = (data)      => req('POST',  '/properties/historical', data)

// Deals
export const getDeals       = ()       => req('GET',    '/deals')
export const getDeal        = (id)     => req('GET',    `/deals/${id}`)
export const updateDealField = (id, column, value) => req('PATCH', `/deals/${id}/field`, { column, value })
export async function parseDealDoc(id, files, docType = 'auto') {
  const fd = new FormData()
  fd.append('docType', docType)
  for (const f of files) fd.append('files', f)
  return req('POST', `/deals/${id}/parse`, fd)   // { deal, docType, applied|proposal }
}
export const deleteDealProposal = (dealId, pid) => req('DELETE', `/deals/${dealId}/proposals/${pid}`)
export const getDroppedDeals = ()      => req('GET',    '/deals/dropped')
export const createDeal     = (data)   => req('POST',   '/deals', data)
export const updateDeal     = (id, d)  => req('PUT',    `/deals/${id}`, d)
export const patchDealStage = (id, s)  => req('PATCH',  `/deals/${id}/stage`, { stage: s })
export const deleteDeal     = (id)     => req('DELETE', `/deals/${id}`)
export const closeDealApi   = (id)     => req('POST',   `/deals/${id}/close`)
export const dropDealApi    = (id)     => req('POST',   `/deals/${id}/drop`)
export const restoreDealApi    = (id)           => req('POST',  `/deals/${id}/restore`)
export const linkDealProperty  = (id, propId)   => req('PATCH', `/deals/${id}/link-property`, { property_id: propId })
// Create a new market property from a deal's own details and link it in one step.
export const createPropertyFromDeal = (id, data = {}) => req('POST', `/deals/${id}/create-property`, data)

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
export const getCriticalDates           = () => req('GET', '/dashboard/critical-dates')   // { deal, portfolio }
// Mark one computed Critical Date cleared / restore it. key = { entity_type, entity_id, kind, date }
export const completeCriticalDate       = (key) => req('POST',   '/dashboard/critical-dates/complete', key)
export const uncompleteCriticalDate     = (key) => req('DELETE', '/dashboard/critical-dates/complete', key)
export const getTreasury                   = () => req('GET', '/dashboard/treasury')

// Google OAuth / Drive
// Full-data backup / export (admin)
export const getBackupInfo    = ()     => req('GET', '/admin/backup/info')
export const backupDbUrl      = '/api/admin/backup'
export const exportJsonUrl    = '/api/admin/export-json'
export const exportExcelUrl   = '/api/admin/export-excel'

export const getGoogleStatus  = ()     => req('GET',    '/auth/google/status')
export const disconnectGoogle = ()     => req('DELETE', '/auth/google')
export const getEmailFrom     = ()     => req('GET',    '/auth/email-settings')
export const setEmailFrom     = (from) => req('PUT',    '/auth/email-settings', { from })
export const getSenderStatus  = ()     => req('GET',    '/auth/google/sender/status')
export const disconnectSender = ()     => req('DELETE', '/auth/google/sender')
// Per-user Gmail for Today's Plays
export const getMyGmailStatus = ()     => req('GET',    '/auth/google/gmail/status')
export const disconnectMyGmail = ()    => req('DELETE', '/auth/google/gmail')
export const refreshMyDigest  = ()     => req('POST',   '/plays/gmail/refresh')
export const connectMyGmailUrl = '/api/auth/google/gmail'
export const getSendAccounts  = ()     => req('GET',    '/auth/send-accounts')
export const connectSendAccountUrl = (returnPath) => `/api/auth/google/send-account?return=${encodeURIComponent(returnPath || '/accounting')}`
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
export const applyAmortization        = (propertyId)    => req('POST',   `/accounting/${propertyId}/amortization/apply`)
export async function reconcileAmortization(propertyId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/accounting/${propertyId}/amortization/reconcile`, fd)
}
export async function uploadAmortization(propertyId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/accounting/${propertyId}/amortization`, fd)
}

// In-app AI copilot
export const askAssistant             = (messages, context, attachments) => req('POST', '/assistant/chat', { messages, context, attachments })
export const executeAssistantAction   = (action)            => req('POST', '/assistant/execute', action)
export const reconcileTransaction     = (id, val)       => req('PATCH',  `/accounting/transactions/${id}/reconcile`, { reconciled: val })
export const reconcileBatch           = (ids)           => req('POST',   '/accounting/transactions/reconcile-batch', { ids })
export const recordTransaction        = (id, d = {})    => req('PATCH',  `/accounting/transactions/${id}/record`, d)
export const unrecordTransaction      = (id)            => req('PATCH',  `/accounting/transactions/${id}/unrecord`)
export const matchTransaction         = (id, note, matchedToId = null) => req('PATCH', `/accounting/transactions/${id}/match`, { note, matched_to_id: matchedToId })
export const unmatchTransaction       = (id)            => req('PATCH',  `/accounting/transactions/${id}/unmatch`)
export const getMatchCandidates       = (propertyId, amount, excludeId) =>
  req('GET', `/accounting/${propertyId}/match-candidates?amount=${encodeURIComponent(amount)}&exclude=${excludeId}`)
export const recordEarnestAsEquity    = (id, investorId) => req('POST', `/accounting/transactions/${id}/record-as-equity`, { investor_id: investorId })
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
export const saleCloseout             = (propertyId, d) => req('POST', `/accounting/${propertyId}/sale-closeout`, d)
export const estimateEntityTax        = (propertyId, d) => req('POST', `/accounting/${propertyId}/estimate-entity-tax`, d)
export const setDepreciationYears     = (propertyId, years) => req('POST', `/accounting/${propertyId}/depreciation`, { years })
export const reconcileCash            = (propertyId, d) => req('POST', `/accounting/${propertyId}/reconcile-cash`, d)
export const getCashAdjustments       = ()  => req('GET',  '/accounting/cash-adjustments')
export const clearCashAdjustments     = (d) => req('POST', '/accounting/cash-adjustments/clear', d)  // { ids } or { all: true }
export const emailAccountantBundle    = (propertyId, d) => req('POST', `/accounting/${propertyId}/email-bundle`, d)
export const getInvestorReturns       = (propertyId) => req('GET',  `/accounting/${propertyId}/investor-returns`)
export const draftInvestorEmail       = (propertyId, d) => req('POST', `/accounting/${propertyId}/draft-investor-email`, d)
export const emailInvestors           = (propertyId, d) => req('POST', `/accounting/${propertyId}/email-investors`, d)
export const getCloseoutStatus        = (propertyId) => req('GET',  `/accounting/${propertyId}/closeout-status`)
export const reverseCloseout          = (propertyId) => req('POST', `/accounting/${propertyId}/reverse-closeout`)
export async function uploadSaleSettlement(propertyId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/accounting/${propertyId}/sale-settlement`, fd)
}
export async function uploadSettlement(propertyId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/accounting/${propertyId}/settlement`, fd)
}
export async function rebalanceSettlement(propertyId, file, payload) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('payload', JSON.stringify(payload))
  return req('POST', `/accounting/${propertyId}/settlement/rebalance`, fd)
}
export async function uploadBankStatement(propertyId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/accounting/${propertyId}/bank-statement`, fd)
}

// Stored settlement-statement PDFs (buy + sale) — auto-attached to accountant pkg
export const getSettlementDocs   = (propertyId)        => req('GET',    `/accounting/${propertyId}/settlement-docs`)
export const deleteSettlementDoc = (propertyId, docId) => req('DELETE', `/accounting/${propertyId}/settlement-docs/${docId}`)
export const settlementDocFileUrl = (propertyId, docId) => `${BASE}/accounting/${propertyId}/settlement-docs/${docId}/file`
export async function uploadSettlementDoc(propertyId, kind, file) {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('kind', kind)
  return req('POST', `/accounting/${propertyId}/settlement-docs`, fd)
}

// Settlement record (persisted snapshot for the Settlement tab)
export const getSettlementRecord  = (propertyId)    => req('GET',  `/accounting/${propertyId}/settlement-record`)
export const saveSettlementRecord = (propertyId, d) => req('POST', `/accounting/${propertyId}/settlement-record`, d)

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
export const mergeInvestors      = (opts)   => req('POST',   '/investors/merge', opts) // { keep_id, merge_ids, name }
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
export const getPlaidStatus       = ()        => req('GET',    '/plaid/status')
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
// Insurance documents + tenant reimbursement
export const getInsuranceDocuments = (insId)        => req('GET',    `/management/insurance/${insId}/documents`)
export const insuranceDocUrl       = (insId, docId) => `${BASE}/management/insurance/${insId}/documents/${docId}/file`
export const deleteInsuranceDoc    = (insId, docId) => req('DELETE', `/management/insurance/${insId}/documents/${docId}`)
export const extractInsBreakdown     = (insId)      => req('POST',   `/management/insurance/${insId}/extract-breakdown`)
export const prepareInsReimbursement = (insId)      => req('GET',    `/management/insurance/${insId}/reimbursement/prepare`)
export const sendInsReimbursement    = (insId, d)   => req('POST',   `/management/insurance/${insId}/reimbursement/send`, d)
export async function uploadInsuranceDoc(insId, file, docType) {
  const fd = new FormData(); fd.append('file', file); if (docType) fd.append('doc_type', docType)
  return req('POST', `/management/insurance/${insId}/documents`, fd)
}

// Investor portal (separate auth surface)
export const portalMe            = ()               => req('GET',  '/portal/me')
export const portalPortfolio     = ()               => req('GET',  '/portal/portfolio')
export const portalUpdateProfile = (data)           => req('PATCH','/portal/profile', data)
export const portalChangeEmail   = (email)          => req('POST', '/portal/email/change', { email })
export const portalDocuments     = ()               => req('GET',  '/portal/documents')
export const portalDocUrl        = (id)             => `${BASE}/portal/documents/${id}/file`
export const deletePortalDoc     = (id)             => req('DELETE', `/portal/documents/${id}`)
export async function uploadPortalDoc(file, category) {
  const fd = new FormData(); fd.append('file', file); if (category) fd.append('category', category)
  return req('POST', '/portal/documents', fd)
}
// CRM side: investor documents
export const getInvestorDocuments = (id)            => req('GET',    `/investors/${id}/documents`)
export const investorDocUrl       = (id, docId)     => `${BASE}/investors/${id}/documents/${docId}/file`
export const deleteInvestorDoc    = (id, docId)     => req('DELETE', `/investors/${id}/documents/${docId}`)
export async function uploadInvestorDoc(id, file, category) {
  const fd = new FormData(); fd.append('file', file); if (category) fd.append('category', category)
  return req('POST', `/investors/${id}/documents`, fd)
}
export const portalPasswordLogin = (email, password) => req('POST', '/portal/auth/password', { email, password })
export const portalInviteInfo    = (token)          => req('GET',  `/portal/auth/invite/${token}`)
export const portalAccept        = (token, password, name) => req('POST', '/portal/auth/accept', { token, password, name })
export const portalLogout        = ()               => req('POST', '/portal/logout')
export const portalGoogleStartUrl = ()              => `${BASE}/portal/auth/google/start`
// CRM side: invite an investor to the portal
export const invitePortal        = (investorId, email) => req('POST', `/investors/${investorId}/portal-invite`, { email })

// Property dashboard
export const getPropertyDash     = (propId)      => req('GET',   `/management/${propId}/dash`)
export const markInsuranceReimbursed = (insId, status) => req('PATCH', `/management/insurance/${insId}/reimbursed`, { status })
export const getCallNotes        = (propId)      => req('GET',   `/management/${propId}/call-notes`)
export const addCallNote         = (propId, note) => req('POST',  `/management/${propId}/call-notes`, { note })
export const deleteCallNote      = (id)          => req('DELETE', `/management/call-notes/${id}`)
export const updatePropertyDash  = (propId, data) => req('PATCH', `/management/${propId}/dash`, data)
export const updatePropertyDisplayName = (propId, display_name) => req('PATCH', `/management/${propId}/display-name`, { display_name })
export const updatePropertyDisplaySubtitle = (propId, display_subtitle) => req('PATCH', `/management/${propId}/display-subtitle`, { display_subtitle })
// Auto-fill property from documents (review-and-confirm)
export const getExtractDiff      = (propId, docType, data) => req('POST', `/management/${propId}/extract-diff`, { docType, data })
export const applyExtracted      = (propId, fields, tenantName) => req('PATCH', `/management/${propId}/apply-extracted`, { fields, tenantName })
export async function parseMarketingPackage(propId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/management/${propId}/marketing/parse`, fd)
}
export const propertyPhotoUrl    = (propId)      => `${BASE}/management/${propId}/photo`
export async function uploadPropertyPhoto(propId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/management/${propId}/photo`, fd)
}

// Lease abstraction (base lease + amendments/exhibits)
export const getPropertyLease     = (propId)        => req('GET',    `/management/${propId}/lease`)
export const deletePropertyLease  = (propId)        => req('DELETE', `/management/${propId}/lease`)
export const deleteLeaseDocument  = (propId, docId) => req('DELETE', `/management/${propId}/lease/documents/${docId}`)
export const leaseDocumentUrl     = (propId, docId) => `${BASE}/management/${propId}/lease/documents/${docId}/file`
export async function uploadPropertyLease(propId, file, docType) {
  const fd = new FormData()
  fd.append('file', file)
  if (docType) fd.append('doc_type', docType)
  return req('POST', `/management/${propId}/lease/upload`, fd)
}

// Taxes
export const getPropertyTaxes  = (propId)      => req('GET',    `/management/${propId}/taxes`)
export const createTax         = (propId, data) => req('POST',   `/management/${propId}/taxes`, data)
export const updateTax         = (id, data)     => req('PUT',    `/management/taxes/${id}`, data)
export const deleteTax         = (id)           => req('DELETE', `/management/taxes/${id}`)
export const markTaxPaid       = (id, paid)     => req('PATCH',  `/management/taxes/${id}/paid`, { paid })
export async function uploadTaxPdf(propId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/management/${propId}/taxes/upload`, fd)
}
// Tax documents (the uploaded tax bill)
export const getTaxDocuments = (taxId)        => req('GET',    `/management/taxes/${taxId}/documents`)
export const taxDocUrl       = (taxId, docId) => `${BASE}/management/taxes/${taxId}/documents/${docId}/file`
export const deleteTaxDoc    = (taxId, docId) => req('DELETE', `/management/taxes/${taxId}/documents/${docId}`)
export async function uploadTaxDoc(taxId, file, docType) {
  const fd = new FormData(); fd.append('file', file); if (docType) fd.append('doc_type', docType)
  return req('POST', `/management/taxes/${taxId}/documents`, fd)
}
export const prepareTaxReimbursement = (taxId)      => req('GET',  `/management/taxes/${taxId}/reimbursement/prepare`)
export const sendTaxReimbursement    = (taxId, data) => req('POST', `/management/taxes/${taxId}/reimbursement/send`, data)
// Tax installments (1st half / 2nd half payments)
export const getTaxInstallments   = (taxId)       => req('GET',    `/management/taxes/${taxId}/installments`)
export const addTaxInstallment    = (taxId, data) => req('POST',   `/management/taxes/${taxId}/installments`, data)
export const updateTaxInstallment = (iid, data)   => req('PUT',    `/management/taxes/installments/${iid}`, data)
export const deleteTaxInstallment = (iid)         => req('DELETE', `/management/taxes/installments/${iid}`)

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

// Reimbursements (tenant expense recovery)
export const getAllReimbursements     = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()
  return req('GET', `/management/reimbursements${qs ? `?${qs}` : ''}`)
}
export const getReimbursementSummary  = ()            => req('GET',    `/management/reimbursements/summary`)
export const getDashboardBreakdown     = (metric)      => req('GET',    `/management/dashboard/breakdown?metric=${encodeURIComponent(metric)}`)
export const getPropertyReimbursements = (propId)     => req('GET',    `/management/${propId}/reimbursements`)
export const createReimbursement      = (propId, data) => req('POST',   `/management/${propId}/reimbursements`, data)
export const updateReimbursement      = (id, data)     => req('PUT',    `/management/reimbursements/${id}`, data)
export const billReimbursement        = (id, data = {}) => req('PATCH',  `/management/reimbursements/${id}/bill`, data)
export const receiveReimbursement     = (id, data = {}) => req('PATCH',  `/management/reimbursements/${id}/receive`, data)
export const deleteReimbursement      = (id)           => req('DELETE', `/management/reimbursements/${id}`)

// Expense reimbursement methods (per property + expense type)
export const getExpenseSettings       = (propId)         => req('GET', `/management/${propId}/expense-settings`)
export const updateExpenseSetting     = (propId, type, data) => req('PUT', `/management/${propId}/expense-settings/${type}`, data)

// Monthly installments ledger
export const getInstallments          = (propId, params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()
  return req('GET', `/management/${propId}/installments${qs ? `?${qs}` : ''}`)
}
export const saveInstallment          = (propId, data)   => req('PUT',    `/management/${propId}/installments`, data)
export const fillInstallments         = (propId, data)   => req('PUT',    `/management/${propId}/installments/fill`, data)
export const deleteInstallment        = (id)             => req('DELETE', `/management/installments/${id}`)

// Year-end reconciliation
export const getReconciliationSuggestions = (propId, params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()
  return req('GET', `/management/${propId}/reconciliation-suggestions${qs ? `?${qs}` : ''}`)
}
export const getReconciliations       = (propId, params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()
  return req('GET', `/management/${propId}/reconciliations${qs ? `?${qs}` : ''}`)
}
export const saveReconciliation       = (propId, data)   => req('PUT',    `/management/${propId}/reconciliations`, data)
export const postReconciliation       = (id)             => req('POST',   `/management/reconciliations/${id}/post`)
export const unpostReconciliation     = (id)             => req('POST',   `/management/reconciliations/${id}/unpost`)
export const deleteReconciliation     = (id)             => req('DELETE', `/management/reconciliations/${id}`)

// CAM invoices (property-work costs that roll up into CAM actuals)
export const getCamInvoices           = (propId, params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString()
  return req('GET', `/management/${propId}/cam-invoices${qs ? `?${qs}` : ''}`)
}
export const createCamInvoice         = (propId, data)   => req('POST',   `/management/${propId}/cam-invoices`, data)
export async function uploadCamInvoice(propId, file, fields = {}) {
  const fd = new FormData()
  if (file) fd.append('file', file)
  for (const [k, v] of Object.entries(fields)) if (v != null && v !== '') fd.append(k, v)
  return req('POST', `/management/${propId}/cam-invoices/upload`, fd)
}
export async function parseCamInvoice(propId, file) {
  const fd = new FormData()
  fd.append('file', file)
  return req('POST', `/management/${propId}/cam-invoices/parse`, fd)
}
export const updateCamInvoice         = (id, data)       => req('PUT',    `/management/cam-invoices/${id}`, data)
export const deleteCamInvoice         = (id)             => req('DELETE', `/management/cam-invoices/${id}`)
export const camInvoiceUrl            = (id)             => `${BASE}/management/cam-invoices/${id}/file`

// Per-type reimbursement status (dashboard net card)
export const markExpenseReimbursed    = (propId, type, year, status) =>
  req('PATCH', `/management/${propId}/expense-reimbursement/${type}`, { year, status })

// Handwrytten
export const getHandwryttenCards      = ()          => req('GET', '/handwrytten/cards')
export const getHandwryttenFonts      = ()          => req('GET', '/handwrytten/fonts')
export const getHwSignatures          = ()          => req('GET',   '/handwrytten/signatures')
export const addHwSignature           = (data)      => req('POST',  '/handwrytten/signatures', data)
export const setDefaultHwSignature    = (id)        => req('PATCH', `/handwrytten/signatures/${id}/default`)
export const deleteHwSignature        = (id)        => req('DELETE',`/handwrytten/signatures/${id}`)
export const sendHandwryttenLetter    = (data)      => req('POST', '/handwrytten/send', data)
export const sendHandwryttenBulk      = (data)      => req('POST', '/handwrytten/send-bulk', data)
export const sendHandwryttenProof     = (data)      => req('POST', '/handwrytten/send-proof', data)
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
export const deleteHandwryttenCampaign = (id)      => req('DELETE', `/handwrytten/campaigns/${id}`)
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
export const getHandwryttenDripQueue = (id)        => req('GET',   `/handwrytten/drips/${id}/queue`)
export const retryHandwryttenDripFailed = (id)     => req('POST',  `/handwrytten/drips/${id}/retry-failed`)
export const updateHandwryttenDrip = (id, data)    => req('PATCH', `/handwrytten/drips/${id}`, data)
export const cancelHandwryttenDrip = (id)          => req('POST',  `/handwrytten/drips/${id}/cancel`)
