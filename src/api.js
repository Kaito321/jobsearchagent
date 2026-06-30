import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export const getPreferences  = () => api.get('/preferences').then(r => r.data)
export const savePreferences = (data) => api.post('/preferences', data)

export const getSessions     = () => api.get('/sessions').then(r => r.data)
export const createSession   = (data) => api.post('/sessions', data).then(r => r.data)
export const updateSession   = (id, data) => api.patch(`/sessions/${id}`, data)

export const getJobs         = (params) => api.get('/jobs', { params }).then(r => r.data)
export const getCarryover    = () => api.get('/jobs/carryover').then(r => r.data)
export const createJob       = (data) => api.post('/jobs', data).then(r => r.data)
export const updateJob       = (id, data) => api.patch(`/jobs/${id}`, data)

export const getDiscoveryLog = (params) => api.get('/discovery-log', { params }).then(r => r.data)
export const addDiscoveryLog = (data) => api.post('/discovery-log', data).then(r => r.data)

export const getCoverLetters = (params) => api.get('/cover-letters', { params }).then(r => r.data)
export const addCoverLetter  = (data) => api.post('/cover-letters', data).then(r => r.data)

export const getStats        = () => api.get('/stats').then(r => r.data)

// ── Stored files ──────────────────────────────────────────
export const saveFile = (type, file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = async () => {
    try {
      const base64 = reader.result.split(',')[1]
      await api.post(`/files/${type}`, { file_name: file.name, file_data: base64 })
      resolve({ file_name: file.name, file_data: base64 })
    } catch (e) { reject(e) }
  }
  reader.onerror = reject
  reader.readAsDataURL(file)
})
export const loadFile   = (type) => api.get(`/files/${type}`).then(r => r.data)
export const deleteFile = (type) => api.delete(`/files/${type}`)

// ── AI endpoints ──────────────────────────────────────────
export const checkAIStatus       = () => api.get('/ai/status').then(r => r.data)
export const matchResume         = (data) => api.post('/ai/match', data).then(r => r.data)
export const checkLegitimacy     = (data) => api.post('/ai/legitimacy', data).then(r => r.data)
export const checkLayoffs        = (data) => api.post('/ai/layoffs', data).then(r => r.data)
export const checkPostingAge     = (data) => api.post('/ai/posting-age', data).then(r => r.data)
export const generateCoverLetter = (data) => api.post('/ai/cover-letter', data).then(r => r.data)
export const extractPdfText      = (data) => api.post('/ai/extract-pdf-text', data).then(r => r.data)
export const matchQA             = (data) => api.post('/ai/match-qa', data).then(r => r.data)

// ── Q&A Bank ──────────────────────────────────────────────
export const getQACategories  = () => api.get('/qa/categories').then(r => r.data)
export const createQACategory = (data) => api.post('/qa/categories', data).then(r => r.data)
export const updateQACategory = (id, data) => api.patch(`/qa/categories/${id}`, data)
export const deleteQACategory = (id) => api.delete(`/qa/categories/${id}`)
export const createQAPair     = (data) => api.post('/qa/pairs', data).then(r => r.data)
export const updateQAPair     = (id, data) => api.patch(`/qa/pairs/${id}`, data)
export const deleteQAPair     = (id) => api.delete(`/qa/pairs/${id}`)
export const getQAMatchLog    = (params) => api.get('/qa/match-log', { params }).then(r => r.data)

// ── Chrome integration ────────────────────────────────────
// Send page content scraped by Chrome extension to extract job data
export const extractJobFromPage    = (data) => api.post('/chrome/extract-job', data).then(r => r.data)

// Send application page content to extract form fields
export const extractFormFields     = (data) => api.post('/chrome/extract-form', data).then(r => r.data)

// Generate fill instructions for a form using resume + Q&A bank
export const generateFillInstructions = (data) => api.post('/chrome/generate-fill-instructions', data).then(r => r.data)

// Log chrome session window
export const createChromeSession   = (data) => api.post('/chrome/sessions', data).then(r => r.data)
export const updateChromeSession   = (id, data) => api.patch(`/chrome/sessions/${id}`, data)

// Get items that need manual review before submission
export const getNeedsReview        = (params) => api.get('/chrome/needs-review', { params }).then(r => r.data)

// ── Ready to apply & submission tracking ──────────────────
export const getReadyJobs          = (params) => api.get('/jobs/ready', { params }).then(r => r.data)
export const markJobSubmitted      = (id) => api.patch(`/jobs/${id}/submit`).then(r => r.data)
export const getSessionSummary     = (sessionId) => api.get(`/session-summary/${sessionId}`).then(r => r.data)

// ── Claude-driven session ─────────────────────────────────
export const pingServer            = () => api.get('/session/ping').then(r => r.data)
export const startSessionWithClaude = (data) => api.post('/session/start-with-claude', data).then(r => r.data)
export const pollSessionJobs       = (sessionId) => api.get(`/session/jobs/${sessionId}`).then(r => r.data)

// ── Domain management ──────────────────────────────────────
export const checkDomain        = (url) => api.post('/domain/check', { url }).then(r => r.data)
export const getDomainList      = (status) => api.get('/domain/list', { params: status ? { status } : {} }).then(r => r.data)
export const blacklistDomain    = (domain, reason) => api.post('/domain/blacklist', { domain, reason }).then(r => r.data)
export const approveDomain      = (domain) => api.post(`/domain/approve/${domain}`).then(r => r.data)
export const rejectDomain       = (domain, reason) => api.post(`/domain/reject/${domain}`, { reason }).then(r => r.data)
export const removeDomain       = (domain) => api.delete(`/domain/${domain}`)
export const recordDomainJob    = (domain) => api.post(`/domain/record-job/${domain}`).then(r => r.data)

// ── Watchlist ──────────────────────────────────────────────
export const getWatchlist        = () => api.get('/watchlist').then(r => r.data)
export const addWatchlistEntry   = (data) => api.post('/watchlist', data).then(r => r.data)
export const updateWatchlistEntry = (id, data) => api.patch(`/watchlist/${id}`, data)
export const deleteWatchlistEntry = (id) => api.delete(`/watchlist/${id}`)
export const markWatchlistChecked = (id, jobsFound) => api.post(`/watchlist/${id}/checked`, { jobs_found: jobsFound }).then(r => r.data)
export const discoverCareerUrl    = (companyName) => api.post('/watchlist/discover', { company_name: companyName }).then(r => r.data)
