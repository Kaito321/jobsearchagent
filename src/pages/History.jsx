import { useState, useEffect } from 'react'
import { Card, Badge, StatCard, SectionLabel } from '../components/UI'
import * as api from '../api'

export default function History() {
  const [sessions, setSessions] = useState([])
  const [jobs, setJobs] = useState([])
  const [cls, setCls] = useState([])
  const [stats, setStats] = useState({})
  const [tab, setTab] = useState('sessions')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.getSessions(),
      api.getJobs({}),
      api.getCoverLetters({}),
      api.getStats()
    ]).then(([s, j, c, st]) => {
      setSessions(s); setJobs(j); setCls(c); setStats(st)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <div style={{ color:'var(--text2)', padding:40 }}>Loading history…</div>

  const STATUS_COLOR = { ready:'success', skip:'danger', filled:'success', carryover:'warning', pending:'neutral', filling:'info' }

  return (
    <div>
      <h1 style={{ fontSize:20, fontWeight:600, marginBottom:6 }}>History</h1>
      <p style={{ color:'var(--text2)', fontSize:13, marginBottom:24 }}>All your past sessions and applications, stored permanently in your local database.</p>

      {/* Lifetime stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5, 1fr)', gap:10, marginBottom:24 }}>
        <StatCard label="Total sessions" value={stats.totalSessions ?? 0} />
        <StatCard label="Total jobs found" value={stats.totalJobs ?? 0} color="var(--blue)" />
        <StatCard label="Applications filled" value={stats.totalFilled ?? 0} color="var(--green)" />
        <StatCard label="Skipped" value={stats.totalSkipped ?? 0} color="var(--red)" />
        <StatCard label="Cover letters" value={stats.totalCLs ?? 0} color="var(--purple)" />
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)', gap:0, marginBottom:20 }}>
        {[
          { id:'sessions', label:`Sessions (${sessions.length})` },
          { id:'jobs', label:`All jobs (${jobs.length})` },
          { id:'cls', label:`Cover letters (${cls.length})` },
        ].map(t => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding:'10px 16px', fontSize:13, cursor:'pointer',
              color: tab===t.id ? 'var(--purple)' : 'var(--text2)',
              borderBottom: tab===t.id ? '2px solid var(--purple)' : '2px solid transparent',
              borderTop:'none', borderLeft:'none', borderRight:'none',
              background:'none', fontFamily:'var(--font)',
              fontWeight: tab===t.id ? 500 : 400, transition:'all .15s'
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Sessions */}
      {tab === 'sessions' && (
        sessions.length === 0 ? (
          <EmptyState icon="ti-history" title="No sessions yet" sub="Start your first session from the Dashboard" />
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {sessions.map(s => (
              <Card key={s.id}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontWeight:500 }}>{s.date}</div>
                    <div style={{ fontSize:12, color:'var(--text2)', marginTop:3 }}>
                      {s.created_at} · <Badge type={s.mode==='auto'?'purple':'neutral'}>{s.mode}</Badge>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:20, textAlign:'center' }}>
                    {[
                      { l:'Found', v:s.jobs_found, c:'var(--blue)' },
                      { l:'Matched', v:s.jobs_matched, c:'var(--green)' },
                      { l:'Filled', v:s.jobs_filled, c:'var(--purple)' },
                      { l:'Cap', v:s.cap },
                    ].map(m => (
                      <div key={m.l}>
                        <div style={{ fontSize:18, fontWeight:600, color:m.c||'var(--text)' }}>{m.v ?? 0}</div>
                        <div style={{ fontSize:11, color:'var(--text3)' }}>{m.l}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      {/* All jobs */}
      {tab === 'jobs' && (
        jobs.length === 0 ? (
          <EmptyState icon="ti-briefcase" title="No jobs in history" sub="Jobs appear here after you run your first session" />
        ) : (
          <Card style={{ padding:0, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr>
                  {['Title','Company','Board','Score','Match','Legit','Age','Layoffs','Status','Date'].map(h => (
                    <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, color:'var(--text3)', fontWeight:500, borderBottom:'1px solid var(--border)', background:'var(--bg3)', textTransform:'uppercase', letterSpacing:'.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => {
                  const fc = v => v===null||v===undefined ? <Badge type="neutral">—</Badge> : <Badge type={v?'success':'danger'}>{v?'pass':'fail'}</Badge>
                  return (
                    <tr key={j.id} style={{ borderBottom:'1px solid var(--border)' }}>
                      <td style={{ padding:'9px 14px', fontWeight:500, color:'var(--text)' }}>{j.title}</td>
                      <td style={{ padding:'9px 14px', color:'var(--text2)' }}>{j.company}</td>
                      <td style={{ padding:'9px 14px' }}><Badge type="neutral">{j.board}</Badge></td>
                      <td style={{ padding:'9px 14px', fontWeight:600, color:j.score>=80?'var(--green)':j.score>=70?'var(--amber)':'var(--red)' }}>{j.score}%</td>
                      <td style={{ padding:'9px 14px' }}>{fc(j.filter_match)}</td>
                      <td style={{ padding:'9px 14px' }}>{fc(j.filter_legit)}</td>
                      <td style={{ padding:'9px 14px' }}>{fc(j.filter_age)}</td>
                      <td style={{ padding:'9px 14px' }}>{fc(j.filter_layoffs)}</td>
                      <td style={{ padding:'9px 14px' }}><Badge type={STATUS_COLOR[j.status]||'neutral'}>{j.status}</Badge></td>
                      <td style={{ padding:'9px 14px', fontSize:11, color:'var(--text3)', fontFamily:'var(--mono)' }}>{j.created_at?.slice(0,10)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        )
      )}

      {/* Cover letters */}
      {tab === 'cls' && (
        cls.length === 0 ? (
          <EmptyState icon="ti-file-text" title="No cover letters yet" sub="Generated cover letters appear here" />
        ) : (
          <Card style={{ padding:0, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr>
                  {['File','Company','Board','Application URL','File path','Created'].map(h => (
                    <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, color:'var(--text3)', fontWeight:500, borderBottom:'1px solid var(--border)', background:'var(--bg3)', textTransform:'uppercase', letterSpacing:'.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cls.map(c => (
                  <tr key={c.id} style={{ borderBottom:'1px solid var(--border)' }}>
                    <td style={{ padding:'9px 14px' }}><Badge type="purple"><i className="ti ti-file-text" style={{ fontSize:11 }} /> {c.file_name}</Badge></td>
                    <td style={{ padding:'9px 14px', fontWeight:500 }}>{c.company}</td>
                    <td style={{ padding:'9px 14px' }}><Badge type="neutral">{c.board}</Badge></td>
                    <td style={{ padding:'9px 14px' }}><a href={c.application_url} target="_blank" rel="noreferrer" style={{ fontSize:11, color:'var(--blue)', textDecoration:'none' }}>{c.application_url}</a></td>
                    <td style={{ padding:'9px 14px', fontSize:11, color:'var(--text3)', fontFamily:'var(--mono)' }}>{c.file_path}</td>
                    <td style={{ padding:'9px 14px', fontSize:11, color:'var(--text3)', fontFamily:'var(--mono)' }}>{c.created_at?.slice(0,10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
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
