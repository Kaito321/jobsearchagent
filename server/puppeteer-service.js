// ── Puppeteer browser service ──────────────────────────────
// Manages a single visible Chrome window per session.
// All scraping and (later) form-filling happens through this module.

const puppeteer = require('puppeteer')

let browser = null
let activeSessionId = null
const openPages = new Map() // url -> page object, kept open for review

// Launch a new visible Chrome window for a session
async function launchSession(sessionId) {
  if (browser) {
    try { await browser.close() } catch (_) {}
  }
  browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized', '--no-default-browser-check']
  })
  activeSessionId = sessionId
  openPages.clear()
  return { ok: true, sessionId }
}

// Check if a session's browser is still open
function isSessionActive(sessionId) {
  return browser !== null && activeSessionId === sessionId
}

// Detect common CAPTCHA / bot-block signals on a page
async function detectBlocked(page) {
  try {
    const signals = await page.evaluate(() => {
      const text = document.body?.innerText?.toLowerCase() || ''
      const title = document.title?.toLowerCase() || ''
      const hasCaptcha =
        document.querySelector('iframe[src*="recaptcha"]') ||
        document.querySelector('iframe[src*="hcaptcha"]') ||
        document.querySelector('[class*="captcha" i]') ||
        document.querySelector('#challenge-form') || // Cloudflare
        text.includes('verify you are human') ||
        text.includes('unusual traffic') ||
        text.includes('access denied') ||
        text.includes('are you a robot') ||
        title.includes('just a moment') || // Cloudflare interstitial
        title.includes('attention required')
      return { hasCaptcha, title }
    })
    return signals.hasCaptcha
  } catch (_) {
    return false
  }
}

// Open a URL in a new tab within the session window, return scraped text
// Returns { blocked: true } if a CAPTCHA/block is detected — caller should
// leave the tab open and skip to the next job.
async function scrapeUrl(url, { timeout = 25000 } = {}) {
  if (!browser) throw new Error('No active browser session — call launchSession first')

  const page = await browser.newPage()
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  )

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout })
  } catch (e) {
    // Page may still have partially loaded — continue to check content
  }

  // Give JS-heavy sites a moment to render
  await new Promise(r => setTimeout(r, 1500))

  const blocked = await detectBlocked(page)

  if (blocked) {
    // Leave the tab open for manual review — do NOT close it
    openPages.set(url, page)
    return { blocked: true, url }
  }

  const text = await page.evaluate(() => document.body?.innerText || '')
  const title = await page.title()

  // Close the tab since scraping succeeded — we don't need to keep it open
  await page.close()

  return { blocked: false, text, title, url }
}

// Get list of currently open "blocked" tabs waiting for manual intervention
function getBlockedTabs() {
  return Array.from(openPages.keys())
}

// Check if the user has resolved a blocked tab (e.g. solved CAPTCHA manually)
// Re-checks the page for block signals; if clear, scrapes and closes it.
async function recheckBlockedTab(url) {
  const page = openPages.get(url)
  if (!page) return { error: 'Tab not found — it may have been closed' }

  const stillBlocked = await detectBlocked(page)
  if (stillBlocked) {
    return { blocked: true, url }
  }

  const text = await page.evaluate(() => document.body?.innerText || '')
  const title = await page.title()
  await page.close()
  openPages.delete(url)

  return { blocked: false, text, title, url }
}

// Open the application page for a qualifying job, leave it open for review
async function openApplicationTab(url) {
  if (!browser) throw new Error('No active browser session')
  const page = await browser.newPage()
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 })
  } catch (_) {}
  // Intentionally do NOT close — this tab stays open for the user to review/submit
  return { ok: true, url }
}

// Close the entire session window
async function closeSession() {
  if (browser) {
    try { await browser.close() } catch (_) {}
  }
  browser = null
  activeSessionId = null
  openPages.clear()
  return { ok: true }
}

module.exports = {
  launchSession,
  isSessionActive,
  scrapeUrl,
  getBlockedTabs,
  recheckBlockedTab,
  openApplicationTab,
  closeSession,
}
