// chip.js — updates the SVG chip views from simulation data

const Chip = {

  // Scale factor: mm → SVG pixels
  // Tool radius in SVG = 42px, so 1mm = 42 / (diameter/2)
  scale(diameter) {
    return 42 / (diameter / 2);
  },

  // Map force magnitude to chip color
  forceColor(seg, maxForce) {
    if (!seg.is_cutting) return { fill: 'url(#chipHeat)', stroke: '#ff9500' };
    const ratio = seg.force_magnitude / maxForce;
    if (seg.force_critical)      return { fill: '#4499ff', stroke: '#66bbff' }; // blue — burning
    if (seg.force_warning)       return { fill: 'url(#chipHeat)', stroke: '#ff9500' }; // amber
    if (ratio > 0.3)             return { fill: '#ffb30099', stroke: '#ffb300' }; // warm
    return { fill: '#aaaacc88', stroke: '#8888aa' }; // cool — silver
  },

  // Chip type badge text + class
  chipType(seg) {
    if (!seg.is_cutting || seg.force_magnitude === 0) {
      return { text: '— RAPID — NO CUT', cls: 'good' };
    }
    if (seg.force_critical) {
      return { text: '🔴 THICK — BLUE/WHITE — DANGER', cls: 'bad' };
    }
    if (seg.force_warning) {
      return { text: '⚠ CONTINUOUS — STRAW — WARM', cls: 'warn' };
    }
    return { text: '✓ CONTINUOUS — SILVER — GOOD', cls: 'good' };
  },

  // Estimated chip temperature from force ratio
  estimateTemp(seg, maxForce) {
    if (!seg.is_cutting) return 0;
    const ratio = seg.force_magnitude / maxForce;
    // Rough heuristic: 100°C base + up to 600°C at max force
    return Math.round(100 + ratio * 600);
  },

  // Build SVG crescent path from engagement geometry
  // Uses ae (radial depth) and tool diameter
  buildCrescentPath(seg, diameter) {
    const R  = 42; // tool radius in SVG px
    const ae = seg.ae;
    const D  = diameter;

    if (!seg.is_cutting || ae <= 0) return '';

    // Engagement angle from ae
    const engDeg = Math.acos(1 - (2 * ae / D)) * 180 / Math.PI;
    const engRad = engDeg * Math.PI / 180;

    // Scale chip thickness for visibility
    // h_max in mm, multiply by scale factor × visual amplifier
    const s     = this.scale(diameter);
    const hVis  = Math.min(seg.chip_thickness_max * s * 80, 18); // cap at 18px

    // Entry point (0°, right side of tool)
    const entryX = R;
    const entryY = 0;

    // Exit point at engDeg
    const exitX = R * Math.cos(engRad);
    const exitY = -R * Math.sin(engRad);

    // Outer arc points (tool radius + chip thickness, varying)
    // Thickness varies as h(θ) = hmax × sin(θ)
    // Sample at several angles for a smooth path
    const steps  = 12;
    let outerPts = [];
    for (let i = 0; i <= steps; i++) {
      const theta    = (i / steps) * engRad;
      const hTheta   = hVis * Math.sin(theta);
      const r        = R + hTheta;
      outerPts.push({
        x: r * Math.cos(theta),
        y: -r * Math.sin(theta)
      });
    }

    // Build SVG path:
    // Start at entry → outer arc (variable radius) → exit → inner arc back
    let d = `M ${entryX.toFixed(2)} ${entryY.toFixed(2)} `;

    // Outer arc through sampled points
    outerPts.forEach((pt, i) => {
      if (i === 0) return;
      d += `L ${pt.x.toFixed(2)} ${pt.y.toFixed(2)} `;
    });

    // Inner arc back (along tool surface, radius = R)
    d += `A ${R} ${R} 0 0 0 ${entryX.toFixed(2)} ${entryY.toFixed(2)} Z`;

    return d;
  },

  // Update all chip SVG elements from a segment
  update(seg, diameter, maxForce) {
    const R = 42;
    const s = this.scale(diameter);

    // ── Cross section ──────────────────────────────────
    const crescent = document.getElementById('chip-crescent');
    const path     = this.buildCrescentPath(seg, diameter);
    if (crescent) crescent.setAttribute('d', path);

    // Chip color
    const colors = this.forceColor(seg, maxForce);
    if (crescent) {
      crescent.setAttribute('fill',   colors.fill);
      crescent.setAttribute('stroke', colors.stroke);
    }

    // Tool diameter label
    const diamLabel = document.getElementById('chip-diam-label');
    if (diamLabel) diamLabel.textContent = `Ø ${diameter}mm`;

    // Thickness annotation at peak
    if (seg.is_cutting && seg.ae > 0) {
      const engRad  = Math.acos(1 - (2 * seg.ae / diameter));
      const peakRad = engRad / 2; // midpoint of engagement
      const hVis    = Math.min(seg.chip_thickness_max * s * 80, 18);
      const hPeak   = hVis * Math.sin(peakRad);

      const innerX  = (R * Math.cos(peakRad)).toFixed(1);
      const innerY  = -(R * Math.sin(peakRad)).toFixed(1);
      const outerX  = ((R + hPeak) * Math.cos(peakRad)).toFixed(1);
      const outerY  = -((R + hPeak) * Math.sin(peakRad)).toFixed(1);

      const peakLine = document.getElementById('chip-ann-peak');
      if (peakLine) {
        peakLine.setAttribute('x1', innerX);
        peakLine.setAttribute('y1', innerY);
        peakLine.setAttribute('x2', outerX);
        peakLine.setAttribute('y2', outerY);
      }

      const hmaxLabel = document.getElementById('chip-hmax-label');
      if (hmaxLabel) {
        hmaxLabel.setAttribute('x', (parseFloat(outerX) + 3).toFixed(1));
        hmaxLabel.setAttribute('y', (parseFloat(outerY) - 2).toFixed(1));
        hmaxLabel.textContent = `h=${seg.chip_thickness_max.toFixed(4)}`;
      }
    }

    // ── Side view ──────────────────────────────────────
    const apPx = Math.min(seg.ap * s * 8, 55); // scale ap to px, cap at 55px

    const sideRect = document.getElementById('chip-side-rect');
    if (sideRect) {
      sideRect.setAttribute('y',      (-apPx).toFixed(1));
      sideRect.setAttribute('height', apPx.toFixed(1));
      sideRect.setAttribute('fill',   seg.is_cutting ? colors.fill : 'transparent');
    }

    // ap annotation
    const apAnnLine = document.getElementById('ap-ann-line');
    const apAnnBot  = document.getElementById('ap-ann-bot');
    if (apAnnLine) {
      apAnnLine.setAttribute('y1', 0);
      apAnnLine.setAttribute('y2', (-apPx).toFixed(1));
      apAnnLine.setAttribute('x1', 52);
      apAnnLine.setAttribute('x2', 52);
    }
    if (apAnnBot) {
      apAnnBot.setAttribute('y1', (-apPx).toFixed(1));
      apAnnBot.setAttribute('y2', (-apPx).toFixed(1));
    }

    const apLabelVal = document.getElementById('ap-label-val');
    if (apLabelVal) apLabelVal.textContent = `${seg.ap.toFixed(1)}mm`;

    // Cutting glow
    const cutGlow = document.getElementById('cut-glow');
    if (cutGlow && seg.is_cutting) {
      cutGlow.setAttribute('rx', 5);
      cutGlow.setAttribute('ry', 3);
    } else if (cutGlow) {
      cutGlow.setAttribute('rx', 0);
      cutGlow.setAttribute('ry', 0);
    }

    // ── Stats row ──────────────────────────────────────
    const temp    = this.estimateTemp(seg, maxForce);
    const tempCls = temp > 400 ? 'bad' : temp > 250 ? 'warn' : 'good';
    const hmaxCls = seg.force_critical ? 'bad' : seg.force_warning ? 'warn' : 'good';

    this._set('cs-hmax', seg.chip_thickness_max > 0
      ? seg.chip_thickness_max.toFixed(4) + 'mm' : '—', hmaxCls);
    this._set('cs-havg', seg.fz > 0
      ? (seg.fz * 0.637).toFixed(4) + 'mm' : '—', hmaxCls);
    this._set('cs-ap',  seg.ap > 0  ? seg.ap.toFixed(2)  + 'mm' : '—');
    this._set('cs-ae',  seg.ae > 0  ? seg.ae.toFixed(2)  + 'mm' : '—');
    this._set('cs-arc', seg.ae > 0
      ? (Math.acos(1 - 2 * seg.ae / diameter) * 180 / Math.PI).toFixed(1) + '°' : '—');
    this._set('cs-temp', seg.is_cutting ? temp + '°C' : '—', tempCls);

    // Badge
    const badge = document.getElementById('chip-badge');
    const bt    = this.chipType(seg);
    if (badge) {
      badge.textContent = bt.text;
      badge.className   = `chip-type-badge ${bt.cls}`;
    }
  },

  _set(id, value, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
    if (cls) el.className = `csvalue ${cls}`;
    else     el.className = 'csvalue';
  }
};