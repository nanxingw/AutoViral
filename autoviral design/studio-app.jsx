const { useState, useEffect, useRef } = React;

// ========== TOP BAR ==========
function TopBar({ onToggleTheme, theme }) {
  return (
    <div style={{gridArea: 'top', display: 'flex', alignItems: 'center', gap: 16, padding: '0 18px', whiteSpace: 'nowrap', overflow: 'hidden'}} className="glass">
      <button style={{background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, flexShrink: 0}}>
        <Icon d={Icons.back}/> <B zh="返回" en="Back"/>
      </button>
      <div style={{width: 1, height: 20, background: 'var(--divider)', flexShrink: 0}}/>
      <div style={{display: 'flex', alignItems: 'baseline', gap: 10, flex: 1, minWidth: 0, overflow: 'hidden'}}>
        <span className="font-editorial" style={{fontSize: 22, fontStyle: 'italic', color: 'var(--accent)', letterSpacing: '-0.02em', flexShrink: 0}}>Autoviral</span>
        <span style={{fontSize: 11, color: 'var(--text-dimmer)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0}}>Studio ∙ v4.0</span>
        <div style={{width: 1, height: 14, background: 'var(--divider)', margin: '0 8px', flexShrink: 0}}/>
        <div style={{display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0, overflow: 'hidden'}}>
          <span style={{fontSize: 14, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.015em', flexShrink: 0}}>{mockWork.title}</span>
          <span style={{fontSize: 11, color: 'var(--text-dimmer)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis'}} className="font-editorial">— {mockWork.titleEn}</span>
        </div>
      </div>
      <div style={{flexShrink: 0}}><StatusDot status="running" label="ASSETS · 5m 32s"/></div>
      <div style={{width: 1, height: 20, background: 'var(--divider)', flexShrink: 0}}/>
      <IconButton tip="Search"><Icon d={Icons.search}/></IconButton>
      <IconButton tip="Theme" onClick={onToggleTheme}>
        <Icon d={theme === 'dark'
          ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></>
          : <><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></>}/>
      </IconButton>
      <IconButton tip="Settings"><Icon d={Icons.settings}/></IconButton>
      <PrimaryButton icon={<Icon d={Icons.download} size={14}/>}>
        <B zh="导出" en="Export"/>
      </PrimaryButton>
    </div>
  );
}

// ========== PIPELINE BAR (embedded in top area) ==========
function PipelineRail() {
  return (
    <div style={{display: 'flex', alignItems: 'center', gap: 4, padding: '10px 14px', whiteSpace: 'nowrap', overflowX: 'auto'}} className="glass">
      {mockPipeline.map((step, i) => (
        <React.Fragment key={step.id}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px',
            background: step.status === 'running' ? 'var(--accent-glow)' : (step.status === 'done' ? 'rgba(163,230,53,0.08)' : 'transparent'),
            border: `1px solid ${step.status === 'running' ? 'var(--accent)' : (step.status === 'done' ? 'rgba(163,230,53,0.25)' : 'var(--glass-border)')}`,
            borderRadius: 999,
            flex: '0 0 auto',
          }}>
            <span style={{
              width: 22, height: 22, borderRadius: '50%', display: 'grid', placeItems: 'center', flexShrink: 0,
              background: step.status === 'done' ? 'var(--status-done)' : (step.status === 'running' ? 'var(--accent)' : 'transparent'),
              border: step.status === 'pending' ? '1px dashed var(--text-muted)' : 'none',
              color: step.status === 'done' ? 'var(--accent-fg)' : (step.status === 'running' ? 'var(--accent-fg)' : 'var(--text-dimmer)'),
              fontSize: 11, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
            }}>
              {step.status === 'done' ? <Icon d={Icons.check} size={12} stroke={2.5}/> : (i+1).toString().padStart(2,'0')}
            </span>
            <div style={{display: 'flex', flexDirection: 'column', lineHeight: 1.15, whiteSpace: 'nowrap'}}>
              <span style={{fontSize: 12, fontWeight: 500, color: 'var(--text)'}}>{step.zh}</span>
              <span style={{fontSize: 9, color: 'var(--text-dimmer)', letterSpacing: '0.08em', textTransform: 'uppercase', whiteSpace: 'nowrap'}} className="font-mono">{step.en} · {step.duration}</span>
            </div>
            {step.status === 'running' && <StatusDot status="running"/>}
          </div>
          {i < mockPipeline.length - 1 && (
            <div style={{flex: '0 0 16px', height: 1, background: 'var(--divider)', position: 'relative'}}>
              {mockPipeline[i].status === 'done' && <div style={{position: 'absolute', inset: 0, background: 'var(--accent)', opacity: 0.4}}/>}
            </div>
          )}
        </React.Fragment>
      ))}
      <div style={{flex: 1, minWidth: 16}}/>
      <div style={{display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-dimmer)', whiteSpace: 'nowrap', flexShrink: 0}} className="font-mono">
        <span>TOTAL 11:54</span>
        <span>·</span>
        <span>EVAL ON</span>
      </div>
    </div>
  );
}

// ========== CHAT PANEL ==========
function ChatPanel() {
  return (
    <div style={{gridArea: 'chat', display: 'flex', flexDirection: 'column', overflow: 'hidden'}} className="glass">
      {/* Header */}
      <div style={{padding: '16px 18px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', gap: 10}}>
        <div style={{width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, var(--accent-hi), var(--accent-lo))', display: 'grid', placeItems: 'center', color: 'var(--accent-fg)'}}>
          <Icon d={Icons.sparkle} size={14} stroke={2}/>
        </div>
        <div style={{flex: 1}}>
          <div style={{fontSize: 13, fontWeight: 600, letterSpacing: '-0.015em'}}><B zh="创作代理" en="Creative Agent"/></div>
          <div style={{fontSize: 10, color: 'var(--text-dimmer)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em'}}>CLAUDE-SONNET-4.5 · STREAMING</div>
        </div>
        <IconButton tip="More"><Icon d={Icons.more}/></IconButton>
      </div>

      {/* Messages */}
      <div style={{flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14}}>
        {mockChat.map((m, i) => <ChatMessage key={i} msg={m}/>)}
        {/* typing indicator */}
        <div style={{display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface-0)', borderRadius: 10, alignSelf: 'flex-start', maxWidth: '85%'}}>
          <div style={{display: 'flex', gap: 3}}>
            <span className="pulse-dot" style={{width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)'}}/>
            <span className="pulse-dot" style={{width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animationDelay: '0.2s'}}/>
            <span className="pulse-dot" style={{width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', animationDelay: '0.4s'}}/>
          </div>
          <span style={{fontSize: 11, color: 'var(--text-dim)', fontFamily: 'JetBrains Mono, monospace'}}>thinking…</span>
        </div>
      </div>

      {/* Composer */}
      <div style={{padding: 12, borderTop: '1px solid var(--divider)'}}>
        <div style={{display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap'}}>
          {['重新生成此片段', '调整节奏', '换 BGM 风格'].map(q => (
            <button key={q} style={{
              padding: '5px 10px', fontSize: 11, background: 'transparent',
              border: '1px solid var(--glass-border)', borderRadius: 999, color: 'var(--text-dim)',
              cursor: 'pointer', letterSpacing: '-0.005em',
            }}>{q}</button>
          ))}
        </div>
        <div style={{
          background: 'var(--surface-0)', borderRadius: 12,
          border: '1px solid var(--glass-border)', padding: 10,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <div style={{fontSize: 13, color: 'var(--text-dim)', minHeight: 38, letterSpacing: '-0.01em'}}>
            对 clip-03 的爆炸时机再延后 0.5 秒……
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: 4}}>
            <IconButton tip="Attach" size={28}><Icon d={Icons.attach} size={14}/></IconButton>
            <IconButton tip="Mention asset" size={28}><Icon d={Icons.image} size={14}/></IconButton>
            <div style={{flex: 1}}/>
            <span style={{fontSize: 10, color: 'var(--text-dimmer)', fontFamily: 'JetBrains Mono, monospace'}}>⌘↵ SEND</span>
            <button style={{
              width: 28, height: 28, display: 'grid', placeItems: 'center',
              background: 'var(--accent)', border: 'none', borderRadius: 7, color: 'var(--accent-fg)', cursor: 'pointer',
              boxShadow: '0 0 12px var(--accent-glow)',
            }}><Icon d={Icons.send} size={14} stroke={2}/></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatMessage({ msg }) {
  if (msg.role === 'system') {
    return (
      <div style={{textAlign: 'center', fontSize: 11, color: 'var(--text-dimmer)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.04em'}}>
        <span style={{padding: '3px 10px', border: '1px solid var(--divider)', borderRadius: 999}}>· {msg.text} ·</span>
      </div>
    );
  }
  const isUser = msg.role === 'user';
  return (
    <div className="slide-up" style={{alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '90%'}}>
      {!isUser && msg.tool && (
        <div style={{display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', letterSpacing: '0.08em', textTransform: 'uppercase'}}>
          <Icon d={msg.state === 'running' ? Icons.sparkle : Icons.check_circle} size={11}/>
          <span>{msg.tool}</span>
          {msg.state === 'running' && <span style={{color: 'var(--status-running)'}}>● running</span>}
        </div>
      )}
      <div style={{
        padding: '10px 13px',
        background: isUser ? 'linear-gradient(135deg, var(--accent-glow), rgba(212,184,150,0.12))' : 'var(--surface-0)',
        border: `1px solid ${isUser ? 'var(--accent)' : 'var(--glass-border)'}`,
        borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        fontSize: 13, lineHeight: 1.55, letterSpacing: '-0.005em',
        color: 'var(--text)',
      }}>
        {msg.text}
      </div>
      <div style={{fontSize: 10, color: 'var(--text-dimmer)', marginTop: 3, textAlign: isUser ? 'right' : 'left', fontFamily: 'JetBrains Mono, monospace'}}>{msg.time}</div>
    </div>
  );
}

// ========== PREVIEW AREA ==========
function Preview() {
  const [playing, setPlaying] = useState(false);
  return (
    <div style={{gridArea: 'preview', display: 'flex', flexDirection: 'column', overflow: 'hidden'}} className="glass">
      <div style={{padding: '12px 16px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', gap: 12}}>
        <div style={{display: 'flex', gap: 2, background: 'var(--surface-0)', borderRadius: 8, padding: 3}}>
          {['预览', '参考', '对比'].map((t, i) => (
            <button key={t} style={{
              padding: '5px 12px', fontSize: 11, background: i === 0 ? 'var(--glass-hi)' : 'transparent',
              border: 'none', borderRadius: 6, color: i === 0 ? 'var(--text)' : 'var(--text-dim)',
              cursor: 'pointer', fontWeight: 500,
            }}>{t}</button>
          ))}
        </div>
        <div style={{fontSize: 11, color: 'var(--text-dimmer)', fontFamily: 'JetBrains Mono, monospace'}}>1080 × 1920 · 30FPS · H.264</div>
        <div style={{flex: 1}}/>
        <IconButton tip="Quality"><span style={{fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)'}}>HD</span></IconButton>
        <IconButton tip="Fullscreen"><Icon d={Icons.fullscreen} size={14}/></IconButton>
      </div>

      {/* Viewport */}
      <div style={{flex: 1, display: 'grid', placeItems: 'center', padding: 20, position: 'relative', background: 'radial-gradient(ellipse at center, rgba(0,0,0,0.3), transparent 70%)'}}>
        {/* Phone-aspect canvas */}
          <div style={{
          position: 'relative', width: 260, aspectRatio: '9/16',
          borderRadius: 20, overflow: 'hidden',
          background: 'linear-gradient(180deg, #0a1420 0%, #1a2940 40%, #3d2818 85%, #7a4015 100%)',
          boxShadow: '0 40px 80px rgba(0,0,0,0.35), 0 0 0 1px var(--glass-hi), 0 0 60px var(--accent-glow)',
        }}>
          {/* mock cinematic frame — moon + astronaut silhouette */}
          <div style={{position: 'absolute', top: '18%', left: '50%', transform: 'translateX(-50%)', width: 120, height: 120, borderRadius: '50%',
            background: 'radial-gradient(circle at 35% 35%, #f5ecd9, #d9c9a8 40%, #8a7455 80%)',
            boxShadow: '0 0 60px rgba(245,236,217,0.3), inset -20px -20px 40px rgba(0,0,0,0.4)',
          }}/>
          {/* craters */}
          {[[40,40,8],[60,55,4],[55,70,6],[75,45,5]].map(([x,y,r],i) => (
            <div key={i} style={{position: 'absolute', top: `${18 + y*0.25}%`, left: `${30 + x*0.4}%`, width: r, height: r, borderRadius: '50%', background: 'rgba(0,0,0,0.25)'}}/>
          ))}
          {/* silhouette */}
          <div style={{position: 'absolute', bottom: 0, left: 0, right: 0, height: '42%', background: 'linear-gradient(180deg, transparent, rgba(0,0,0,0.85) 60%)'}}/>
          <svg viewBox="0 0 260 180" style={{position: 'absolute', bottom: 0, left: 0, width: '100%', height: '48%'}} preserveAspectRatio="xMidYEnd meet">
            <path d="M0 180 L0 110 Q 40 90 70 95 Q 90 70 130 68 Q 170 72 195 95 Q 230 92 260 115 L260 180 Z" fill="#0a0a0e"/>
            <circle cx="132" cy="56" r="14" fill="#0a0a0e"/>
            <circle cx="132" cy="56" r="10" fill="#1a2940"/>
            <rect x="117" y="60" width="30" height="10" rx="3" fill="#0a0a0e"/>
          </svg>
          {/* subtitle */}
          <div style={{position: 'absolute', bottom: 20, left: 0, right: 0, textAlign: 'center', padding: '0 16px'}}>
            <div style={{
              display: 'inline-block', padding: '4px 10px',
              background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(8px)',
              borderRadius: 4, fontSize: 10, color: '#fff',
              fontWeight: 600, letterSpacing: '0.04em',
              textShadow: '0 2px 4px rgba(0,0,0,0.8)',
            }}>
              静默之上，战火将至
            </div>
          </div>
          {/* safe-zone overlay */}
          <div style={{position: 'absolute', inset: '5%', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 14, pointerEvents: 'none'}}/>
        </div>

        {/* Side meta (left) */}
        <div style={{position: 'absolute', left: 24, top: 24, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 10, color: 'var(--text-dimmer)', fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em'}}>
          <div>FRAME 00:04 / 00:38</div>
          <div>CLIP 01 · MOONRISE</div>
          <div style={{color: 'var(--accent)'}}>▲ EST. 38.00s</div>
        </div>

        {/* Ambient grid */}
        <svg style={{position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', opacity: 0.15}}>
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--accent)" strokeWidth="0.3"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)"/>
        </svg>
      </div>

      {/* Transport bar */}
      <div style={{padding: '10px 16px', borderTop: '1px solid var(--divider)', display: 'flex', alignItems: 'center', gap: 12}}>
        <IconButton tip="Prev"><Icon d={<><polygon points="19 20 9 12 19 4 19 20" fill="currentColor"/><rect x="5" y="4" width="2" height="16" fill="currentColor"/></>} size={14}/></IconButton>
        <button onClick={() => setPlaying(!playing)} style={{
          width: 40, height: 40, borderRadius: '50%', display: 'grid', placeItems: 'center',
          background: 'var(--accent)', border: 'none', color: 'var(--accent-fg)', cursor: 'pointer',
          boxShadow: '0 0 20px var(--accent-glow)',
        }}>
          <Icon d={playing ? Icons.pause : Icons.play} size={16} stroke={2}/>
        </button>
        <IconButton tip="Next"><Icon d={<><polygon points="5 4 15 12 5 20 5 4" fill="currentColor"/><rect x="17" y="4" width="2" height="16" fill="currentColor"/></>} size={14}/></IconButton>
        <div style={{flex: 1, display: 'flex', alignItems: 'center', gap: 10}}>
          <span style={{fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--accent)', fontWeight: 500}}>00:04.12</span>
          <div style={{flex: 1, height: 3, background: 'var(--glass-border)', borderRadius: 2, position: 'relative', overflow: 'visible'}}>
            <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: '11%', background: 'linear-gradient(90deg, var(--accent-lo), var(--accent))', borderRadius: 2, boxShadow: '0 0 8px var(--accent-glow)'}}/>
            <div style={{position: 'absolute', left: '11%', top: '50%', transform: 'translate(-50%,-50%)', width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)', boxShadow: '0 0 12px var(--accent-glow), 0 0 0 3px rgba(255,255,255,0.08)'}}/>
          </div>
          <span style={{fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)'}}>00:38.00</span>
        </div>
        <IconButton tip="Volume"><Icon d={Icons.volume} size={14}/></IconButton>
        <IconButton tip="Quality" size={28}><span style={{fontSize: 9, fontFamily: 'JetBrains Mono, monospace'}}>1×</span></IconButton>
      </div>
    </div>
  );
}

// ========== TIMELINE ==========
function Timeline() {
  return (
    <div style={{gridArea: 'timeline', display: 'flex', flexDirection: 'column', overflow: 'hidden'}} className="glass">
      {/* Toolbar */}
      <div style={{padding: '8px 14px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', gap: 8}}>
        <span style={{fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase'}}>Timeline</span>
        <div style={{width: 1, height: 14, background: 'var(--divider)'}}/>
        <IconButton size={26} tip="Split"><Icon d={Icons.scissors} size={13}/></IconButton>
        <IconButton size={26} tip="Layer"><Icon d={Icons.layers} size={13}/></IconButton>
        <div style={{flex: 1}}/>
        <IconButton size={26} tip="Zoom out"><Icon d={Icons.zoom_out} size={13}/></IconButton>
        <div style={{fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dim)', minWidth: 36, textAlign: 'center'}}>1.2×</div>
        <IconButton size={26} tip="Zoom in"><Icon d={Icons.zoom_in} size={13}/></IconButton>
      </div>

      {/* Ruler */}
      <div style={{height: 22, borderBottom: '1px solid var(--divider)', position: 'relative', padding: '0 150px 0 110px'}}>
        <div style={{position: 'absolute', inset: 0, padding: '0 150px 0 110px'}}>
          <div style={{position: 'relative', height: '100%'}}>
            {Array.from({length: 10}).map((_, i) => (
              <div key={i} style={{position: 'absolute', left: `${i * 10}%`, top: 0, bottom: 0, borderLeft: '1px solid var(--divider)'}}>
                <span style={{fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dimmer)', paddingLeft: 4, lineHeight: '22px'}}>0:{(i*4).toString().padStart(2,'0')}</span>
              </div>
            ))}
            {/* playhead */}
            <div style={{position: 'absolute', left: '11%', top: 0, bottom: -1000, zIndex: 5}}>
              <div style={{width: 12, height: 12, background: 'var(--accent)', transform: 'translateX(-50%) rotate(45deg)', borderRadius: '2px 2px 2px 2px', boxShadow: '0 0 12px var(--accent-glow)'}}/>
              <div style={{position: 'absolute', left: 0, top: 10, width: 1, height: 9999, background: 'var(--accent)', opacity: 0.7, boxShadow: '0 0 6px var(--accent-glow)'}}/>
            </div>
          </div>
        </div>
      </div>

      {/* Tracks */}
      <div style={{flex: 1, overflowY: 'auto', overflowX: 'hidden'}}>
        <Track icon={Icons.film} label={<B zh="视频" en="Video" sep=" · "/>} color="var(--accent)">
          <div style={{display: 'flex', gap: 2, height: '100%'}}>
            {mockClips.map(c => {
              const isLight = document.documentElement.getAttribute('data-theme') === 'light';
              const bg = isLight
                ? `linear-gradient(135deg, hsl(${c.hue}, 35%, 82%), hsl(${c.hue + 20}, 40%, 72%))`
                : `linear-gradient(135deg, hsl(${c.hue}, 30%, 30%), hsl(${c.hue + 20}, 35%, 20%))`;
              const fg = isLight ? 'rgba(15,24,34,0.88)' : 'rgba(255,255,255,0.92)';
              const fgDim = isLight ? 'rgba(15,24,34,0.5)' : 'rgba(255,255,255,0.6)';
              const fgDimmer = isLight ? 'rgba(15,24,34,0.35)' : 'rgba(255,255,255,0.4)';
              return (
              <div key={c.id} style={{
                flex: c.duration, minWidth: 40, height: '100%',
                background: bg,
                border: '1px solid rgba(128,128,128,0.15)',
                borderRadius: 6, padding: 6, position: 'relative', overflow: 'hidden',
                cursor: 'pointer',
              }}>
                <div style={{fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: fgDim, letterSpacing: '0.06em'}}>{c.idx.toString().padStart(2,'0')}</div>
                <div style={{fontSize: 10, color: fg, fontWeight: 500, marginTop: 2, letterSpacing: '-0.01em'}}>{c.label}</div>
                <div style={{position: 'absolute', bottom: 4, left: 6, right: 6, fontSize: 8, fontFamily: 'JetBrains Mono, monospace', color: fgDimmer}}>{c.duration.toFixed(1)}s</div>
              </div>
              );
            })}
          </div>
        </Track>
        <Track icon={Icons.music} label={<B zh="BGM" en="Music" sep=" · "/>} color="#c084fc">
          <div style={{height: '100%', background: 'linear-gradient(90deg, rgba(192,132,252,0.15), rgba(192,132,252,0.1))', border: '1px solid rgba(192,132,252,0.25)', borderRadius: 6, padding: '4px 8px', position: 'relative', overflow: 'hidden'}}>
            <div style={{fontSize: 10, color: '#c084fc', fontWeight: 500, letterSpacing: '-0.01em'}}>Orbital Dread · v2</div>
            {/* Waveform */}
            <svg style={{position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%'}} preserveAspectRatio="none" viewBox="0 0 300 40">
              {Array.from({length: 150}).map((_, i) => {
                const h = Math.abs(Math.sin(i * 0.3) * Math.cos(i * 0.15)) * 20 + 2;
                return <rect key={i} x={i*2} y={20 - h/2} width="1" height={h} fill="#c084fc" opacity="0.5"/>;
              })}
            </svg>
          </div>
        </Track>
        <Track icon={Icons.mic} label={<B zh="旁白" en="VO" sep=" · "/>} color="#7dd3fc">
          <div style={{height: '100%', display: 'flex', paddingLeft: '5%'}}>
            <div style={{width: '82%', height: '100%', background: 'rgba(125,211,252,0.12)', border: '1px solid rgba(125,211,252,0.25)', borderRadius: 6, padding: '4px 8px', position: 'relative', overflow: 'hidden'}}>
              <div style={{fontSize: 10, color: '#7dd3fc', fontWeight: 500}}>女声 · 低语 · -8dB</div>
              <svg style={{position: 'absolute', bottom: 0, left: 0, right: 0, height: '60%'}} preserveAspectRatio="none" viewBox="0 0 300 40">
                {Array.from({length: 120}).map((_, i) => {
                  const h = Math.abs(Math.sin(i * 0.5 + 1) * Math.cos(i * 0.2)) * 16 + 1;
                  return <rect key={i} x={i*2.5} y={20 - h/2} width="1.2" height={h} fill="#7dd3fc" opacity="0.6"/>;
                })}
              </svg>
            </div>
          </div>
        </Track>
        <Track icon={Icons.doc} label={<B zh="字幕" en="Subs" sep=" · "/>} color="var(--text-dim)" compact>
          <div style={{display: 'flex', gap: 2, height: '100%'}}>
            {['静默之上','战火将至','月升时分','一切开始','向着地球','发起反击','残骸漂浮','归家'].map((s, i) => (
              <div key={i} style={{flex: 1, height: '100%', background: 'var(--glass-hi)', border: '1px solid var(--glass-border)', borderRadius: 4, padding: '2px 6px', fontSize: 10, color: 'var(--text)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis'}}>{s}</div>
            ))}
          </div>
        </Track>
      </div>
    </div>
  );
}

function Track({ icon, label, color, children, compact }) {
  return (
    <div style={{display: 'flex', borderBottom: '1px solid var(--divider)', minHeight: compact ? 32 : 54}}>
      <div style={{width: 110, flexShrink: 0, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8, borderRight: '1px solid var(--divider)', background: 'var(--surface-0)'}}>
        <span style={{color, display: 'grid', placeItems: 'center'}}><Icon d={icon} size={13}/></span>
        <span style={{fontSize: 11, fontWeight: 500, color: 'var(--text-dim)'}}>{label}</span>
      </div>
      <div style={{flex: 1, padding: 6, position: 'relative', overflow: 'hidden'}}>{children}</div>
      <div style={{width: 40, flexShrink: 0, padding: '6px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, borderLeft: '1px solid var(--divider)', background: 'var(--surface-0)'}}>
        <div style={{width: 22, height: 3, background: 'var(--glass-hi)', borderRadius: 2, position: 'relative'}}>
          <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: '70%', background: color, borderRadius: 2}}/>
        </div>
        <span style={{fontSize: 8, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dimmer)'}}>M S</span>
      </div>
    </div>
  );
}

// ========== ASSET SIDEBAR ==========
function AssetSidebar() {
  const [activeGroup, setActiveGroup] = useState('CLIPS');
  return (
    <div style={{gridArea: 'aside', display: 'flex', flexDirection: 'column', overflow: 'hidden'}} className="glass">
      {/* Header */}
      <div style={{padding: '14px 14px 10px', borderBottom: '1px solid var(--divider)'}}>
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10}}>
          <div className="font-editorial" style={{fontSize: 18, fontStyle: 'italic', letterSpacing: '-0.015em'}}>Assets</div>
          <IconButton tip="Upload" size={26}><Icon d={Icons.plus} size={14}/></IconButton>
        </div>
        <div style={{display: 'flex', gap: 4, overflowX: 'auto'}}>
          {mockAssets.map(g => (
            <button key={g.group} onClick={() => setActiveGroup(g.group)} style={{
              padding: '4px 10px', fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
              letterSpacing: '0.06em', fontWeight: 500,
              background: activeGroup === g.group ? 'var(--accent-glow)' : 'transparent',
              border: `1px solid ${activeGroup === g.group ? 'var(--accent)' : 'var(--glass-border)'}`,
              color: activeGroup === g.group ? 'var(--accent-hi)' : 'var(--text-dim)',
              borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
            }}>{g.group} · {g.count}</button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div style={{flex: 1, overflowY: 'auto', padding: 12}}>
        <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8}}>
          {mockClips.slice(0, 8).map((c, i) => {
            const isLight = document.documentElement.getAttribute('data-theme') === 'light';
            const bg = isLight
              ? `linear-gradient(145deg, hsl(${c.hue}, 40%, 82%), hsl(${c.hue+30}, 35%, 68%))`
              : `linear-gradient(145deg, hsl(${c.hue}, 40%, 25%), hsl(${c.hue+30}, 30%, 12%))`;
            const chipBg = isLight ? 'rgba(15,24,34,0.6)' : 'rgba(0,0,0,0.4)';
            const labelBg = isLight
              ? 'linear-gradient(180deg, transparent, rgba(15,24,34,0.6))'
              : 'linear-gradient(180deg, transparent, rgba(0,0,0,0.8))';
            return (
            <div key={c.id} style={{
              position: 'relative', aspectRatio: '9/16', borderRadius: 8,
              background: bg,
              border: i === 2 ? '1.5px solid var(--accent)' : '1px solid var(--glass-border)',
              overflow: 'hidden', cursor: 'pointer',
              boxShadow: i === 2 ? '0 0 16px var(--accent-glow)' : 'none',
            }}>
              {i === 2 && (
                <div style={{position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'grid', placeItems: 'center', zIndex: 2}}>
                  <div style={{width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin 1s linear infinite'}}/>
                </div>
              )}
              <div style={{position: 'absolute', top: 6, left: 6, fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: 'rgba(255,255,255,0.9)', background: chipBg, padding: '1px 5px', borderRadius: 3}}>
                {c.idx.toString().padStart(2,'0')}
              </div>
              <div style={{position: 'absolute', bottom: 0, left: 0, right: 0, padding: 6, background: labelBg}}>
                <div style={{fontSize: 10, color: 'white', fontWeight: 500, letterSpacing: '-0.01em'}}>{c.label}</div>
                <div style={{fontSize: 8, color: 'rgba(255,255,255,0.7)', fontFamily: 'JetBrains Mono, monospace', marginTop: 1}}>{c.duration.toFixed(1)}s · {i === 2 ? 'GEN…' : 'FINAL'}</div>
              </div>
            </div>
            );
          })}
        </div>

        {/* Recent activity */}
        <div style={{marginTop: 18}}>
          <div style={{fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dimmer)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8}}>Recent</div>
          {[
            {t: '14:34', e: 'image2video · clip-05', s: 'done'},
            {t: '14:33', e: 'image2video · clip-04', s: 'done'},
            {t: '14:32', e: 'prompt rewrite (safety)', s: 'warn'},
          ].map((a, i) => (
            <div key={i} style={{display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', fontSize: 11, borderBottom: '1px solid var(--divider)'}}>
              <span style={{fontFamily: 'JetBrains Mono, monospace', color: 'var(--text-dimmer)', fontSize: 10}}>{a.t}</span>
              <span style={{flex: 1, color: 'var(--text-dim)'}}>{a.e}</span>
              <StatusDot status={a.s === 'done' ? 'done' : 'running'}/>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ========== MAIN APP ==========
function App() {
  const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakToggle } = window;
  const [tweaks, setTweak] = useTweaks(/*EDITMODE-BEGIN*/{
    "theme": "dark",
    "accent": "steel",
    "density": "balanced",
    "glassIntensity": "normal"
  }/*EDITMODE-END*/);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tweaks.theme);
    document.documentElement.setAttribute('data-accent', tweaks.accent);
  }, [tweaks.theme, tweaks.accent]);

  return (
    <>
      <div className="studio-shell">
        <TopBar onToggleTheme={() => setTweak('theme', tweaks.theme === 'dark' ? 'light' : 'dark')} theme={tweaks.theme}/>
        <div style={{gridArea: 'rail'}}>
          <PipelineRail/>
        </div>
        <ChatPanel/>
        <Preview/>
        <Timeline/>
        <AssetSidebar/>
      </div>

      <TweaksPanel>
        <TweakSection title="主题 / Theme">
          <TweakRadio label="Mode" value={tweaks.theme} onChange={v => setTweak('theme', v)} options={[{value:'dark',label:'Dark'},{value:'light',label:'Light'}]}/>
          <TweakRadio label="Accent" value={tweaks.accent} onChange={v => setTweak('accent', v)} options={[
            {value:'steel',label:'Steel'},
            {value:'violet',label:'Violet'},
            {value:'cyan',label:'Cyan'},
            {value:'coral',label:'Coral'},
            {value:'lime',label:'Lime'},
          ]}/>
        </TweakSection>
      </TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
