import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import {
  getTenantBrands, createTenantBrand, updateTenantBrand, deleteTenantBrand,
  getAllPeople, createPerson, updatePerson, deletePerson,
  getAllProperties, getPropertyStates,
  createProperty, updateProperty, deleteProperty,
  getDeals, createDeal, updateDeal, patchDealStage, deleteDeal,
  closeDealApi, dropDealApi, restoreDealApi,
  getImportStats,
} from '../api/client'
import { DEFAULT_STAGES } from '../utils/constants'

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [tenantBrands, setTenantBrands] = useState([])
  // People and properties use server-side pagination in their pages,
  // but we keep a lightweight "all" list for dropdowns
  const [allPeople, setAllPeople]         = useState([])
  const [allProperties, setAllProperties] = useState([])
  const [propertyStates, setPropertyStates] = useState([])
  const [deals, setDeals]                 = useState([])
  const [stages]                          = useState(DEFAULT_STAGES)
  const [toast, setToast]                 = useState(null)
  const [loading, setLoading]             = useState(true)
  const [importStats, setImportStats]     = useState(null)

  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type, id: Date.now() })
    setTimeout(() => setToast(null), 3500)
  }, [])

  const loadDropdowns = useCallback(async () => {
    const [tb, ppl, props, states, de] = await Promise.all([
      getTenantBrands(),
      getAllPeople(),
      getAllProperties(),
      getPropertyStates(),
      getDeals(),
    ])
    setTenantBrands(tb)
    setAllPeople(ppl)
    setAllProperties(props)
    setPropertyStates(states)
    setDeals(de)
  }, [])

  useEffect(() => {
    loadDropdowns()
      .catch(e => console.error('Failed to load data:', e))
      .finally(() => setLoading(false))
  }, [loadDropdowns])

  const refreshStats = useCallback(async () => {
    const s = await getImportStats()
    setImportStats(s)
    return s
  }, [])

  // --- Tenant Brands ---
  const addTenantBrand = useCallback(async (data) => {
    const row = await createTenantBrand(data)
    setTenantBrands(prev => [...prev, row].sort((a,b) => a.name.localeCompare(b.name)))
    notify('Tenant brand created')
  }, [notify])

  const editTenantBrand = useCallback(async (id, data) => {
    const row = await updateTenantBrand(id, data)
    setTenantBrands(prev => prev.map(x => x.id === id ? row : x))
    notify('Tenant brand updated')
  }, [notify])

  const removeTenantBrand = useCallback(async (id) => {
    await deleteTenantBrand(id)
    setTenantBrands(prev => prev.filter(x => x.id !== id))
    notify('Tenant brand deleted')
  }, [notify])

  // --- People (dropdown list + CRUD) ---
  const addPerson = useCallback(async (data) => {
    const row = await createPerson(data)
    setAllPeople(prev => [...prev, { id: row.id, name: row.name, role: row.role, company_id: row.company_id }].sort((a,b) => a.name.localeCompare(b.name)))
    notify('Person created')
    return row
  }, [notify])

  const editPerson = useCallback(async (id, data) => {
    const row = await updatePerson(id, data)
    setAllPeople(prev => prev.map(x => x.id === id ? { id: row.id, name: row.name, role: row.role, company_id: row.company_id } : x))
    notify('Person updated')
    return row
  }, [notify])

  const removePerson = useCallback(async (id) => {
    await deletePerson(id)
    setAllPeople(prev => prev.filter(x => x.id !== id))
    notify('Person deleted')
  }, [notify])

  // --- Properties (dropdown list + CRUD) ---
  const addProperty = useCallback(async (data) => {
    const row = await createProperty(data)
    setAllProperties(prev => [{ id: row.id, address: row.address, city: row.city, state: row.state, tenant_brand_name: row.tenant_brand_name }, ...prev])
    notify('Property created')
    return row
  }, [notify])

  const editProperty = useCallback(async (id, data) => {
    console.log('[AppContext] editProperty id:', id, '| sending keys:', Object.keys(data))
    const row = await updateProperty(id, data)
    console.log('[AppContext] editProperty server response id:', row?.id, '| address:', row?.address)
    setAllProperties(prev => prev.map(x => x.id === id ? { id: row.id, address: row.address, city: row.city, state: row.state, tenant_brand_name: row.tenant_brand_name } : x))
    notify('Property updated')
    return row
  }, [notify])

  const removeProperty = useCallback(async (id) => {
    await deleteProperty(id)
    setAllProperties(prev => prev.filter(x => x.id !== id))
    setDeals(prev => prev.filter(d => d.property_id !== id))
    notify('Property deleted')
  }, [notify])

  // --- Deals ---
  const addDeal = useCallback(async (data) => {
    const row = await createDeal(data)
    setDeals(prev => [row, ...prev])
    notify('Deal created')
  }, [notify])

  const editDeal = useCallback(async (id, data) => {
    const row = await updateDeal(id, data)
    setDeals(prev => prev.map(x => x.id === id ? row : x))
    notify('Deal updated')
  }, [notify])

  const removeDeal = useCallback(async (id) => {
    await deleteDeal(id)
    setDeals(prev => prev.filter(x => x.id !== id))
    notify('Deal deleted')
  }, [notify])

  const closeDeal = useCallback(async (id) => {
    console.log('[AppContext] closeDeal called, id:', id)
    const result = await closeDealApi(id)
    console.log('[AppContext] closeDealApi response:', result)
    setDeals(prev => prev.filter(x => x.id !== id))
    // Refresh allProperties so the newly-created portfolio property shows up
    const props = await getAllProperties()
    setAllProperties(props)
    notify('Deal closed — moved to Portfolio')
  }, [notify])

  const dropDeal = useCallback(async (id) => {
    console.log('[AppContext] dropDeal called, id:', id)
    const result = await dropDealApi(id)
    console.log('[AppContext] dropDealApi response:', result)
    setDeals(prev => prev.filter(x => x.id !== id))
    notify('Deal dropped')
  }, [notify])

  const restoreDeal = useCallback(async (id) => {
    const row = await restoreDealApi(id)
    setDeals(prev => [row, ...prev])
    notify('Deal restored')
    return row
  }, [notify])

  const moveDeal = useCallback(async (id, newStage) => {
    setDeals(prev => prev.map(d => d.id === id ? { ...d, stage: newStage } : d))
    try {
      const row = await patchDealStage(id, newStage)
      setDeals(prev => prev.map(d => d.id === id ? row : d))
    } catch { /* optimistic update already applied */ }
  }, [])

  // Called after CSV import to reload everything
  const reloadAll = useCallback(async () => {
    setLoading(true)
    await loadDropdowns()
    setLoading(false)
    const s = await refreshStats()
    return s
  }, [loadDropdowns, refreshStats])

  return (
    <AppContext.Provider value={{
      tenantBrands, addTenantBrand, editTenantBrand, removeTenantBrand,
      allPeople, addPerson, editPerson, removePerson,
      allProperties, addProperty, editProperty, removeProperty,
      propertyStates,
      deals, addDeal, editDeal, removeDeal, moveDeal, closeDeal, dropDeal, restoreDeal,
      stages,
      toast, notify,
      loading,
      importStats, refreshStats, reloadAll,
    }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used within AppProvider')
  return ctx
}
