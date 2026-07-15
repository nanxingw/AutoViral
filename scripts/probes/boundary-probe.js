/* boundary-probe.js — Studio 预览硬切边界保真插桩探针 (PRD-0016 S1 红基线夹具).
 *
 * 这是一段可整段注入的浏览器探针源码（`javascript_tool` 里把本文件内容原样贴入执行，
 * 或在 DevTools console 里粘贴）。它只观测、不断言——判定交给 window.__probeSummary()。
 *
 * 用途：给 12×4s 硬切夹具 work 的预览播放做"跨切点单调性"取证：
 *   ① waiting/stalled 事件计数（切点冷挂载把新 <video> 抬成全局 buffering block 的直接症状）
 *   ② 同元素 currentTime 负跳（>0.05s）清单（被拽回帧钟时间 = 用户看到的"回放 0.x 秒"）
 *   ③ 帧钟单调性（master frame clock 从 DOM 时码解析，永不后退 = monotonic）
 *   ④ mount→canplay 延迟分布
 * 附 rAF 心跳门控（window.__probe.rafRate）——遮挡 tab 的 rAF 节流会诱发与 bug 同形的假负跳
 * （见 docs/issues/032 诊断陷阱），所以判定前必须先读 rafRate ≥30。
 *
 * 暴露的全局：
 *   window.__probe          — 全部原始状态（events / backwardJumps / clockSamples / rafHistory / rounds …）
 *   window.__probeDrive     — { seek(sec), play(), pause(), mute(), unmute(), masterSec(), duration() }
 *   window.__probeRun(opts) — 自动跑 N 轮 seek→play→pause 直到累计跨界 ≥ targetCrossings，返回 Promise
 *   window.__probeReset(tag)— 清空采样但保留媒体 hook（用于 muted/unmuted 两跑之间分段）
 *   window.__probeSummary() — 结构化判据汇总
 *
 * 驱动策略（全脚本化，无需真鼠标；首次 play 需一次真实用户手势解锁 AudioContext）：
 *   - seek：对 [data-testid="preview-scrubber"] 派发合成 pointerdown（临时 no-op 掉
 *     setPointerCapture 以防合成指针抛 NotFoundError），Scrubber 内部 onSeek→requestSeekFrame。
 *   - play/pause：派发 window CustomEvent 'autoviral:ui-play' / 'autoviral:ui-pause'
 *     （PreviewPanel 里 useBridgeEvents 的既有 hook，等价于 agent `autoviral play`）。
 *   - mute/unmute：点 aria-label="Mute"/"Unmute" 的真按钮（驱动 Remotion playerRef.mute()——
 *     这才影响 use-playback.js 的 buffering-freeze 决策；单独设 el.muted 不改 Remotion 内部 mediaMuted）。
 */
(function installBoundaryProbe() {
  // ---- 幂等重装：清掉上一次的 intervals / observer / rAF ----
  if (typeof window.__probe !== "undefined" && window.__probe.__installed) {
    const p = window.__probe;
    try { clearInterval(p.__poll); } catch (e) {}
    try { clearInterval(p.__clockPoll); } catch (e) {}
    try { cancelAnimationFrame(p.__raf); } catch (e) {}
    try { p.__mo && p.__mo.disconnect(); } catch (e) {}
  }

  const START = performance.now();
  const now = () => performance.now() - START;

  const state = {
    __installed: true,
    startedAt: new Date().toISOString(),
    START,
    rafRate: 0, // 最近 ~1s 的 rAF 帧数
    rafHistory: [], // [{t, rate}]
    events: [], // [{t, type, kind, src, ct, rs}]
    mediaSet: new Map(), // el -> meta
    backwardJumps: [], // [{src, kind, from, to, dropMs, atMs, round}]
    mountToCanplayMs: [], // [ms]
    clockSamples: [], // [{t, sec, playing, raf, sinceSeek}]
    clockFreezes: [], // 派生：帧钟冻结区间
    rounds: [], // [{idx, from, to, crossings, startT, endT}]
    seeking: new Set(),
    lastSeekAt: -1e9,
    __playing: false,
    __curRound: 0,
    __midCounter: 1,
    config: {
      backJumpThresh: 0.05, // 负跳判定阈（秒）
      boundaries: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44], // 12×4s 夹具切点
      seekGuardMs: 450, // seek 后这段窗内的 ct 变化不算负跳
    },
  };
  window.__probe = state;

  // ---------- 工具 ----------
  function shortSrc(el) {
    try {
      const s = el.currentSrc || el.getAttribute("src") || "";
      const tail = s.split("/").slice(-1)[0] || s;
      return (tail || "(empty)").slice(0, 44);
    } catch (e) {
      return "(err)";
    }
  }
  const kindOf = (el) => el.tagName.toLowerCase();
  // Player 的 clip <video> 带 `#t=start,end` 媒体分片；timeline filmstrip 抽帧 <video>
  // 不带分片、且从不 play 只 seek。据此把"预览 Player 媒体"与"filmstrip 噪声"分开。
  function hasFragment(el) {
    try { return /#t=/.test(el.currentSrc || el.getAttribute("src") || ""); } catch (e) { return false; }
  }

  function logEvent(el, type) {
    const m = state.mediaSet.get(el);
    const rec = {
      t: Math.round(now()),
      type,
      kind: kindOf(el),
      src: shortSrc(el),
      ct: +(el.currentTime || 0).toFixed(3),
      rs: el.readyState,
      paused: el.paused,
      mid: m ? m.id : null,
    };
    state.events.push(rec);
    if (state.events.length > 8000) state.events.splice(0, 2000);
    if (type === "seeking") state.seeking.add(el);
    if (type === "seeked") state.seeking.delete(el);
    // everPlaying = 真的被播过（Player 活动 clip video + BGM/VO/sourceAudio）——
    // filmstrip 抽帧 <video> 从不触发 playing，是最干净的"是否 Player 媒体"判别。
    if (type === "playing" && m) m.everPlaying = true;
    if (type === "canplay" || type === "canplaythrough") {
      if (m && m.canplayAt == null) {
        m.canplayAt = now();
        m.mountToCanplayMs = Math.round(m.canplayAt - m.mountedAt);
        // 只把 Player 媒体（分片视频 / 曾 play 的音频）计入 mount→canplay 分布，
        // 避免 200+ filmstrip 抽帧元素淹没切点冷挂载的真实代价。
        if (m.isFragment || m.everPlaying) state.mountToCanplayMs.push(m.mountToCanplayMs);
        m.__allMountToCanplayMs = m.mountToCanplayMs;
      }
    }
    return rec;
  }

  const MEDIA_EVENTS = [
    "loadstart", "loadedmetadata", "canplay", "canplaythrough",
    "playing", "play", "pause", "waiting", "stalled",
    "seeking", "seeked", "ended", "emptied", "suspend",
  ];

  function track(el) {
    if (state.mediaSet.has(el)) return;
    const meta = {
      id: state.__midCounter++,
      src: shortSrc(el),
      kind: kindOf(el),
      isFragment: hasFragment(el), // Player clip video (#t=…) vs filmstrip 抽帧
      everPlaying: false,
      mountedAt: now(),
      canplayAt: null,
      mountToCanplayMs: null,
      lastCt: +(el.currentTime || 0),
      lastCtAt: now(),
      removedAt: null,
    };
    state.mediaSet.set(el, meta);
    const handlers = {};
    MEDIA_EVENTS.forEach((ev) => {
      const h = () => logEvent(el, ev);
      handlers[ev] = h;
      el.addEventListener(ev, h, { passive: true });
    });
    meta.__handlers = handlers;
    // 注入时已 ready 的元素记 0 延迟（只 Player 媒体计入分布）
    if (el.readyState >= 3) {
      meta.canplayAt = meta.mountedAt;
      meta.mountToCanplayMs = 0;
      if (meta.isFragment) state.mountToCanplayMs.push(0);
    }
    logEvent(el, "mount");
  }

  function untrack(el) {
    const m = state.mediaSet.get(el);
    if (!m) return;
    logEvent(el, "unmount");
    m.removedAt = now();
    if (m.__handlers) {
      for (const ev in m.__handlers) {
        try { el.removeEventListener(ev, m.__handlers[ev]); } catch (e) {}
      }
    }
  }

  document.querySelectorAll("video,audio").forEach(track);

  const mo = new MutationObserver((muts) => {
    for (const mu of muts) {
      mu.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.matches && n.matches("video,audio")) track(n);
        n.querySelectorAll && n.querySelectorAll("video,audio").forEach(track);
      });
      mu.removedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.matches && n.matches("video,audio")) untrack(n);
        n.querySelectorAll && n.querySelectorAll("video,audio").forEach(untrack);
      });
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  state.__mo = mo;

  // ---------- 100ms poll：ct/rs/paused + 负跳检测 ----------
  state.__poll = setInterval(() => {
    const t = now();
    state.mediaSet.forEach((m, el) => {
      if (!el.isConnected) return;
      const ct = +(el.currentTime || 0);
      const dropped = m.lastCt - ct;
      const guarded = state.seeking.has(el) || el.seeking || t - state.lastSeekAt < state.config.seekGuardMs;
      // 只在**正在播放**的元素上判负跳 = 排除 filmstrip 抽帧（它们 paused、只 seek）。
      // 这正是 032 的"回放"症状：跑赢帧钟的活动媒体被拽回 shouldBeTime。
      if (dropped > state.config.backJumpThresh && !guarded && !el.paused) {
        state.backwardJumps.push({
          mid: m.id,
          src: m.src,
          kind: m.kind,
          player: !!m.everPlaying, // 曾 play 过（Player clip / BGM / VO），非 filmstrip
          from: +m.lastCt.toFixed(3),
          to: +ct.toFixed(3),
          dropMs: Math.round(dropped * 1000),
          atMs: Math.round(t),
          round: state.__curRound,
        });
      }
      m.lastCt = ct;
      m.lastCtAt = t;
    });
  }, 100);

  // ---------- rAF 心跳 ----------
  let rafCount = 0;
  let rafWindowStart = performance.now();
  function beat() {
    rafCount++;
    const p = performance.now();
    if (p - rafWindowStart >= 1000) {
      state.rafRate = Math.round((rafCount * 1000) / (p - rafWindowStart));
      state.rafHistory.push({ t: Math.round(now()), rate: state.rafRate });
      if (state.rafHistory.length > 3600) state.rafHistory.splice(0, 600);
      rafCount = 0;
      rafWindowStart = p;
    }
    state.__raf = requestAnimationFrame(beat);
  }
  state.__raf = requestAnimationFrame(beat);

  // ---------- master frame clock 采样（解析 DOM 时码） ----------
  function findTimecodeEl() {
    if (state.__tcEl && state.__tcEl.isConnected) return state.__tcEl;
    const divs = document.querySelectorAll("div");
    for (const d of divs) {
      const tx = (d.textContent || "").trim();
      if (/^FRAME \d\d:\d\d\.\d\d \/ \d\d:\d\d\.\d\d/.test(tx)) {
        state.__tcEl = d;
        return d;
      }
    }
    return null;
  }
  function parseTc(el) {
    const m = (el.textContent || "").trim().match(/^FRAME (\d\d):(\d\d\.\d\d) \/ (\d\d):(\d\d\.\d\d)/);
    if (!m) return null;
    return { cur: +m[1] * 60 + +m[2], dur: +m[3] * 60 + +m[4] };
  }
  state.__clockPoll = setInterval(() => {
    const el = findTimecodeEl();
    if (!el) return;
    const p = parseTc(el);
    if (!p) return;
    state.__duration = p.dur;
    state.clockSamples.push({
      t: Math.round(now()),
      sec: +p.cur.toFixed(2),
      playing: !!state.__playing,
      raf: state.rafRate,
      sinceSeek: Math.round(now() - state.lastSeekAt),
    });
    if (state.clockSamples.length > 8000) state.clockSamples.splice(0, 2000);
  }, 100);

  // ---------- 驱动 ----------
  const drive = {};
  drive.duration = () => {
    const el = findTimecodeEl();
    if (el) {
      const p = parseTc(el);
      if (p) return p.dur;
    }
    return state.__duration || 48;
  };
  drive.masterSec = () => {
    const el = findTimecodeEl();
    if (el) {
      const p = parseTc(el);
      if (p) return p.cur;
    }
    return null;
  };
  drive.seek = function (sec) {
    const sc = document.querySelector('[data-testid="preview-scrubber"]');
    if (!sc) throw new Error("no scrubber ([data-testid=preview-scrubber])");
    const rect = sc.getBoundingClientRect();
    const dur = drive.duration();
    const p = Math.max(0, Math.min(1, sec / dur));
    const clientX = rect.left + p * rect.width;
    const clientY = rect.top + rect.height / 2;
    // 合成指针会让 Scrubber 内 setPointerCapture 抛 NotFoundError；临时 no-op 之。
    const origSPC = Element.prototype.setPointerCapture;
    Element.prototype.setPointerCapture = function () {};
    try {
      state.lastSeekAt = now();
      sc.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true, cancelable: true, clientX, clientY,
          pointerId: 1, pointerType: "mouse", button: 0, isPrimary: true,
        })
      );
    } finally {
      Element.prototype.setPointerCapture = origSPC;
    }
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX, clientY, pointerId: 1 }));
    return { requestedSec: sec, p: +p.toFixed(4), clientX: Math.round(clientX), dur };
  };
  drive.play = function () {
    state.__playing = true;
    window.dispatchEvent(new CustomEvent("autoviral:ui-play"));
  };
  drive.pause = function () {
    state.__playing = false;
    window.dispatchEvent(new CustomEvent("autoviral:ui-pause"));
  };
  function clickMute(wantMuted) {
    // 找当前存在的 Mute / Unmute 按钮（label 会随状态翻转）
    const wantLabel = wantMuted ? "Mute" : "Unmute";
    const btn = document.querySelector('[aria-label="' + wantLabel + '"]');
    if (btn) {
      btn.click();
      return { clicked: wantLabel, ariaPressed: btn.getAttribute("aria-pressed") };
    }
    return { clicked: null, note: "已处于目标态或未找到按钮" };
  }
  drive.mute = () => clickMute(true);
  drive.unmute = () => clickMute(false);
  window.__probeDrive = drive;

  // ---------- 自动跑 N 轮 ----------
  window.__probeRun = function (opts) {
    opts = opts || {};
    const startSec = opts.startSec != null ? opts.startSec : 3.2;
    const endSec = opts.endSec != null ? opts.endSec : 13.5;
    const targetCrossings = opts.targetCrossings != null ? opts.targetCrossings : 20;
    const maxRoundMs = opts.maxRoundMs != null ? opts.maxRoundMs : 14000;
    const maxRounds = opts.maxRounds != null ? opts.maxRounds : 40;
    const boundaries = state.config.boundaries;
    const crossingsInRange = (a, b) => boundaries.filter((x) => x > a && x <= b).length;
    return new Promise((resolve) => {
      let round = 0;
      let noAdvanceRounds = 0;
      function doRound() {
        round++;
        state.__curRound = round;
        drive.seek(startSec);
        setTimeout(() => {
          drive.play();
          const roundStart = now();
          let startedFrom = null;
          const tick = setInterval(() => {
            const ms = drive.masterSec();
            if (startedFrom == null && ms != null) startedFrom = ms;
            const elapsed = now() - roundStart;
            const reached = ms != null && ms >= endSec;
            if (reached || elapsed > maxRoundMs) {
              clearInterval(tick);
              drive.pause();
              const to = ms != null ? ms : endSec;
              const advanced = startedFrom != null && to - startedFrom > 0.3;
              if (!advanced) noAdvanceRounds++;
              const crossings = crossingsInRange(startSec, Math.min(to, endSec));
              state.rounds.push({
                idx: round,
                from: +startSec.toFixed(2),
                to: +to.toFixed(2),
                crossings,
                advanced,
                startT: Math.round(roundStart),
                endT: Math.round(now()),
              });
              const total = state.rounds.reduce((s, r) => s + r.crossings, 0);
              if (total >= targetCrossings) {
                resolve({ rounds: round, totalCrossings: total, needsGesture: noAdvanceRounds >= 2 });
              } else if (round >= maxRounds || noAdvanceRounds >= 3) {
                resolve({
                  rounds: round, totalCrossings: total, needsGesture: noAdvanceRounds >= 2,
                  aborted: true, reason: noAdvanceRounds >= 3 ? "clock-not-advancing (autoplay blocked? need real gesture)" : "maxRounds",
                });
              } else {
                setTimeout(doRound, 600);
              }
            }
          }, 100);
        }, 550);
      }
      doRound();
    });
  };

  // ---------- 分段清零（muted / unmuted 两跑之间） ----------
  window.__probeReset = function (tag) {
    state.events.length = 0;
    state.backwardJumps.length = 0;
    state.clockSamples.length = 0;
    state.clockFreezes = [];
    state.clockBackward = [];
    state.rounds.length = 0;
    state.mountToCanplayMs.length = 0;
    state.rafHistory.length = 0;
    state.__resetTag = tag || null;
    // 重置每元素 lastCt 基线，避免跨段误判负跳
    const t = now();
    state.mediaSet.forEach((m, el) => { m.lastCt = +(el.currentTime || 0); m.lastCtAt = t; });
    return "reset:" + (tag || "");
  };

  // ---------- 汇总判据 ----------
  window.__probeSummary = function () {
    const rafLatest = state.rafHistory.length ? state.rafHistory[state.rafHistory.length - 1].rate : state.rafRate;
    const healthy = state.rafHistory.filter((h) => h.rate >= 30).length;
    const rafRateOk = state.rafHistory.length === 0
      ? rafLatest >= 30
      : healthy >= Math.max(1, Math.ceil(state.rafHistory.length * 0.7));

    const eventCounts = state.events.reduce((a, e) => { a[e.type] = (a[e.type] || 0) + 1; return a; }, {});
    // Player 媒体 = 曾 play 过（filmstrip 抽帧从不 play）。据此把 waiting/stalled 从
    // filmstrip 噪声里剥离——切点 stall 断言只认 Player 媒体。
    const playerMids = new Set([...state.mediaSet.values()].filter((m) => m.everPlaying || m.isFragment).map((m) => m.id));
    const isPlayerEv = (e) => e.mid != null && playerMids.has(e.mid);
    const waitingAll = eventCounts.waiting || 0;
    const stalledAll = eventCounts.stalled || 0;
    const waitingCount = state.events.filter((e) => e.type === "waiting" && isPlayerEv(e)).length;
    const stalledCount = state.events.filter((e) => e.type === "stalled" && isPlayerEv(e)).length;
    const backwardJumpsPlayer = state.backwardJumps.filter((b) => b.player);

    // master frame clock：只在 playing 且离 seek 足够远的样本对上判定
    const clockBackward = [];
    const freezes = [];
    let freezeAccum = 0;
    let freezeStart = null;
    for (let i = 1; i < state.clockSamples.length; i++) {
      const a = state.clockSamples[i - 1];
      const b = state.clockSamples[i];
      const active = b.playing && b.sinceSeek > 450 && a.sinceSeek > 450;
      if (!active) { if (freezeAccum >= 300) freezes.push({ atSec: a.sec, durMs: freezeAccum, atMs: b.t }); freezeAccum = 0; freezeStart = null; continue; }
      const d = b.sec - a.sec;
      if (d < -0.05) clockBackward.push({ from: a.sec, to: b.sec, dropMs: Math.round(-d * 1000), atMs: b.t });
      if (Math.abs(d) < 0.005 && b.raf >= 30) {
        if (freezeStart == null) freezeStart = a.t;
        freezeAccum += b.t - a.t;
      } else {
        if (freezeAccum >= 300) freezes.push({ atSec: a.sec, durMs: freezeAccum, atMs: b.t });
        freezeAccum = 0; freezeStart = null;
      }
    }
    if (freezeAccum >= 300) freezes.push({ atSec: state.clockSamples.length ? state.clockSamples[state.clockSamples.length - 1].sec : null, durMs: freezeAccum });
    state.clockFreezes = freezes;
    state.clockBackward = clockBackward;

    const mc = state.mountToCanplayMs;
    const mcSorted = mc.slice().sort((x, y) => x - y);
    const pct = (q) => (mcSorted.length ? mcSorted[Math.min(mcSorted.length - 1, Math.floor(q * (mcSorted.length - 1)))] : null);

    return {
      resetTag: state.__resetTag || null,
      rafRateOk,
      rafRateLatest: rafLatest,
      rafRateMin: state.rafHistory.length ? Math.min.apply(null, state.rafHistory.map((h) => h.rate)) : null,
      rafSamples: state.rafHistory.length,
      waitingCount, // 仅 Player 媒体（切点 stall 断言①用这个）
      stalledCount,
      waitingAll, // 含 filmstrip 抽帧的原始计数（透明起见）
      stalledAll,
      backwardJumpCount: state.backwardJumps.length, // 已按 !paused 过滤（无 filmstrip）
      backwardJumpPlayerCount: backwardJumpsPlayer.length, // 且曾 play 过（回放断言②用这个）
      backwardJumps: state.backwardJumps.slice(0, 60),
      monotonicClock: clockBackward.length === 0,
      clockBackwardCount: clockBackward.length,
      clockBackward: clockBackward.slice(0, 40),
      clockFreezeCount: freezes.length,
      clockFreezes: freezes.slice(0, 40),
      mountToCanplayMs: mc.slice(0, 80),
      mountToCanplay: { n: mc.length, min: mcSorted[0] ?? null, p50: pct(0.5), p90: pct(0.9), max: mcSorted[mcSorted.length - 1] ?? null },
      rounds: state.rounds.length,
      totalCrossings: state.rounds.reduce((s, r) => s + r.crossings, 0),
      roundDetail: state.rounds.slice(),
      mediaTracked: state.mediaSet.size,
      playerMediaCount: playerMids.size, // Player clip video + BGM/VO（去 filmstrip）
      eventCounts,
    };
  };

  return "boundary-probe installed @ " + state.startedAt + " (rafRate=" + state.rafRate + ")";
})();
