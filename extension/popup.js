const CRM_URL_KEY = 'knoxCrmUrl'
const CRM_KEY_KEY = 'knoxCrmKey'
const urlInput = document.getElementById('crmUrl')
const keyInput = document.getElementById('crmKey')
const saveBtn  = document.getElementById('saveBtn')
const savedMsg = document.getElementById('savedMsg')

// Load saved values
chrome.storage.sync.get([CRM_URL_KEY, CRM_KEY_KEY], (result) => {
  urlInput.value = result[CRM_URL_KEY] || 'https://crm.knoxcre.com'
  keyInput.value = result[CRM_KEY_KEY] || ''
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
