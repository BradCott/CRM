const CRM_URL_KEY = 'knoxCrmUrl'
const input    = document.getElementById('crmUrl')
const saveBtn  = document.getElementById('saveBtn')
const savedMsg = document.getElementById('savedMsg')

// Load saved URL
chrome.storage.sync.get([CRM_URL_KEY], (result) => {
  input.value = result[CRM_URL_KEY] || 'http://localhost:3001'
})

saveBtn.addEventListener('click', () => {
  const url = input.value.trim().replace(/\/$/, '')
  if (!url) return
  chrome.storage.sync.set({ [CRM_URL_KEY]: url }, () => {
    savedMsg.style.display = 'block'
    setTimeout(() => { savedMsg.style.display = 'none' }, 2000)
  })
})
