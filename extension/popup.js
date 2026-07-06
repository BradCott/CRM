const CRM_URL_KEY = 'knoxCrmUrl'
const CRM_KEY_KEY = 'knoxCrmKey'
const urlInput = document.getElementById('crmUrl')
const keyInput = document.getElementById('crmKey')
const saveBtn  = document.getElementById('saveBtn')
const savedMsg = document.getElementById('savedMsg')

// Baked-in defaults from config.js (set when downloaded from the CRM)
const cfgUrl = (typeof KNOX_CFG !== 'undefined' && KNOX_CFG.url) || 'https://crm.knoxcre.com'
const cfgKey = (typeof KNOX_CFG !== 'undefined' && KNOX_CFG.key) || ''

// Precedence: managed policy → saved popup values → baked-in config.
chrome.storage.managed.get(['crmUrl', 'crmKey'], (m) => {
  const managed = m && (m.crmUrl || m.crmKey)
  chrome.storage.sync.get([CRM_URL_KEY, CRM_KEY_KEY], (result) => {
    urlInput.value = (m && m.crmUrl) || result[CRM_URL_KEY] || cfgUrl
    keyInput.value = (m && m.crmKey) || result[CRM_KEY_KEY] || cfgKey
    if (managed) {
      // Values come from your Workspace admin — lock the fields.
      urlInput.disabled = true; keyInput.disabled = true
      saveBtn.disabled = true; saveBtn.textContent = 'Managed by your organization'
    }
  })
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
