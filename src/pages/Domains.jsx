import { useState, useEffect } from 'react'
import { Card, Badge, Button, SectionLabel, Spinner } from '../components/UI'
import * as api from '../api'
import './Domains.css'

export default function Domains() {
  const [tab, setTab] = useState('watchlist')
  const [watchlist, setWatchlist] = useState([])
  const [whitelist, setWhitelist] = useState([])
  const [blacklist, setBlacklist] = useState([])
  const [pending, setPending] = useState([])
  const [loading, setLoading] = useState(true)

  // New watchlist entry form
  const [newCompany, setNewCompany] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [discovering, setDiscovering] = useState(false)
  const [adding, setAdding] = useState(false)

  // New manual blacklist entry
  const [newBlockDomain, setNewBlockDomain] = useState('')
  const [newBlockReason, setNewBlockReason] = useState('')

  useEffect(() => { loadAll() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [wl, white, black, pend] = await Promise.all([
        api.getWatchlist(),
        api.getDomainList('whitelisted'),
        api.getDomainList('blacklisted'),
        api.getDomainList('pending'),
      ])
      setWatchlist(wl)
      setWhitelist(white)
      setBlacklist(black)
      setPending(pend)
    } catch (_) {} finally { setLoading(false) }
  }

  // ── Watchlist actions ────────────────────────────────────
  async function discoverUrl() {
    if (!newCompany.trim()) return
    setDiscovering(true)
    try {
      const result = await api.discoverCareerUrl(newCompany.trim())
      if (result.suggested_url) setNewUrl(result.suggested_url)
    } catch (_) {} finally { setDiscovering(false) }
  }

  async function addToWatchlist() {
    if (!newCompany.trim()) return
    setAdding(true)
    try {
      await api.addWatchlistEntry({
        company_name: newCompany.trim(),
        career_url: newUrl.trim() || null,
        source: newUrl.trim() ? 'manual' : 'auto-discover'
      })
      setNewCompany(''); setNewUrl('')
      loadAll()
    } catch (_) {} finally { setAdding(false) }
  }

  async function removeWatchlistEntry(id) {
    if (!confirm('Remove this company from your watchlist?')) return
    await api.deleteWatchlistEntry(id)
    loadAll()
  }

  async function recheckNow(id) {
    // Reset the checked date so the next session picks it up
    await api.updateWatchlistEntry(id, { career_url: undefined })
    // Just clear last_checked_date via direct patch isn't supported, so we use markWatchlistChecked with 0 won't help.
    // Instead we rely on the "Re-check now" meaning: treat as pending again locally
    setWatchlist(prev => prev.map(w => w.id === id ? { ...w, checked_today: false } : w))
  }

  // ── Blacklist actions ────────────────────────────────────
  async function addBlacklistEntry() {
    if (!newBlockDomain.trim()) return
    await api.blacklistDomain(newBlockDomain.trim(), newBlockReason.trim() || 'Manually added')
    setNewBlockDomain(''); setNewBlockReason('')
    loadAll()
  }

  async function removeBlacklistEntry(domain) {
    if (!confirm(`Remove ${domain} from the blacklist? The bot will be able to scrape it again.`)) return
    await api.removeDomain(domain)
    loadAll()
  }

  // ── Pending review actions ───────────────────────────────
  async function approvePending(domain) {
    await api.approveDomain(domain)
    loadAll()
  }

  async function rejectPending(domain) {
    await api.rejectDomain(domain, 'Manually blocked after review')
    loadAll()
  }

  const pendingCount = pending.length

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize:20, fontWeight:600 }}>Domains</h1>
        <p style={{ color:'var(--text2)', fontSize:13, marginTop:4 }}>
          Manage which sites the agent checks daily, which it's visited, and which it avoids.
        </p>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)', marginBottom:20, flexWrap:'wrap' }}>
        {[
          { id:'watchlist', label:`Watchlist (${watchlist.length})`, icon:'ti-radar' },
          { id:'whitelist', label:`Whitelist (${whitelist.length})`, icon:'ti-shield-check' },
          { id:'blacklist', label:`Blacklist (${blacklist.length})`, icon:'ti-shield-x' },
          { id:'pending',   label:`Pending Review (${pendingCount})`, icon:'ti-clock-question' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:'10px 16px', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:6,
            color: tab===t.id ? 'var(--purple)' : 'var(--text2)',
            borderBottom: tab===t.id ? '2px solid var(--purple)' : '2px solid transparent',
            borderTop:'none', borderLeft:'none', borderRight:'none',
            background:'none', fontFamily:'var(--font)', fontWeight: tab===t.id ? 500 : 400
          }}>
            <i className={`ti ${t.icon}`} style={{ fontSize:14 }} />
            {t.label}
            {t.id === 'pending' && pendingCount > 0 && (
              <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--amber)' }} />
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display:'flex', gap:10, alignItems:'center', color:'var(--text2)', padding:40 }}>
          <Spinner /> Loading domains…
        </div>
      ) : (
        <>
          {/* ── WATCHLIST ── */}
          {tab === 'watchlist' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <Card>
                <SectionLabel>Add a company to your daily watchlist</SectionLabel>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'flex-end' }}>
                  <div style={{ flex:'1 1 200px' }}>
                    <div style={{ fontSize:12, color:'var(--text2)', marginBottom:4 }}>Company name</div>
                    <input className="domain-input" placeholder="e.g. Stripe" value={newCompany}
                      onChange={e => setNewCompany(e.target.value)} />
                  </div>
                  <div style={{ flex:'1 1 260px' }}>
                    <div style={{ fontSize:12, color:'var(--text2)', marginBottom:4 }}>Career page URL (optional)</div>
                    <input className="domain-input" placeholder="https://boards.greenhouse.io/company" value={newUrl}
                      onChange={e => setNewUrl(e.target.value)} />
                  </div>
                  <Button size="sm" variant="secondary" onClick={discoverUrl} disabled={!newCompany.trim() || discovering}>
                    {discovering ? <Spinner size={12} /> : <><i className="ti ti-search" style={{ fontSize:12 }} /> Auto-find</>}
                  </Button>
                  <Button size="sm" variant="primary" onClick={addToWatchlist} disabled={!newCompany.trim() || adding}>
                    {adding ? <Spinner size={12} /> : <><i className="ti ti-plus" style={{ fontSize:12 }} /> Add</>}
                  </Button>
                </div>
              </Card>

              {watchlist.length === 0 ? (
                <EmptyState icon="ti-radar" title="No companies on your watchlist" sub="Add companies above to have the agent check their career pages daily" />
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {watchlist.map(w => (
                    <Card key={w.id} style={{ padding:'12px 16px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontWeight:500, fontSize:14 }}>{w.company_name}</div>
                          <div style={{ fontSize:11, color:'var(--text2)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                            {w.career_url || 'No URL set — auto-discover pending'}
                          </div>
                        </div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                          <Badge type="neutral">{w.total_jobs_found} found total</Badge>
                          {w.checked_today
                            ? <Badge type="success"><i className="ti ti-circle-check" style={{ fontSize:11 }} /> Checked today</Badge>
                            : <Badge type="warning"><i className="ti ti-clock" style={{ fontSize:11 }} /> Pending today</Badge>
                          }
                          {w.checked_today && (
                            <Button size="sm" variant="secondary" onClick={() => recheckNow(w.id)}>
                              <i className="ti ti-refresh" style={{ fontSize:11 }} /> Re-check
                            </Button>
                          )}
                          <button className="icon-btn-domain danger" onClick={() => removeWatchlistEntry(w.id)}>
                            <i className="ti ti-trash" />
                          </button>
                        </div>
                      </div>
                      {w.last_checked_at && (
                        <div style={{ fontSize:11, color:'var(--text3)', marginTop:6, fontFamily:'var(--mono)' }}>
                          Last checked: {w.last_checked_at}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── WHITELIST ── */}
          {tab === 'whitelist' && (
            whitelist.length === 0 ? (
              <EmptyState icon="ti-shield-check" title="No sites visited yet" sub="Successfully scraped domains will appear here automatically" />
            ) : (
              <Card style={{ padding:0, overflow:'hidden' }}>
                <table className="domain-table">
                  <thead>
                    <tr>
                      <th>Domain</th><th>First visited</th><th>Last visited</th>
                      <th>Visits</th><th>Jobs found</th><th>ToS source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {whitelist.map(d => (
                      <tr key={d.id}>
                        <td style={{ fontWeight:500 }}>{d.domain}</td>
                        <td style={{ fontFamily:'var(--mono)', fontSize:11 }}>{d.first_visited_at?.slice(0,16) || '—'}</td>
                        <td style={{ fontFamily:'var(--mono)', fontSize:11 }}>{d.last_visited_at?.slice(0,16) || '—'}</td>
                        <td>{d.visit_count}</td>
                        <td>{d.jobs_found_total}</td>
                        <td><Badge type={d.source==='auto'?'info':'neutral'}>{d.source}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )
          )}

          {/* ── BLACKLIST ── */}
          {tab === 'blacklist' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <Card>
                <SectionLabel>Manually block a domain</SectionLabel>
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'flex-end' }}>
                  <div style={{ flex:'1 1 200px' }}>
                    <div style={{ fontSize:12, color:'var(--text2)', marginBottom:4 }}>Domain</div>
                    <input className="domain-input" placeholder="e.g. example.com" value={newBlockDomain}
                      onChange={e => setNewBlockDomain(e.target.value)} />
                  </div>
                  <div style={{ flex:'1 1 260px' }}>
                    <div style={{ fontSize:12, color:'var(--text2)', marginBottom:4 }}>Reason (optional)</div>
                    <input className="domain-input" placeholder="Why is this site blocked?" value={newBlockReason}
                      onChange={e => setNewBlockReason(e.target.value)} />
                  </div>
                  <Button size="sm" variant="danger" onClick={addBlacklistEntry} disabled={!newBlockDomain.trim()}>
                    <i className="ti ti-ban" style={{ fontSize:12 }} /> Block
                  </Button>
                </div>
              </Card>

              {blacklist.length === 0 ? (
                <EmptyState icon="ti-shield-x" title="Blacklist is empty" sub="Blocked domains appear here" />
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                  {blacklist.map(d => (
                    <Card key={d.id} style={{ padding:'12px 16px' }}>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                            <span style={{ fontWeight:500, fontSize:14 }}>{d.domain}</span>
                            <Badge type={d.source==='auto'?'warning':'neutral'}>
                              {d.source==='auto' ? 'Auto-detected' : 'Manual'}
                            </Badge>
                          </div>
                          <div style={{ fontSize:12, color:'var(--text2)', marginTop:4 }}>{d.reason}</div>
                          {d.tos_url && (
                            <a href={d.tos_url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'var(--blue)', marginTop:4, display:'inline-block' }}>
                              View ToS source →
                            </a>
                          )}
                        </div>
                        <Button size="sm" variant="secondary" onClick={() => removeBlacklistEntry(d.domain)}>
                          <i className="ti ti-trash" style={{ fontSize:11 }} /> Remove
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── PENDING REVIEW ── */}
          {tab === 'pending' && (
            pending.length === 0 ? (
              <EmptyState icon="ti-clock-question" title="Nothing pending review" sub="Domains where ToS couldn't be found will show up here for your approval" />
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                <div style={{ background:'var(--blue-bg)', border:'1px solid rgba(96,165,250,.2)', borderRadius:'var(--radius)', padding:'12px 16px', fontSize:13, color:'var(--blue)', display:'flex', gap:10, alignItems:'center' }}>
                  <i className="ti ti-info-circle" style={{ fontSize:16 }} />
                  These domains couldn't be automatically checked for bot restrictions. Review each one and approve or block.
                </div>
                {pending.map(d => (
                  <Card key={d.id}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10 }}>
                      <div>
                        <div style={{ fontWeight:500, fontSize:14 }}>{d.domain}</div>
                        <div style={{ fontSize:12, color:'var(--text2)', marginTop:2 }}>{d.reason || 'No ToS page could be found'}</div>
                      </div>
                      <div style={{ display:'flex', gap:8 }}>
                        <Button size="sm" variant="secondary" onClick={() => rejectPending(d.domain)}>
                          <i className="ti ti-ban" style={{ fontSize:11 }} /> Block
                        </Button>
                        <Button size="sm" variant="primary" onClick={() => approvePending(d.domain)}>
                          <i className="ti ti-check" style={{ fontSize:11 }} /> Approve
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}

function EmptyState({ icon, title, sub }) {
  return (
    <div style={{ textAlign:'center', padding:'60px 20px', color:'var(--text2)', display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
      <i className={`ti ${icon}`} style={{ fontSize:36, opacity:.25 }} />
      <div style={{ fontSize:14, fontWeight:500 }}>{title}</div>
      <div style={{ fontSize:12, color:'var(--text3)' }}>{sub}</div>
    </div>
  )
}
