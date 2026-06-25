import { useState, useEffect } from 'react'
import { Card, Badge, Button, SectionLabel, Spinner } from '../components/UI'
import * as api from '../api'
import './QABank.css'

export default function QABank() {
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true)
  const [newCatName, setNewCatName] = useState('')
  const [addingCat, setAddingCat] = useState(false)
  const [editingCat, setEditingCat] = useState(null)
  const [editingPair, setEditingPair] = useState(null)
  const [newPair, setNewPair] = useState({})
  const [saving, setSaving] = useState(false)
  const [matchLog, setMatchLog] = useState([])
  const [tab, setTab] = useState('bank')

  useEffect(() => {
    load()
    api.getQAMatchLog({}).then(setMatchLog).catch(() => {})
  }, [])

  async function load() {
    setLoading(true)
    try { setCategories(await api.getQACategories()) }
    catch (_) {} finally { setLoading(false) }
  }

  async function addCategory() {
    if (!newCatName.trim()) return
    setSaving(true)
    try {
      const cat = await api.createQACategory({ name: newCatName.trim() })
      setCategories(prev => [...prev, cat])
      setNewCatName('')
      setAddingCat(false)
    } catch (_) {} finally { setSaving(false) }
  }

  async function saveCategory(id, name) {
    await api.updateQACategory(id, { name })
    setCategories(prev => prev.map(c => c.id === id ? { ...c, name } : c))
    setEditingCat(null)
  }

  async function deleteCategory(id) {
    if (!confirm('Delete this category and all its Q&A pairs?')) return
    await api.deleteQACategory(id)
    setCategories(prev => prev.filter(c => c.id !== id))
  }

  async function addPair(categoryId) {
    const p = newPair[categoryId]
    if (!p?.question?.trim() || !p?.answer?.trim()) return
    setSaving(true)
    try {
      const pair = await api.createQAPair({ category_id: categoryId, question: p.question.trim(), answer: p.answer.trim() })
      setCategories(prev => prev.map(c => c.id === categoryId ? { ...c, pairs: [...(c.pairs||[]), pair] } : c))
      setNewPair(prev => ({ ...prev, [categoryId]: { question: '', answer: '' } }))
    } catch (_) {} finally { setSaving(false) }
  }

  async function savePair(pairId, catId, question, answer) {
    await api.updateQAPair(pairId, { question, answer })
    setCategories(prev => prev.map(c => c.id === catId
      ? { ...c, pairs: c.pairs.map(p => p.id === pairId ? { ...p, question, answer } : p) }
      : c))
    setEditingPair(null)
  }

  async function deletePair(pairId, catId) {
    await api.deleteQAPair(pairId)
    setCategories(prev => prev.map(c => c.id === catId
      ? { ...c, pairs: c.pairs.filter(p => p.id !== pairId) }
      : c))
  }

  const totalPairs = categories.reduce((n, c) => n + (c.pairs?.length || 0), 0)
  const aiDetections = matchLog.filter(m => m.is_ai_detection)
  const regularMatches = matchLog.filter(m => !m.is_ai_detection)

  return (
    <div>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:20, fontWeight:600 }}>Q&A Bank</h1>
          <p style={{ color:'var(--text2)', fontSize:13, marginTop:4 }}>
            Store answers to common application questions. The agent matches these automatically using AI.
          </p>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center' }}>
          <Badge type="purple"><i className="ti ti-messages" style={{ fontSize:11 }} /> {totalPairs} answers</Badge>
          {aiDetections.length > 0 && (
            <Badge type="warning"><i className="ti ti-alert-triangle" style={{ fontSize:11 }} /> {aiDetections.length} AI detection{aiDetections.length!==1?'s':''} logged</Badge>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', borderBottom:'1px solid var(--border)', marginBottom:20 }}>
        {[
          { id:'bank', label:`Q&A Bank (${totalPairs})` },
          { id:'log', label:`Match Log (${regularMatches.length})` },
          { id:'ai', label:`AI Detections (${aiDetections.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding:'10px 16px', fontSize:13, cursor:'pointer',
            color: tab===t.id ? 'var(--purple)' : 'var(--text2)',
            borderBottom: tab===t.id ? '2px solid var(--purple)' : '2px solid transparent',
            borderTop:'none', borderLeft:'none', borderRight:'none',
            background:'none', fontFamily:'var(--font)',
            fontWeight: tab===t.id ? 500 : 400
          }}>{t.label}</button>
        ))}
      </div>

      {/* Q&A Bank tab */}
      {tab === 'bank' && (
        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
          {loading ? (
            <div style={{ display:'flex', gap:10, alignItems:'center', color:'var(--text2)', padding:40 }}>
              <Spinner /> Loading Q&A bank…
            </div>
          ) : (
            <>
              {categories.map(cat => (
                <Card key={cat.id}>
                  {/* Category header */}
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                    {editingCat === cat.id ? (
                      <EditField
                        value={cat.name}
                        onSave={name => saveCategory(cat.id, name)}
                        onCancel={() => setEditingCat(null)}
                      />
                    ) : (
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <span style={{ fontWeight:600, fontSize:14 }}>{cat.name}</span>
                        <Badge type="neutral">{cat.pairs?.length || 0} answers</Badge>
                      </div>
                    )}
                    <div style={{ display:'flex', gap:6 }}>
                      <Button size="sm" variant="secondary" onClick={() => setEditingCat(cat.id)}>
                        <i className="ti ti-pencil" style={{ fontSize:12 }} /> Rename
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => deleteCategory(cat.id)}>
                        <i className="ti ti-trash" style={{ fontSize:12 }} />
                      </Button>
                    </div>
                  </div>

                  {/* Pairs */}
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {(cat.pairs || []).map(pair => (
                      <div key={pair.id} className="qa-pair">
                        {editingPair === pair.id ? (
                          <EditPair
                            question={pair.question}
                            answer={pair.answer}
                            onSave={(q, a) => savePair(pair.id, cat.id, q, a)}
                            onCancel={() => setEditingPair(null)}
                          />
                        ) : (
                          <>
                            <div style={{ flex:1 }}>
                              <div className="qa-question">
                                <i className="ti ti-question-mark" style={{ fontSize:11, color:'var(--purple)', flexShrink:0 }} />
                                {pair.question}
                              </div>
                              <div className="qa-answer">
                                <i className="ti ti-check" style={{ fontSize:11, color:'var(--green)', flexShrink:0 }} />
                                {pair.answer}
                              </div>
                            </div>
                            <div style={{ display:'flex', gap:4, flexShrink:0 }}>
                              <button className="icon-btn" onClick={() => setEditingPair(pair.id)}>
                                <i className="ti ti-pencil" />
                              </button>
                              <button className="icon-btn danger" onClick={() => deletePair(pair.id, cat.id)}>
                                <i className="ti ti-trash" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    ))}

                    {/* Add new pair */}
                    <div className="qa-add-pair">
                      <div style={{ flex:1, display:'flex', flexDirection:'column', gap:6 }}>
                        <input
                          className="qa-input"
                          placeholder="Add a question…"
                          value={newPair[cat.id]?.question || ''}
                          onChange={e => setNewPair(prev => ({ ...prev, [cat.id]: { ...prev[cat.id], question: e.target.value } }))}
                          onKeyDown={e => e.key === 'Enter' && document.getElementById(`ans-${cat.id}`)?.focus()}
                        />
                        <textarea
                          id={`ans-${cat.id}`}
                          className="qa-input"
                          placeholder="Your answer…"
                          rows={2}
                          value={newPair[cat.id]?.answer || ''}
                          onChange={e => setNewPair(prev => ({ ...prev, [cat.id]: { ...prev[cat.id], answer: e.target.value } }))}
                        />
                      </div>
                      <Button size="sm" variant="primary" onClick={() => addPair(cat.id)} disabled={saving}>
                        <i className="ti ti-plus" style={{ fontSize:12 }} /> Add
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}

              {/* Add category */}
              {addingCat ? (
                <Card>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <input
                      className="qa-input"
                      placeholder="Category name…"
                      value={newCatName}
                      onChange={e => setNewCatName(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addCategory()}
                      autoFocus
                      style={{ flex:1 }}
                    />
                    <Button size="sm" variant="primary" onClick={addCategory} disabled={saving}>
                      {saving ? <Spinner size={12} /> : 'Create'}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => { setAddingCat(false); setNewCatName('') }}>Cancel</Button>
                  </div>
                </Card>
              ) : (
                <button className="add-cat-btn" onClick={() => setAddingCat(true)}>
                  <i className="ti ti-plus" /> Add category
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Match log tab */}
      {tab === 'log' && (
        regularMatches.length === 0 ? (
          <EmptyState icon="ti-list-search" title="No match log yet" sub="Matches are logged when the agent processes applications" />
        ) : (
          <Card style={{ padding:0, overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr>
                  {['Application question','Matched to','Answer used','Category','Confidence','Date'].map(h => (
                    <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, color:'var(--text3)', fontWeight:500, borderBottom:'1px solid var(--border)', background:'var(--bg3)', textTransform:'uppercase', letterSpacing:'.04em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {regularMatches.map(m => (
                  <tr key={m.id} style={{ borderBottom:'1px solid var(--border)' }}>
                    <td style={{ padding:'10px 14px', color:'var(--text)', maxWidth:200 }}>{m.application_question}</td>
                    <td style={{ padding:'10px 14px', color:'var(--text2)', maxWidth:200 }}>{m.matched_question || <span style={{ color:'var(--text3)' }}>No match</span>}</td>
                    <td style={{ padding:'10px 14px', color:'var(--text2)', maxWidth:200 }}>{m.matched_answer || <span style={{ color:'var(--text3)' }}>Skipped</span>}</td>
                    <td style={{ padding:'10px 14px' }}>{m.category_name ? <Badge type="purple">{m.category_name}</Badge> : '—'}</td>
                    <td style={{ padding:'10px 14px' }}>
                      {m.confidence != null ? (
                        <span style={{ fontWeight:600, color: m.confidence>=70?'var(--green)':m.confidence>=40?'var(--amber)':'var(--red)' }}>
                          {m.confidence}%
                        </span>
                      ) : '—'}
                    </td>
                    <td style={{ padding:'10px 14px', fontSize:11, color:'var(--text3)', fontFamily:'var(--mono)' }}>{m.created_at?.slice(0,16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )
      )}

      {/* AI detections tab */}
      {tab === 'ai' && (
        aiDetections.length === 0 ? (
          <EmptyState icon="ti-robot" title="No AI detection questions logged" sub="Questions like 'Are you an AI?' are logged here when encountered" />
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            <div style={{ background:'var(--amber-bg)', border:'1px solid rgba(251,191,36,.2)', borderRadius:'var(--radius)', padding:'12px 16px', fontSize:13, color:'var(--amber)', display:'flex', gap:10, alignItems:'center' }}>
              <i className="ti ti-alert-triangle" style={{ fontSize:16 }} />
              These questions were detected and skipped automatically. Review them before manually submitting each application.
            </div>
            <Card style={{ padding:0, overflow:'hidden' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr>
                    {['Detected question','Action taken','Application','Date'].map(h => (
                      <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontSize:11, color:'var(--text3)', fontWeight:500, borderBottom:'1px solid var(--border)', background:'var(--bg3)', textTransform:'uppercase', letterSpacing:'.04em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {aiDetections.map(m => (
                    <tr key={m.id} style={{ borderBottom:'1px solid var(--border)' }}>
                      <td style={{ padding:'10px 14px', color:'var(--text)', fontWeight:500 }}>{m.application_question}</td>
                      <td style={{ padding:'10px 14px' }}><Badge type="warning"><i className="ti ti-player-skip-forward" style={{ fontSize:11 }} /> Skipped — review manually</Badge></td>
                      <td style={{ padding:'10px 14px', fontSize:11, color:'var(--text3)' }}>Job #{m.job_id || '—'}</td>
                      <td style={{ padding:'10px 14px', fontSize:11, color:'var(--text3)', fontFamily:'var(--mono)' }}>{m.created_at?.slice(0,16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )
      )}
    </div>
  )
}

function EditField({ value, onSave, onCancel }) {
  const [val, setVal] = useState(value)
  return (
    <div style={{ display:'flex', gap:6, flex:1, marginRight:10 }}>
      <input className="qa-input" value={val} onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if(e.key==='Enter') onSave(val); if(e.key==='Escape') onCancel() }}
        autoFocus style={{ flex:1 }} />
      <Button size="sm" variant="primary" onClick={() => onSave(val)}>Save</Button>
      <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
    </div>
  )
}

function EditPair({ question, answer, onSave, onCancel }) {
  const [q, setQ] = useState(question)
  const [a, setA] = useState(answer)
  return (
    <div style={{ flex:1, display:'flex', flexDirection:'column', gap:6 }}>
      <input className="qa-input" value={q} onChange={e => setQ(e.target.value)} placeholder="Question" />
      <textarea className="qa-input" value={a} onChange={e => setA(e.target.value)} placeholder="Answer" rows={2} />
      <div style={{ display:'flex', gap:6 }}>
        <Button size="sm" variant="primary" onClick={() => onSave(q, a)}>Save</Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
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
