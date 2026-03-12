// main.js — application controller

// ── State ─────────────────────────────────────────────
const State = {
  segments:    [],
  currentSeg:  0,
  isPlaying:   false,
  playTimer:   null,
  maxForce:    1,
  diameter:    10,
  gcodeFile:   null,
};

// ── Init ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  Scene.init();
  setStatus('ready', 'READY');

  // File input listener
  document.getElementById('gcode-file').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    State.gcodeFile = file;
    setStatus('ready', file.name.toUpperCase());
    document.getElementById('run-btn').disabled = false;
  });
});

// ── Run simulation ────────────────────────────────────
async function runSimulation() {
  if (!State.gcodeFile) {
    alert('Please upload a G-code file first.');
    return;
  }

  setStatus('running', 'SIMULATING...');
  document.getElementById('run-btn').disabled = true;

  const params = {
    diameter:      parseFloat(document.getElementById('param-diameter').value),
    num_flutes:    parseInt(document.getElementById('param-flutes').value),
    helix_angle:   30,
    stock_x:       parseFloat(document.getElementById('param-stock-x').value),
    stock_y:       parseFloat(document.getElementById('param-stock-y').value),
    stock_z:       parseFloat(document.getElementById('param-stock-z').value),
    material_key:  document.getElementById('param-material').value,
    warning_force: 200,
    critical_force: 400,
  };

  try {
    const result = await Api.simulate(State.gcodeFile, params);

    // Store state
    State.segments   = result.segments;
    State.maxForce   = result.summary.max_force_N;
    State.diameter   = params.diameter;
    State.currentSeg = 0;

    // Build 3D scene
    Scene.buildFromSimulation(result.segments, params.diameter, {
      x: params.stock_x,
      y: params.stock_y,
      z: params.stock_z,
    });

    // Update summary panel
    updateSummary(result.summary);

    // Build segment dots
    buildSegmentDots(result.segments);

    // Go to first segment
    goToSegment(0);

    setStatus('ready', 'COMPLETE');
    document.getElementById('run-btn').disabled = false;

  } catch (err) {
    console.error(err);
    setStatus('error', 'ERROR: ' + err.message);
    document.getElementById('run-btn').disabled = false;
  }
}

// ── Segment navigation ────────────────────────────────
function goToSegment(index) {
  if (!State.segments.length) return;
  index = Math.max(0, Math.min(index, State.segments.length - 1));
  State.currentSeg = index;

  const seg = State.segments[index];

  // 3D scene
  Scene.goToSegment(seg);
  Scene._isPlaying = State.isPlaying;

  // Chip SVG
  Chip.update(seg, State.diameter, State.maxForce);

  // Force bars
  updateForceBars(seg);

  // Overlays
  updateOverlays(seg);

  // Spindle stats
  updateSpindleStats(seg);

  // Timeline
  updateTimeline(index);

  // Alert banner
  updateAlert(seg);
}

// ── Force bars ────────────────────────────────────────
function updateForceBars(seg) {
  const max = State.maxForce;

  setBar('fc', seg.fc,             max, seg);
  setBar('fy', seg.fy,             max, seg);
  setBar('fz', seg.fz_force,       max, seg);
  setBar('fm', seg.force_magnitude,max, seg);
}

function setBar(id, value, max, seg) {
  const pct  = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const fill = document.getElementById(`bar-${id}`);
  const val  = document.getElementById(`val-${id}`);
  const ico  = document.getElementById(`ico-${id}`);

  if (!fill || !val) return;

  // Color based on force level
  let color, textColor, icon;
  if (seg.force_critical) {
    color = `linear-gradient(90deg, #ff174488, #ff1744)`;
    textColor = '#ff1744';
    icon = '🔴';
  } else if (seg.force_warning) {
    color = `linear-gradient(90deg, #ffb30088, #ffb300)`;
    textColor = '#ffb300';
    icon = '⚠';
  } else if (seg.is_cutting) {
    color = `linear-gradient(90deg, #00e67688, #00e676)`;
    textColor = '#00e676';
    icon = '✓';
  } else {
    color = `linear-gradient(90deg, #2a2a4588, #2a2a45)`;
    textColor = 'var(--text-dim)';
    icon = '—';
  }

  fill.style.width      = `${pct}%`;
  fill.style.background = color;
  fill.style.boxShadow  = pct > 0
    ? `2px 0 8px ${seg.force_critical ? '#ff174488' : seg.force_warning ? '#ffb30088' : '#00e67688'}`
    : 'none';

  val.textContent = value > 0 ? `${value.toFixed(0)}N` : '—';
  val.style.color = textColor;
  if (ico) ico.textContent = icon;
}

// ── Overlays ──────────────────────────────────────────
function updateOverlays(seg) {
  // Top left
  const segInfo = document.getElementById('ol-seg');
  if (segInfo) {
    segInfo.textContent =
      `SEG ${String(seg.segment_index + 1).padStart(2,'0')} / ${State.segments.length}`;
  }

  const pos = document.getElementById('ol-pos');
  if (pos) {
    pos.textContent =
      `X: ${seg.x_end.toFixed(2)}  Y: ${seg.y_end.toFixed(2)}  Z: ${seg.z_end.toFixed(2)}`;
  }

  const feed = document.getElementById('ol-feed');
  if (feed) {
    feed.textContent = seg.is_cutting
      ? `F: ${seg.feed_rate.toFixed(0)} mm/min  S: ${seg.spindle_rpm.toFixed(0)} RPM`
      : 'RAPID';
  }

  const warn = document.getElementById('ol-warn');
  if (warn) {
    warn.textContent = seg.force_critical
      ? '🔴 CRITICAL FORCE'
      : seg.force_warning
      ? '⚠ WARNING FORCE'
      : '';
  }

  // Top right
  const mode = document.getElementById('ol-mode');
  if (mode) {
    mode.textContent = seg.is_cutting ? 'CUTTING' : 'RAPID';
    mode.style.color = seg.is_cutting ? 'var(--accent)' : 'var(--text-dim)';
  }

  const apEl = document.getElementById('ol-ap');
  if (apEl) apEl.textContent = `ap: ${seg.ap.toFixed(2)}mm`;

  const aeEl = document.getElementById('ol-ae');
  if (aeEl) aeEl.textContent = `ae: ${seg.ae.toFixed(2)}mm`;

  const fzEl = document.getElementById('ol-fz');
  if (fzEl) fzEl.textContent = seg.fz > 0
    ? `fz: ${seg.fz.toFixed(4)} mm/tooth`
    : 'fz: —';
}

// ── Spindle stats ─────────────────────────────────────
function updateSpindleStats(seg) {
  const powerCls  = seg.power  > 3   ? 'hot'  : seg.power  > 1.5 ? 'warn' : 'good';
  const torqueCls = seg.torque > 5   ? 'hot'  : seg.torque > 2.5 ? 'warn' : '';
  const tempEst   = Chip.estimateTemp(seg, State.maxForce);
  const tempCls   = tempEst   > 400  ? 'hot'  : tempEst   > 250  ? 'warn' : 'good';

  _setSysVal('sv-power',  seg.power  > 0 ? `${seg.power.toFixed(2)} kW`  : '—', powerCls);
  _setSysVal('sv-torque', seg.torque > 0 ? `${seg.torque.toFixed(2)} Nm` : '—', torqueCls);
  _setSysVal('sv-temp',   seg.is_cutting ? `${tempEst}°C` : '—', tempCls);
  _setSysVal('sv-rpm',    seg.spindle_rpm > 0 ? seg.spindle_rpm.toFixed(0) : '—', '');
}

function _setSysVal(id, value, cls) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value;
  el.className   = `sys-value ${cls}`;
}

// ── Summary panel ─────────────────────────────────────
function updateSummary(summary) {
  document.getElementById('sum-segs').textContent = summary.total_segments;
  document.getElementById('sum-cut').textContent  = summary.cutting_segments;
  document.getElementById('sum-len').textContent  = summary.total_length_mm.toFixed(1);
  document.getElementById('sum-fmax').textContent = ` ${summary.max_force_N.toFixed(1)}`;
  document.getElementById('sum-warn').textContent = summary.warning_segments;
  document.getElementById('sum-crit').textContent = summary.critical_segments;
}

// ── Timeline ──────────────────────────────────────────
function buildSegmentDots(segments) {
  const container = document.getElementById('seg-dots');
  container.innerHTML = '';

  segments.forEach((seg, i) => {
    const dot = document.createElement('div');
    dot.className = 'seg-dot ' + segClass(seg);
    dot.title     = `Seg ${i + 1} — ${seg.is_cutting
      ? `Fc=${seg.fc.toFixed(0)}N` : 'RAPID'}`;
    dot.onclick   = () => {
      stopPlay();
      goToSegment(i);
    };
    container.appendChild(dot);
  });

  // Legend
  const legend = document.createElement('span');
  legend.className = 'dot-legend';
  legend.style.marginLeft = '8px';
  legend.innerHTML =
    `<span style="color:var(--green)">● SAFE</span> &nbsp;` +
    `<span style="color:var(--amber)">● WARN</span> &nbsp;` +
    `<span style="color:var(--red)">● CRIT</span> &nbsp;` +
    `<span style="color:var(--border2)">● RAPID</span>`;
  container.appendChild(legend);
}

function updateTimeline(index) {
  const total = State.segments.length;

  // Progress bar
  const pct  = total > 1 ? (index / (total - 1)) * 100 : 0;
  const fill = document.getElementById('progress-fill');
  if (fill) fill.style.width = `${pct}%`;

  // Counter
  const counter = document.getElementById('seg-counter');
  if (counter) counter.textContent = `${index + 1} / ${total}`;

  // Dot highlight
  const dots = document.querySelectorAll('.seg-dot');
  dots.forEach((d, i) => {
    d.classList.toggle('current', i === index);
  });
}

// ── Alert banner ──────────────────────────────────────
function updateAlert(seg) {
  const banner = document.getElementById('alert-banner');
  const text   = document.getElementById('alert-text');
  if (!banner) return;

  if (seg.force_critical) {
    text.textContent =
      `CRITICAL FORCE — SEGMENT ${seg.segment_index + 1} — ${seg.fc.toFixed(0)}N`;
    banner.classList.add('visible');
    setTimeout(() => banner.classList.remove('visible'), 3000);
  }
}

// ── Playback controls ─────────────────────────────────
function togglePlay() {
  if (State.isPlaying) {
    stopPlay();
  } else {
    startPlay();
  }
}

function startPlay() {
  if (!State.segments.length) return;
  State.isPlaying    = true;
  Scene._isPlaying   = true;
  const btn          = document.getElementById('play-btn');
  if (btn) {
    btn.textContent       = '⏸';
    btn.style.borderColor = 'var(--amber)';
    btn.style.color       = 'var(--amber)';
    btn.style.background  = 'var(--amber)22';
  }
  scheduleNext();
}

function stopPlay() {
  State.isPlaying  = false;
  Scene._isPlaying = false;
  if (State.playTimer) clearTimeout(State.playTimer);
  const btn = document.getElementById('play-btn');
  if (btn) {
    btn.textContent       = '▶';
    btn.style.borderColor = 'var(--accent)';
    btn.style.color       = 'var(--accent)';
    btn.style.background  = 'var(--accent)22';
  }
}

function scheduleNext() {
  if (!State.isPlaying) return;
  const delay = parseInt(document.getElementById('speed-select').value);
  State.playTimer = setTimeout(() => {
    if (State.currentSeg < State.segments.length - 1) {
      goToSegment(State.currentSeg + 1);
      scheduleNext();
    } else {
      stopPlay();
    }
  }, delay);
}

function stepForward(n = 1) {
  stopPlay();
  goToSegment(State.currentSeg + n);
}

function stepBack(n = 1) {
  stopPlay();
  goToSegment(State.currentSeg - n);
}

function resetSim() {
  stopPlay();
  goToSegment(0);
}

function seekClick(e) {
  if (!State.segments.length) return;
  const track = e.currentTarget;
  const rect  = track.getBoundingClientRect();
  const pct   = (e.clientX - rect.left) / rect.width;
  const index = Math.round(pct * (State.segments.length - 1));
  stopPlay();
  goToSegment(index);
}

// ── Helpers ───────────────────────────────────────────
function segClass(seg) {
  if (!seg.is_cutting)     return 'rapid';
  if (seg.force_critical)  return 'critical';
  if (seg.force_warning)   return 'warning';
  return 'safe';
}

function setStatus(type, text) {
  const dot  = document.getElementById('status-dot');
  const span = document.getElementById('status-text');
  if (dot)  dot.className  = `status-dot ${type}`;
  if (span) span.textContent = text;
}