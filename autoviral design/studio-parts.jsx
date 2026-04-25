// === Icons (thin-stroke, refined) ===
const Icon = ({ d, size = 16, stroke = 1.6, fill = "none", className = "" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className}>
    {typeof d === 'string' ? <path d={d}/> : d}
  </svg>
);

const Icons = {
  play: <><polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none"/></>,
  pause: <><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>,
  back: <><path d="M15 18l-6-6 6-6"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  sparkle: <><path d="M12 2l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/></>,
  wave: <><path d="M2 12c2-4 4-4 6 0s4 4 6 0 4-4 6 0"/></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></>,
  film: <><rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 3v18M17 3v18M2 8h5M2 16h5M17 8h5M17 16h5"/></>,
  mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3M8 21h8"/></>,
  music: <><path d="M9 18V6l12-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>,
  doc: <><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M13 2v7h7"/></>,
  send: <><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z"/></>,
  stop: <><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" stroke="none"/></>,
  attach: <><path d="M21 10l-9 9a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5L10 17a2 2 0 01-3-3l8-8"/></>,
  check: <><path d="M20 6L9 17l-5-5"/></>,
  more: <><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.65 1.65 0 00-1.8-.3 1.65 1.65 0 00-1 1.5V21a2 2 0 01-4 0v-.1a1.65 1.65 0 00-1-1.5 1.65 1.65 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.65 1.65 0 00.3-1.8 1.65 1.65 0 00-1.5-1H3a2 2 0 010-4h.1a1.65 1.65 0 001.5-1 1.65 1.65 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.65 1.65 0 001.8.3h.1a1.65 1.65 0 001-1.5V3a2 2 0 014 0v.1a1.65 1.65 0 001 1.5 1.65 1.65 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.65 1.65 0 00-.3 1.8v.1a1.65 1.65 0 001.5 1H21a2 2 0 010 4h-.1a1.65 1.65 0 00-1.5 1z"/></>,
  zoom_in: <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/></>,
  zoom_out: <><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/></>,
  scissors: <><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></>,
  download: <><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></>,
  gear: <><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></>,
  bot: <><rect x="3" y="8" width="18" height="12" rx="2"/><circle cx="9" cy="14" r="1.5"/><circle cx="15" cy="14" r="1.5"/><path d="M12 2v6M8 8h8"/></>,
  check_circle: <><circle cx="12" cy="12" r="10"/><path d="M9 12l2 2 4-4"/></>,
  volume: <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07M19.07 4.93a10 10 0 010 14.14"/></>,
  fullscreen: <><path d="M8 3H5a2 2 0 00-2 2v3M21 8V5a2 2 0 00-2-2h-3M3 16v3a2 2 0 002 2h3M16 21h3a2 2 0 002-2v-3"/></>,
  layers: <><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></>,
};

// === Bilingual label helper ===
const B = ({ zh, en, className = "", sep = " / " }) => (
  <span className={className}>{zh}<span style={{opacity: 0.5, fontWeight: 300}}>{sep}{en}</span></span>
);

// === Status pill ===
function StatusDot({ status, label }) {
  const map = {
    running: { color: 'var(--status-running)', glow: 'rgba(125,211,252,0.5)' },
    done: { color: 'var(--status-done)', glow: 'rgba(163,230,53,0.5)' },
    pending: { color: 'var(--status-pending)', glow: 'transparent' },
    error: { color: 'var(--status-error)', glow: 'rgba(249,112,102,0.5)' },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{display: 'inline-flex', alignItems: 'center', gap: 6}}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%',
        background: s.color,
        boxShadow: status === 'running' ? `0 0 12px 2px ${s.glow}` : 'none',
      }} className={status === 'running' ? 'pulse-dot' : ''}/>
      {label && <span style={{fontSize: 11, color: 'var(--text-dim)', letterSpacing: '0.04em', textTransform: 'uppercase'}}>{label}</span>}
    </span>
  );
}

// === Button primitives ===
function IconButton({ children, active, onClick, tip, size = 32 }) {
  return (
    <button onClick={onClick} title={tip} style={{
      width: size, height: size, display: 'grid', placeItems: 'center',
      background: active ? 'var(--accent-glow)' : 'transparent',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--glass-border)'}`,
      color: active ? 'var(--accent-hi)' : 'var(--text-dim)',
      borderRadius: 8, cursor: 'pointer',
      transition: 'all 0.18s ease',
    }}
    onMouseEnter={e => { if(!active){ e.currentTarget.style.background = 'var(--glass-hi)'; e.currentTarget.style.color = 'var(--text)'; }}}
    onMouseLeave={e => { if(!active){ e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-dim)'; }}}
    >{children}</button>
  );
}

function PrimaryButton({ children, onClick, icon }) {
  return (
    <button onClick={onClick} style={{
      padding: '9px 16px', display: 'inline-flex', alignItems: 'center', gap: 8,
      background: 'linear-gradient(180deg, var(--accent-hi), var(--accent))',
      color: 'var(--accent-fg)', border: '1px solid var(--accent-hi)',
      borderRadius: 10, fontSize: 13, fontWeight: 600, letterSpacing: '-0.01em',
      cursor: 'pointer', boxShadow: '0 4px 16px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.5)',
      transition: 'transform 0.15s ease',
    }}
    onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
    onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
    >{icon}{children}</button>
  );
}

// === Mock data ===
const mockWork = {
  title: '月球大战 · 开场蒙太奇',
  titleEn: 'Lunar War · Opening Montage',
  type: 'short-video',
  category: 'scifi',
  duration: 38,
  createdAt: '2026-04-24 14:22',
};

const mockPipeline = [
  { id: 'research', zh: '话题调研', en: 'Research', status: 'done', duration: '2m 14s' },
  { id: 'plan', zh: '分镜规划', en: 'Storyboard', status: 'done', duration: '4m 08s' },
  { id: 'assets', zh: '素材生成', en: 'Assets', status: 'running', duration: '5m 32s' },
  { id: 'assembly', zh: '视频合成', en: 'Assembly', status: 'pending', duration: '—' },
];

const mockClips = Array.from({length: 8}, (_, i) => ({
  id: `clip-${i}`,
  idx: i + 1,
  duration: 4 + Math.random() * 3,
  label: ['月球升起','宇航员特写','地球爆炸','飞船编队','指挥室','激光对射','残骸漂浮','归家'][i],
  labelEn: ['Moonrise','Astronaut CU','Earth Blast','Fleet','Command','Laser','Debris','Return'][i],
  hue: 200 + i * 18,
}));

const mockAudioTracks = [
  { id: 'bgm', type: 'bgm', name: 'Orbital Dread · v2', duration: 38 },
  { id: 'vo', type: 'voiceover', name: '旁白 · 女声 · 低语', duration: 36, offset: 2 },
];

const mockAssets = [
  { group: 'CLIPS', zh: '分镜视频', en: 'Scene Clips', count: 8, items: [
    { name: 'clip-01-moonrise.mp4', size: '12.4 MB', stage: '成品', tag: 'final' },
    { name: 'clip-02-astronaut.mp4', size: '8.9 MB', stage: '成品', tag: 'final' },
    { name: 'clip-03-earth-blast.mp4', size: '14.1 MB', stage: '生成中', tag: 'pending' },
  ]},
  { group: 'IMAGES', zh: '首帧图片', en: 'Key Frames', count: 24, items: [
    { name: 'keyframe-01.png', size: '2.1 MB', stage: '首帧', tag: 'final' },
    { name: 'keyframe-02.png', size: '1.8 MB', stage: '首帧', tag: 'final' },
  ]},
  { group: 'AUDIO', zh: '音频素材', en: 'Audio', count: 3, items: [
    { name: 'orbital-dread-v2.mp3', size: '3.2 MB', stage: 'BGM', tag: 'final' },
    { name: 'vo-narrator.wav', size: '4.8 MB', stage: '旁白', tag: 'final' },
  ]},
  { group: 'DOCS', zh: '文稿文档', en: 'Docs', count: 2, items: [
    { name: 'storyboard.md', size: '12 KB', stage: '分镜', tag: 'final' },
    { name: 'publish-text.md', size: '4 KB', stage: '文案', tag: 'final' },
  ]},
];

const mockChat = [
  { role: 'system', time: '14:22', text: '作品已创建。开始话题调研 →' },
  { role: 'user', time: '14:22', text: '帮我做一个科幻短片，主题是"月球大战"，希望有冷峻的未来感' },
  { role: 'assistant', time: '14:23', tool: 'web_research', text: '正在检索相关视觉参考……找到 12 个高匹配度案例：《2001: 太空漫游》《沙丘》《星际穿越》。建议参考 Denis Villeneuve 的冷峻构图。' },
  { role: 'assistant', time: '14:26', tool: 'storyboard', text: '已完成 8 个分镜的规划。整片 38 秒，采用慢拉近 + 局部爆点的节奏。' },
  { role: 'assistant', time: '14:31', tool: 'image_gen', text: '首帧生成：8/8 完成 ✓' },
  { role: 'assistant', time: '14:34', tool: 'image2video', text: '生成视频片段中…… 5/8 完成。clip-03 (地球爆炸) 触发内容审核，正在改写 prompt 并重试。', state: 'running' },
];

Object.assign(window, { Icon, Icons, B, StatusDot, IconButton, PrimaryButton, mockWork, mockPipeline, mockClips, mockAudioTracks, mockAssets, mockChat });
