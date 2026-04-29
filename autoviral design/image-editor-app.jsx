// image-editor-app.jsx — Image-text post editor (carousel/slides)
const { useState, useEffect, useRef } = React;

const slidesData = [
  { id: 's1', bg: 'linear-gradient(160deg, #1a2940 0%, #2a3550 50%, #4a3018 100%)', heading: '为什么', body: '47% 的创作者\n忽略了这件事', no: 1 },
  { id: 's2', bg: 'linear-gradient(160deg, #2a1f3a 0%, #3d2850 50%, #1a2540 100%)', heading: '不是算法', body: '是你的\n第一秒钩子', no: 2 },
  { id: 's3', bg: 'linear-gradient(160deg, #1a3530 0%, #2a4540 50%, #3d3520 100%)', heading: '三个公式', body: '可立即使用', no: 3 },
  { id: 's4', bg: 'linear-gradient(160deg, #3d2520 0%, #2a1f30 50%, #1a2535 100%)', heading: '收藏 +\n关注', body: '获取完整模板', no: 4 },
];

const fontOpts = [
  { id: 'editorial', name: 'Editorial Serif', sample: 'Aa', cls: 'font-editorial' },
  { id: 'sans', name: 'Inter Sans', sample: 'Aa', cls: '' },
  { id: 'mono', name: 'JetBrains Mono', sample: 'Aa', cls: 'font-mono' },
];
const palettes = [
  { id: 'midnight', cs: ['#1a2940', '#4a3018', '#ecedf0'] },
  { id: 'orchid', cs: ['#2a1f3a', '#3d2850', '#d6e4ee'] },
  { id: 'forest', cs: ['#1a3530', '#3d3520', '#ecf0e8'] },
  { id: 'rust', cs: ['#3d2520', '#1a2535', '#f0eae0'] },
  { id: 'paper', cs: ['#fafaf7', '#0f1822', '#5a6a7c'] },
];

// ========== TOP BAR ==========
function TopBar({ onToggleTheme, theme }) {
  return (
    <div style={{gridArea: 'top', display: 'flex', alignItems: 'center', gap: 16, padding: '0 18px', whiteSpace: 'nowrap', overflow: 'hidden'}} className="glass">
      <a href="Index.html" style={{display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text)', textDecoration: 'none'}}>
        <div style={{width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg, var(--accent-hi), var(--accent-lo))', display: 'grid', placeItems: 'center', color: 'var(--accent-fg)', fontSize: 11, fontWeight: 700}}>A</div>
        <div className="font-editorial" style={{fontSize: 15, fontStyle: 'italic'}}>Autoviral</div>
      </a>
      <div style={{width: 1, height: 18, background: 'var(--divider)'}}/>
      <div style={{display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden'}}>
        <span style={{color: 'var(--text-dimmer)'}}>Works</span>
        <span style={{color: 'var(--text-muted)'}}>›</span>
        <span style={{color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis'}}>《钩子公式》图文版 · v3</span>
        <span className="font-mono" style={{padding: '2px 6px', borderRadius: 4, background: 'var(--surface-2)', fontSize: 9, letterSpacing: '0.08em', color: 'var(--text-dim)', marginLeft: 6, flexShrink: 0}}>IMAGE · 4 SLIDES</span>
      </div>
      <div style={{flex: 1}}/>
      <div style={{display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap', flexShrink: 0}}>
        <span style={{width: 6, height: 6, borderRadius: '50%', background: 'var(--status-done)', boxShadow: '0 0 8px currentColor'}}/>
        <span className="font-mono" style={{letterSpacing: '0.06em'}}>SAVED · 2s ago</span>
      </div>
      <button onClick={onToggleTheme} style={{
        width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center',
        background: 'transparent', border: '1px solid var(--glass-border)', color: 'var(--text-dim)', cursor: 'pointer',
      }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          {theme === 'dark'
            ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>
            : <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/>}
        </svg>
      </button>
      <button style={{
        padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6,
        background: 'linear-gradient(180deg, var(--accent-hi), var(--accent))',
        color: 'var(--accent-fg)', border: '1px solid var(--accent-hi)',
        borderRadius: 9, fontSize: 12, fontWeight: 600, letterSpacing: '-0.01em',
        cursor: 'pointer', boxShadow: '0 4px 16px var(--accent-glow)',
      }}>导出 9 张图 / Export</button>
    </div>
  );
}

// ========== LEFT — SLIDES NAVIGATOR ==========
function SlidesNav({ active, setActive }) {
  return (
    <div style={{gridArea: 'left', display: 'flex', flexDirection: 'column', overflow: 'hidden'}} className="glass">
      <div style={{padding: '14px 14px 10px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
        <div className="font-editorial" style={{fontSize: 18, fontStyle: 'italic'}}>Slides</div>
        <span className="font-mono" style={{fontSize: 9, color: 'var(--text-dimmer)', letterSpacing: '0.08em'}}>{slidesData.length} / 9</span>
      </div>
      <div style={{flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8}}>
        {slidesData.map((s, i) => (
          <div key={s.id} onClick={() => setActive(i)} style={{
            display: 'flex', gap: 10, padding: 8, borderRadius: 10,
            background: active === i ? 'var(--surface-2)' : 'transparent',
            border: `1px solid ${active === i ? 'var(--accent)' : 'transparent'}`,
            cursor: 'pointer', transition: 'all .15s',
            boxShadow: active === i ? '0 0 12px var(--accent-glow)' : 'none',
          }}>
            <div style={{
              width: 54, height: 70, borderRadius: 6, flexShrink: 0,
              background: s.bg, position: 'relative', overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.08)',
            }}>
              <div style={{position: 'absolute', top: 4, left: 4, fontSize: 8, color: 'rgba(255,255,255,0.7)', fontFamily: 'JetBrains Mono', background: 'rgba(0,0,0,0.4)', padding: '1px 4px', borderRadius: 3}}>{s.no.toString().padStart(2,'0')}</div>
              <div style={{position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 4}}>
                <div style={{fontSize: 8, color: 'rgba(255,255,255,0.85)', fontFamily: 'Instrument Serif', fontStyle: 'italic', textAlign: 'center', lineHeight: 1.1}}>{s.heading}</div>
              </div>
            </div>
            <div style={{flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between'}}>
              <div>
                <div style={{fontSize: 11, fontWeight: 500, color: 'var(--text)', marginBottom: 2}}>第 {s.no} 张</div>
                <div style={{fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{s.body.replace('\n', ' ')}</div>
              </div>
              <div style={{display: 'flex', gap: 4, fontSize: 8, fontFamily: 'JetBrains Mono', color: 'var(--text-dimmer)', letterSpacing: '0.06em'}}>
                <span>·1080×1350</span>
              </div>
            </div>
          </div>
        ))}
        <button style={{
          padding: '12px', borderRadius: 10, border: '1px dashed var(--glass-hi)',
          background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer',
          fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 5v14M5 12h14"/></svg>
          新增一张 / Add slide
        </button>
        <div style={{marginTop: 6, padding: 10, borderRadius: 10, background: 'var(--surface-0)', border: '1px solid var(--glass-border)'}}>
          <div style={{fontSize: 10, color: 'var(--text-dimmer)', fontFamily: 'JetBrains Mono', letterSpacing: '0.08em', marginBottom: 6}}>AI 建议 · SUGGEST</div>
          <div style={{fontSize: 11, color: 'var(--text)', lineHeight: 1.45, marginBottom: 8}}>检测到第 4 张 CTA 信息密度偏低，建议加一张「数据证明」插页。</div>
          <button style={{padding: '4px 10px', fontSize: 10, borderRadius: 6, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer'}}>+ 插入 AI 建议</button>
        </div>
      </div>
    </div>
  );
}

// ========== CENTER — CANVAS ==========
function Canvas({ slide }) {
  return (
    <div style={{gridArea: 'canvas', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative'}}>
      {/* Toolbar over canvas */}
      <div className="glass" style={{display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px', marginBottom: 12, alignSelf: 'center'}}>
        {[
          {l: 'T', t: 'Text'},
          {l: '◇', t: 'Shape'},
          {l: '⌘', t: 'Image'},
          {l: '⊕', t: 'Sticker'},
          {l: '~', t: 'Brush'},
        ].map(b => (
          <button key={b.t} title={b.t} style={{
            width: 28, height: 28, borderRadius: 6, border: 'none', background: 'transparent',
            color: 'var(--text-dim)', cursor: 'pointer', fontSize: 13,
          }}>{b.l}</button>
        ))}
        <div style={{width: 1, height: 16, background: 'var(--divider)', margin: '0 4px'}}/>
        <span className="font-mono" style={{fontSize: 10, color: 'var(--text-dimmer)', padding: '0 6px'}}>1080 × 1350</span>
        <div style={{width: 1, height: 16, background: 'var(--divider)', margin: '0 4px'}}/>
        <button style={{padding: '4px 8px', fontSize: 10, borderRadius: 5, border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', fontFamily: 'JetBrains Mono', letterSpacing: '0.06em'}}>FIT</button>
        <span className="font-mono" style={{fontSize: 10, color: 'var(--text-dim)', padding: '0 4px'}}>62%</span>
      </div>

      {/* Canvas area */}
      <div style={{flex: 1, display: 'grid', placeItems: 'center', position: 'relative', overflow: 'hidden'}}>
        {/* grid bg */}
        <div style={{position: 'absolute', inset: 0, opacity: 0.4, backgroundImage: 'radial-gradient(circle, var(--glass-hi) 1px, transparent 1px)', backgroundSize: '24px 24px'}}/>
        <div style={{
          position: 'relative', width: 360, aspectRatio: '4/5', borderRadius: 14, overflow: 'hidden',
          background: slide.bg,
          boxShadow: '0 30px 80px rgba(0,0,0,0.4), 0 0 0 1px var(--glass-hi)',
        }}>
          {/* Page number — editorial */}
          <div style={{position: 'absolute', top: 18, left: 18, display: 'flex', alignItems: 'center', gap: 6}}>
            <div className="font-mono" style={{fontSize: 9, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.18em'}}>NO.</div>
            <div className="font-editorial" style={{fontSize: 32, fontStyle: 'italic', color: 'rgba(255,255,255,0.95)', lineHeight: 1, fontWeight: 500}}>{slide.no.toString().padStart(2,'0')}</div>
          </div>
          <div style={{position: 'absolute', top: 22, right: 18, fontSize: 9, color: 'rgba(255,255,255,0.45)', fontFamily: 'JetBrains Mono', letterSpacing: '0.18em'}}>AUTOVIRAL · 03/14</div>

          {/* Headline editorial */}
          <div style={{position: 'absolute', left: 24, right: 24, top: '38%', transform: 'translateY(-50%)'}}>
            <div className="font-editorial" style={{fontSize: 56, fontStyle: 'italic', color: 'rgba(255,255,255,0.98)', lineHeight: 0.95, letterSpacing: '-0.02em', marginBottom: 12, fontWeight: 500}}>{slide.heading}</div>
            <div style={{fontSize: 22, color: 'rgba(255,255,255,0.92)', lineHeight: 1.25, fontWeight: 500, letterSpacing: '-0.02em', whiteSpace: 'pre-line'}}>{slide.body}</div>
          </div>

          {/* Bottom bar */}
          <div style={{position: 'absolute', bottom: 18, left: 18, right: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}>
            <div style={{display: 'flex', gap: 4}}>
              {slidesData.map((_, i) => <div key={i} style={{width: i === slide.no - 1 ? 14 : 4, height: 3, borderRadius: 2, background: i === slide.no - 1 ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.3)'}}/>)}
            </div>
            <div className="font-mono" style={{fontSize: 9, color: 'rgba(255,255,255,0.5)', letterSpacing: '0.12em'}}>SWIPE →</div>
          </div>

          {/* Selection handles overlay (showing first text element selected) */}
          <div style={{position: 'absolute', left: 20, top: '32%', right: 20, height: 64, border: '1.5px solid var(--accent)', pointerEvents: 'none'}}>
            {[[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,y],i) => <div key={i} style={{position: 'absolute', width: 7, height: 7, background: 'var(--accent)', borderRadius: 1, [x<0?'left':'right']: -4, [y<0?'top':'bottom']: -4}}/>)}
          </div>
        </div>

        {/* Floating safe-area chip */}
        <div style={{position: 'absolute', top: 12, right: 12, padding: '4px 8px', borderRadius: 6, background: 'var(--surface-2)', border: '1px solid var(--glass-border)', fontSize: 10, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono', letterSpacing: '0.06em'}}>SAFE: 4:5 · IG · 小红书</div>
      </div>
    </div>
  );
}

// ========== RIGHT — INSPECTOR ==========
function Inspector() {
  const [tab, setTab] = useState('design');
  const [headFont, setHeadFont] = useState('editorial');
  const [pal, setPal] = useState('midnight');
  return (
    <div style={{gridArea: 'right', display: 'flex', flexDirection: 'column', overflow: 'hidden'}} className="glass">
      <div style={{display: 'flex', borderBottom: '1px solid var(--divider)'}}>
        {[['design','设计'],['copy','文案'],['ai','AI']].map(([k,l]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: 1, padding: '14px 0', fontSize: 12, fontWeight: tab === k ? 600 : 500,
            background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === k ? 'var(--accent)' : 'transparent'}`,
            color: tab === k ? 'var(--text)' : 'var(--text-dim)', cursor: 'pointer',
          }}>{l}</button>
        ))}
      </div>

      <div style={{flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 16}}>
        {tab === 'design' && (
          <>
            <Section label="Headline Font">
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6}}>
                {fontOpts.map(f => (
                  <button key={f.id} onClick={() => setHeadFont(f.id)} className={f.cls} style={{
                    aspectRatio: '1/1', borderRadius: 8, fontSize: 22,
                    background: headFont === f.id ? 'var(--surface-2)' : 'var(--surface-0)',
                    border: `1px solid ${headFont === f.id ? 'var(--accent)' : 'var(--glass-border)'}`,
                    color: 'var(--text)', cursor: 'pointer',
                    fontStyle: f.id === 'editorial' ? 'italic' : 'normal',
                  }}>{f.sample}</button>
                ))}
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-dimmer)', marginTop: 4, fontFamily: 'JetBrains Mono'}}>
                {fontOpts.map(f => <span key={f.id}>{f.name.split(' ')[0]}</span>)}
              </div>
            </Section>

            <Section label="Headline Size">
              <div style={{display: 'flex', alignItems: 'center', gap: 10}}>
                <input type="range" min="20" max="80" defaultValue="56" style={{flex: 1, accentColor: 'var(--accent)'}}/>
                <div className="font-mono" style={{fontSize: 11, color: 'var(--text-dim)', minWidth: 36, textAlign: 'right'}}>56pt</div>
              </div>
            </Section>

            <Section label="Palette">
              <div style={{display: 'flex', flexDirection: 'column', gap: 6}}>
                {palettes.map(p => (
                  <button key={p.id} onClick={() => setPal(p.id)} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px',
                    borderRadius: 8, background: pal === p.id ? 'var(--surface-2)' : 'transparent',
                    border: `1px solid ${pal === p.id ? 'var(--accent)' : 'transparent'}`, cursor: 'pointer',
                  }}>
                    <div style={{display: 'flex'}}>
                      {p.cs.map((c, i) => <div key={i} style={{width: 18, height: 22, background: c, marginLeft: i ? -4 : 0, borderRadius: 3, border: '1px solid var(--glass-border)'}}/>)}
                    </div>
                    <div style={{fontSize: 11, color: 'var(--text)', textTransform: 'capitalize', flex: 1, textAlign: 'left'}}>{p.id}</div>
                    {pal === p.id && <span style={{color: 'var(--accent)', fontSize: 12}}>✓</span>}
                  </button>
                ))}
              </div>
            </Section>

            <Section label="Layout">
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6}}>
                {[
                  {id:'centered', d: <><rect x="20" y="32" width="40" height="3" fill="currentColor"/><rect x="14" y="40" width="52" height="6" fill="currentColor"/><rect x="20" y="50" width="40" height="3" fill="currentColor" opacity="0.5"/></>},
                  {id:'left', d: <><rect x="10" y="20" width="3" height="3" fill="currentColor"/><rect x="10" y="34" width="46" height="6" fill="currentColor"/><rect x="10" y="44" width="38" height="3" fill="currentColor" opacity="0.5"/></>},
                  {id:'split', d: <><rect x="10" y="14" width="60" height="22" fill="currentColor" opacity="0.2"/><rect x="14" y="42" width="44" height="6" fill="currentColor"/><rect x="14" y="52" width="32" height="3" fill="currentColor" opacity="0.5"/></>},
                ].map((l, i) => (
                  <button key={l.id} style={{
                    aspectRatio: '4/5', borderRadius: 8, padding: 0,
                    background: i === 0 ? 'var(--surface-2)' : 'var(--surface-0)',
                    border: `1px solid ${i === 0 ? 'var(--accent)' : 'var(--glass-border)'}`,
                    color: 'var(--text-dim)', cursor: 'pointer',
                  }}>
                    <svg width="100%" height="100%" viewBox="0 0 80 100">{l.d}</svg>
                  </button>
                ))}
              </div>
            </Section>

            <Section label="Effects">
              {[['噪点 / Grain', 35],['渐变 / Gradient', 80],['锐化 / Sharpen', 20]].map(([n,v]) => (
                <div key={n} style={{display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8}}>
                  <span style={{fontSize: 11, color: 'var(--text-dim)', flex: '0 0 110px'}}>{n}</span>
                  <input type="range" min="0" max="100" defaultValue={v} style={{flex: 1, accentColor: 'var(--accent)'}}/>
                  <span className="font-mono" style={{fontSize: 10, color: 'var(--text-dimmer)', minWidth: 24, textAlign: 'right'}}>{v}</span>
                </div>
              ))}
            </Section>
          </>
        )}

        {tab === 'copy' && (
          <>
            <Section label="标题 / Headline">
              <textarea defaultValue="为什么" rows="2" style={{
                width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--glass-border)',
                background: 'var(--surface-0)', color: 'var(--text)', fontSize: 14,
                fontFamily: 'Instrument Serif, serif', fontStyle: 'italic', resize: 'vertical',
              }}/>
            </Section>
            <Section label="正文 / Body">
              <textarea defaultValue={"47% 的创作者\n忽略了这件事"} rows="4" style={{
                width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--glass-border)',
                background: 'var(--surface-0)', color: 'var(--text)', fontSize: 13, resize: 'vertical',
              }}/>
            </Section>
            <Section label="发布文案 / Caption">
              <textarea defaultValue="3 个鲜为人知的钩子公式，帮你把第一秒留住 47% 的滑走流量。👇 Swipe for the playbook · #内容创作 #创业" rows="5" style={{
                width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--glass-border)',
                background: 'var(--surface-0)', color: 'var(--text)', fontSize: 12, lineHeight: 1.55, resize: 'vertical',
              }}/>
              <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, fontFamily: 'JetBrains Mono', color: 'var(--text-dimmer)'}}>
                <span>112 / 2200 chars</span>
                <span style={{color: 'var(--status-done)'}}>✓ 含 2 标签</span>
              </div>
            </Section>
            <button style={{padding: '8px 12px', borderRadius: 8, border: '1px solid var(--accent)', background: 'transparent', color: 'var(--accent)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center'}}>
              ✨ 让 AI 改写一版 / Rewrite with AI
            </button>
          </>
        )}

        {tab === 'ai' && (
          <>
            <div style={{padding: 12, borderRadius: 10, background: 'var(--surface-0)', border: '1px solid var(--glass-border)'}}>
              <div style={{fontSize: 10, fontFamily: 'JetBrains Mono', color: 'var(--text-dimmer)', letterSpacing: '0.08em', marginBottom: 6}}>STYLE PROMPT</div>
              <textarea defaultValue="editorial / archival magazine spread, italic serif headlines, muted midnight palette, soft grain" rows="3" style={{width: '100%', padding: 0, border: 'none', background: 'transparent', color: 'var(--text)', fontSize: 12, lineHeight: 1.5, resize: 'vertical', outline: 'none'}}/>
            </div>
            <Section label="一键风格 / Quick Style">
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6}}>
                {['Editorial','Brutalist','Y2K','Minimal','Magazine','Bento'].map((s,i) => (
                  <button key={s} style={{
                    padding: '10px 8px', borderRadius: 8,
                    background: i === 0 ? 'var(--surface-2)' : 'var(--surface-0)',
                    border: `1px solid ${i === 0 ? 'var(--accent)' : 'var(--glass-border)'}`,
                    color: 'var(--text)', cursor: 'pointer', fontSize: 11, textAlign: 'left',
                  }}>{s}</button>
                ))}
              </div>
            </Section>
            <button style={{padding: '10px 12px', borderRadius: 9, border: 'none', background: 'linear-gradient(180deg, var(--accent-hi), var(--accent))', color: 'var(--accent-fg)', cursor: 'pointer', fontSize: 12, fontWeight: 600, boxShadow: '0 4px 16px var(--accent-glow)'}}>
              重新生成全部 9 张 / Regenerate all
            </button>
            <div style={{fontSize: 10, color: 'var(--text-dimmer)', textAlign: 'center'}}>预计 ~24s · ~ $0.08</div>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <div style={{fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dimmer)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8}}>{label}</div>
      {children}
    </div>
  );
}

// ========== BOTTOM TRAY — CAROUSEL FILMSTRIP ==========
function Filmstrip({ active, setActive }) {
  return (
    <div style={{gridArea: 'tray', display: 'flex', alignItems: 'center', gap: 12, padding: 12, overflow: 'hidden'}} className="glass">
      <div style={{flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4, paddingRight: 12, borderRight: '1px solid var(--divider)'}}>
        <div className="font-editorial" style={{fontSize: 14, fontStyle: 'italic'}}>Carousel</div>
        <div className="font-mono" style={{fontSize: 9, color: 'var(--text-dimmer)', letterSpacing: '0.08em'}}>{active+1} / {slidesData.length} · DRAG TO REORDER</div>
      </div>
      <div style={{flex: 1, display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4}}>
        {slidesData.map((s, i) => (
          <div key={s.id} onClick={() => setActive(i)} style={{
            position: 'relative', flex: '0 0 auto', width: 76, aspectRatio: '4/5', borderRadius: 8,
            background: s.bg, cursor: 'grab', overflow: 'hidden',
            border: `1.5px solid ${active === i ? 'var(--accent)' : 'var(--glass-border)'}`,
            boxShadow: active === i ? '0 0 12px var(--accent-glow)' : 'none',
          }}>
            <div style={{position: 'absolute', top: 4, left: 5, fontSize: 8, fontFamily: 'JetBrains Mono', color: 'rgba(255,255,255,0.6)'}}>{s.no.toString().padStart(2,'0')}</div>
            <div style={{position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 4}}>
              <div className="font-editorial" style={{fontSize: 11, fontStyle: 'italic', color: 'rgba(255,255,255,0.92)', textAlign: 'center', lineHeight: 1}}>{s.heading}</div>
            </div>
          </div>
        ))}
        <button style={{flex: '0 0 auto', width: 76, aspectRatio: '4/5', borderRadius: 8, border: '1px dashed var(--glass-hi)', background: 'transparent', color: 'var(--text-dimmer)', cursor: 'pointer', fontSize: 18}}>+</button>
      </div>
      <div style={{flex: '0 0 auto', display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 12, borderLeft: '1px solid var(--divider)', alignItems: 'flex-end'}}>
        <div className="font-mono" style={{fontSize: 9, color: 'var(--text-dimmer)', letterSpacing: '0.08em'}}>SWIPE PREVIEW</div>
        <button style={{padding: '5px 10px', fontSize: 11, borderRadius: 6, border: '1px solid var(--glass-border)', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5}}>
          ▶ 播放
        </button>
      </div>
    </div>
  );
}

// ========== APP ==========
function App() {
  const { useTweaks, TweaksPanel, TweakSection, TweakRadio } = window;
  const [tweaks, setTweak] = useTweaks(/*EDITMODE-BEGIN*/{
    "theme": "dark",
    "accent": "steel"
  }/*EDITMODE-END*/);
  const [active, setActive] = useState(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tweaks.theme);
    document.documentElement.setAttribute('data-accent', tweaks.accent);
  }, [tweaks.theme, tweaks.accent]);

  return (
    <>
      <div className="editor-shell">
        <TopBar onToggleTheme={() => setTweak('theme', tweaks.theme === 'dark' ? 'light' : 'dark')} theme={tweaks.theme}/>
        <SlidesNav active={active} setActive={setActive}/>
        <Canvas slide={slidesData[active]}/>
        <Inspector/>
        <Filmstrip active={active} setActive={setActive}/>
      </div>
      <TweaksPanel>
        <TweakSection title="主题 / Theme">
          <TweakRadio label="Mode" value={tweaks.theme} onChange={v => setTweak('theme', v)} options={[{value:'dark',label:'Dark'},{value:'light',label:'Light'}]}/>
          <TweakRadio label="Accent" value={tweaks.accent} onChange={v => setTweak('accent', v)} options={[
            {value:'steel',label:'Steel'},{value:'violet',label:'Violet'},{value:'cyan',label:'Cyan'},{value:'coral',label:'Coral'},{value:'lime',label:'Lime'},
          ]}/>
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
