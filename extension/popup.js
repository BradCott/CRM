const CRM_URL_KEY = 'knoxCrmUrl'
const CRM_KEY_KEY = 'knoxCrmKey'
const urlInput = document.getElementById('crmUrl')
const keyInput = document.getElementById('crmKey')
const saveBtn  = document.getElementById('saveBtn')
const savedMsg = document.getElementById('savedMsg')

// Baked-in defaults from config.js (set when downloaded from the CRM)
const cfgUrl = (typeof KNOX_CFG !== 'undefined' && KNOX_CFG.url) || 'https://crm.knoxcre.com'
const cfgKey = (typeof KNOX_CFG !== 'undefined' && KNOX_CFG.key) || ''

// Load saved values (fall back to the baked-in config)
chrome.storage.sync.get([CRM_URL_KEY, CRM_KEY_KEY], (result) => {
  urlInput.value = result[CRM_URL_KEY] || cfgUrl
  keyInput.value = result[CRM_KEY_KEY] || cfgKey
})

saveBtn.addEventListener('click', () => {
  const url = urlInput.value.trim().replace(/\/$/, '')
  const key = keyInput.value.trim()
  if (!url) return
  chrome.storage.sync.set({ [CRM_URL_KEY]: url, [CRM_KEY_KEY]: key }, () => {
    savedMsg.style.display = 'block'
    setTimeout(() => { savedMsg.style.display = 'none' }, 2000)
  })
})
