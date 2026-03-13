// scene.js — Three.js 3D scene

const Scene = {
  renderer:   null,
  camera:     null,
  scene:      null,
  tool:       null,
  stock:      null,
  toolpath:   null,
  segments:   [],
  animFrame:  null,
  _isPlaying: false,

  _toolTarget:  { x: 0, y: 0, z: 0 },
  _toolCurrent: { x: 0, y: 0, z: 0 },
  _lerpSpeed:   0.01,
  _cutFloors:   [],

  init() {
    const container = document.getElementById('scene-container');
    const canvas    = document.getElementById('three-canvas');

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setClearColor(0x0d3060, 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a1628, 0.0012);

    this.camera = new THREE.PerspectiveCamera(
      42,
      container.clientWidth / container.clientHeight,
      0.1,
      2000
    );
    this.camera.position.set(160, 130, 200);
    this.camera.lookAt(50, 0, 50);

    this._setupLights();
    this._setupEnvironment();
    this._initOrbitControls(canvas);

    window.addEventListener('resize', () => this._onResize());
    this._animate();
  },

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0x6699dd, 5.0));

    const dir1 = new THREE.DirectionalLight(0xffffff, 2.0);
    dir1.position.set(150, 200, 150);
    dir1.castShadow            = true;
    dir1.shadow.mapSize.width  = 2048;
    dir1.shadow.mapSize.height = 2048;
    dir1.shadow.camera.near    = 0.5;
    dir1.shadow.camera.far     = 800;
    dir1.shadow.camera.left    = -200;
    dir1.shadow.camera.right   = 200;
    dir1.shadow.camera.top     = 200;
    dir1.shadow.camera.bottom  = -200;
    dir1.shadow.bias           = -0.001;
    this.scene.add(dir1);

    const dir2 = new THREE.DirectionalLight(0xaaaaff, 1.2);
    dir2.position.set(-100, 100, -50);
    this.scene.add(dir2);

    const dir3 = new THREE.DirectionalLight(0x4466ff, 0.8);
    dir3.position.set(0, -50, -200);
    this.scene.add(dir3);

    const point1 = new THREE.PointLight(0x00e5ff, 1.0, 500);
    point1.position.set(-150, 150, -100);
    this.scene.add(point1);
  },

  _setupEnvironment() {
    const grid = new THREE.GridHelper(600, 60, 0x1a3a6a, 0x112244);
    grid.position.y = -1;
    this.scene.add(grid);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 600),
      new THREE.MeshLambertMaterial({ color: 0x0a1828, transparent: true, opacity: 0.6 })
    );
    ground.rotation.x    = -Math.PI / 2;
    ground.position.y    = -1.5;
    ground.receiveShadow = true;
    this.scene.add(ground);
  },

  buildFromSimulation(segments, toolDiameter, stockParams) {
    this._clearScene();
    this.segments   = segments;
    this._cutFloors = [];

    const D  = toolDiameter;
    const sx = stockParams.x;  // width  (X)
    const sy = stockParams.y;  // depth  (Y)
    const sz = stockParams.z;  // height (Z)

    // ── Stock ─────────────────────────────────────────
    // Stock sits with TOP at Y=0, bottom at Y=-sz
    // G-code Z=0 = top of stock, Z negative = into material
    const stockGeo = new THREE.BoxGeometry(sx, sz, sy);
    const stockMat = new THREE.MeshPhongMaterial({
      color:       0x2a4a6a,
      emissive:    0x0a1828,
      specular:    0x4466aa,
      shininess:   30,
      transparent: true,
      opacity:     0.5,
    });
    this.stock = new THREE.Mesh(stockGeo, stockMat);
    // Center of box at (sx/2, -sz/2, sy/2) so top face is at Y=0
    this.stock.position.set(sx / 2, -sz / 2, sy / 2);
    this.stock.castShadow    = true;
    this.stock.receiveShadow = true;
    this.scene.add(this.stock);

    // Top face highlight
    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(sx, sy),
      new THREE.MeshPhongMaterial({
        color:     0x3a5a80,
        emissive:  0x102030,
        specular:  0x88aad0,
        shininess: 60,
      })
    );
    top.rotation.x = -Math.PI / 2;
    top.position.set(sx / 2, 0.2, sy / 2);
    top.receiveShadow = true;
    this.scene.add(top);

    // Wireframe edges
    const wireframe = new THREE.LineSegments(
      new THREE.EdgesGeometry(stockGeo),
      new THREE.LineBasicMaterial({ color: 0x4488cc, transparent: true, opacity: 0.8 })
    );
    wireframe.position.copy(this.stock.position);
    this.scene.add(wireframe);

    // ── Tool ──────────────────────────────────────────
    this._buildTool(D);

    // ── Toolpath ──────────────────────────────────────
    this._buildToolpathLine(segments);

    // Frame camera on stock center
    this._orbitTarget       = new THREE.Vector3(sx / 2, -sz / 4, sy / 2);
    this._orbitState.radius = Math.max(sx, sy, sz) * 2.5;
    this._orbitState.theta  = -0.6;
    this._orbitState.phi    = 0.75;
    this._updateOrbitCamera();

    // Place tool at first segment start
  if (segments.length > 0) {
      const s = segments[0];
      this._toolCurrent = { x: s.x_start, y: s.z_start, z: s.y_start };
      this._toolTarget  = { ...this._toolCurrent };
      this.tool.position.set(this._toolCurrent.x, this._toolCurrent.y, this._toolCurrent.z);
    }
  },

_buildTool(D) {
    const toolGroup = new THREE.Group();

    // Flute body — flat endmill, tip at Y=0, goes up
    const flute = new THREE.Mesh(
      new THREE.CylinderGeometry(D / 2, D / 2, 35, 20),
      new THREE.MeshPhongMaterial({ color: 0x888899, emissive: 0x111122, specular: 0xddddff, shininess: 160 })
    );
    flute.position.y = 17.5;
    flute.castShadow = true;
    toolGroup.add(flute);

    // Shank
    const shank = new THREE.Mesh(
      new THREE.CylinderGeometry(D / 2, D / 2, 45, 20),
      new THREE.MeshPhongMaterial({ color: 0xaaaacc, emissive: 0x222233, specular: 0xffffff, shininess: 120 })
    );
    shank.position.y = 57.5;
    shank.castShadow = true;
    toolGroup.add(shank);

    // Glow at tip (Y=0)
    this.toolLight = new THREE.PointLight(0xff6d00, 0, 40);
    this.toolLight.position.y = 0;
    toolGroup.add(this.toolLight);

    // Flute spiral lines
    for (let f = 0; f < 4; f++) {
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const t     = i / 20;
        const angle = (f / 4) * Math.PI * 2 + t * Math.PI * 1.5;
        pts.push(new THREE.Vector3(
          (D / 2) * Math.cos(angle),
          t * 35,
          (D / 2) * Math.sin(angle)
        ));
      }
      toolGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x333344, transparent: true, opacity: 0.6 })
      ));
    }

    toolGroup.position.y = 0;
    this.tool = toolGroup;
    this.scene.add(this.tool);
  },

  _buildToolpathLine(segments) {
    if (this.toolpath) this.scene.remove(this.toolpath);

    const points = [];
    const colors = [];
    const color  = new THREE.Color();

    segments.forEach(seg => {
      if (!seg.is_cutting)        color.setHex(0x223355);
      else if (seg.force_critical) color.setHex(0xff1744);
      else if (seg.force_warning)  color.setHex(0xffb300);
      else                         color.setHex(0x00e676);

      // Three.js: X=gcode_X, Y=-gcode_Z, Z=gcode_Y
      points.push(new THREE.Vector3(seg.x_start, seg.z_start, seg.y_start));
      colors.push(color.r, color.g, color.b);
      points.push(new THREE.Vector3(seg.x_end, seg.z_end, seg.y_end));
      colors.push(color.r, color.g, color.b);
    });

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    this.toolpath = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent:  true,
      opacity:      0.85,
    }));
    this.scene.add(this.toolpath);
  },

  goToSegment(seg) {
    if (!this.tool) return;

    // Snap to segment start, lerp to end
    // Three.js Y = -gcode_Z (so Z=0 → Y=0 top of stock, Z=-3 → Y=3 inside stock)
    this._toolCurrent = {
      x: seg.x_start,
      y: seg.z_start,
      z: seg.y_start,
    };
    this._toolTarget = {
      x: seg.x_end,
      y: seg.z_end,
      z: seg.y_end,
    };

    // Tool light
    if (this.toolLight) {
      if (seg.force_critical) {
        this.toolLight.color.setHex(0xff1744);
        this.toolLight.intensity = 3.0;
      } else if (seg.force_warning) {
        this.toolLight.color.setHex(0xff6d00);
        this.toolLight.intensity = 1.8;
      } else if (seg.is_cutting) {
        this.toolLight.color.setHex(0xffb300);
        this.toolLight.intensity = 1.0;
      } else {
        this.toolLight.intensity = 0;
      }
    }
  },

  updateCutFloors(segments, currentSegIndex) {
    // Clear previous
    if (this._cutFloors) {
      this._cutFloors.forEach(f => this.scene.remove(f));
    }
    this._cutFloors = [];

    if (!segments || segments.length === 0) return;

    const cutSegs = segments.filter(s =>
      s.is_cutting && s.segment_index <= currentSegIndex && s.z_end < 0
    );
    if (cutSegs.length === 0) return;

    // Group by Z depth
    const byDepth = {};
    cutSegs.forEach(seg => {
      const z = Math.round(seg.z_end * 10) / 10;
      if (!byDepth[z]) byDepth[z] = [];
      byDepth[z].push(seg);
    });

    Object.entries(byDepth).forEach(([zStr, segs]) => {
      const zGcode = parseFloat(zStr); // negative value e.g. -3
      const y3     = -zGcode;          // Three.js Y e.g. 3

      let xMin = Infinity, xMax = -Infinity;
      let yMin = Infinity, yMax = -Infinity;
      segs.forEach(seg => {
        xMin = Math.min(xMin, seg.x_start, seg.x_end);
        xMax = Math.max(xMax, seg.x_start, seg.x_end);
        yMin = Math.min(yMin, seg.y_start, seg.y_end);
        yMax = Math.max(yMax, seg.y_start, seg.y_end);
      });
      if (!isFinite(xMin)) return;

      const w  = xMax - xMin;
      const h  = yMax - yMin;
      const cx = xMin + w / 2;
      const cy = yMin + h / 2;

      // Floor plane at cut depth
      const floorGeo  = new THREE.PlaneGeometry(w, h);
      const floorMesh = new THREE.Mesh(floorGeo, new THREE.MeshPhongMaterial({
        color: 0x0d1f35, emissive: 0x050f1a, specular: 0x1a2e4a, shininess: 15, side: THREE.DoubleSide,
      }));
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.position.set(cx, y3, cy);
      this.scene.add(floorMesh);
      this._cutFloors.push(floorMesh);

      // Floor edge
      const floorEdge = new THREE.LineSegments(
        new THREE.EdgesGeometry(floorGeo),
        new THREE.LineBasicMaterial({ color: 0x1a55aa, transparent: true, opacity: 0.9 })
      );
      floorEdge.rotation.x = -Math.PI / 2;
      floorEdge.position.set(cx, y3 + 0.2, cy);
      this.scene.add(floorEdge);
      this._cutFloors.push(floorEdge);

      // Walls — from Y=0 (top) down to Y=y3 (cut depth)
      const wallMat = new THREE.MeshPhongMaterial({
        color: 0x102030, emissive: 0x050f18, specular: 0x1a2e44,
        shininess: 10, side: THREE.DoubleSide, transparent: true, opacity: 0.92,
      });

      this._makeWall(xMin, xMax, 0, y3, yMin, 'z', wallMat); // front
      this._makeWall(xMin, xMax, 0, y3, yMax, 'z', wallMat); // back
      this._makeWall(yMin, yMax, 0, y3, xMin, 'x', wallMat); // left
      this._makeWall(yMin, yMax, 0, y3, xMax, 'x', wallMat); // right
    });
  },

  // span = along the wall, yTop/yBottom = Three.js Y range, fixed = position of wall
  // axis = which world axis the wall faces ('x' or 'z')
  _makeWall(spanMin, spanMax, yTop, yBottom, fixed, axis, mat) {
    const span    = spanMax - spanMin;
    const height  = Math.abs(yBottom - yTop);
    const spanMid = spanMin + span / 2;
    const yMid    = (yTop + yBottom) / 2;

    const geo  = new THREE.PlaneGeometry(span, height);
    const wall = new THREE.Mesh(geo, mat);

    if (axis === 'z') {
      wall.position.set(spanMid, yMid, fixed);
      // no rotation — faces +Z by default
    } else {
      wall.rotation.y = Math.PI / 2;
      wall.position.set(fixed, yMid, spanMid);
    }

    this.scene.add(wall);
    this._cutFloors.push(wall);

    const edge = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x1a3a6a, transparent: true, opacity: 0.5 })
    );
    edge.position.copy(wall.position);
    edge.rotation.copy(wall.rotation);
    this.scene.add(edge);
    this._cutFloors.push(edge);
  },

_animate() {
    this.animFrame = requestAnimationFrame(() => this._animate());

    if (this.tool) {
      // Move tool at fixed speed along segment, no lerp
      const dx = this._toolTarget.x - this._toolCurrent.x;
      const dy = this._toolTarget.y - this._toolCurrent.y;
      const dz = this._toolTarget.z - this._toolCurrent.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);

      if (dist > 0.1) {
        // Move at fixed speed (mm per frame)
        const speed = 1.2;
        const step  = Math.min(speed, dist);
        const ratio = step / dist;
        this._toolCurrent.x += dx * ratio;
        this._toolCurrent.y += dy * ratio;
        this._toolCurrent.z += dz * ratio;
      } else {
        // Snap exactly when close enough
        this._toolCurrent.x = this._toolTarget.x;
        this._toolCurrent.y = this._toolTarget.y;
        this._toolCurrent.z = this._toolTarget.z;
      }

      this.tool.position.set(
        this._toolCurrent.x,
        this._toolCurrent.y,
        this._toolCurrent.z
      );

      if (this._isPlaying) {
        this.tool.children.forEach(c => {
          if (c instanceof THREE.Mesh) c.rotation.y += 0.2;
        });
      }
    }

    this.renderer.render(this.scene, this.camera);
  },

  _clearScene() {
    if (this._cutFloors) {
      this._cutFloors.forEach(f => this.scene.remove(f));
      this._cutFloors = [];
    }
    ['stock', 'tool', 'toolpath'].forEach(key => {
      if (this[key]) { this.scene.remove(this[key]); this[key] = null; }
    });
    const toRemove = [];
    this.scene.children.forEach(c => {
      if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments || c instanceof THREE.Line) {
        toRemove.push(c);
      }
    });
    toRemove.forEach(c => this.scene.remove(c));
  },

  _onResize() {
    const container = document.getElementById('scene-container');
    if (!container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  },

  _orbitTarget: new THREE.Vector3(50, 0, 50),
  _orbitState: { dragging: false, lastX: 0, lastY: 0, theta: -0.6, phi: 0.75, radius: 280 },

  _initOrbitControls(canvas) {
    const o = this._orbitState;
    canvas.addEventListener('mousedown', e => { o.dragging = true; o.lastX = e.clientX; o.lastY = e.clientY; });
    canvas.addEventListener('mousemove', e => {
      if (!o.dragging) return;
      o.theta -= (e.clientX - o.lastX) * 0.005;
      o.phi    = Math.max(0.15, Math.min(Math.PI / 2.1, o.phi - (e.clientY - o.lastY) * 0.005));
      o.lastX  = e.clientX; o.lastY = e.clientY;
      this._updateOrbitCamera();
    });
    canvas.addEventListener('mouseup',    () => { o.dragging = false; });
    canvas.addEventListener('mouseleave', () => { o.dragging = false; });
    canvas.addEventListener('wheel', e => {
      o.radius = Math.max(60, Math.min(700, o.radius + e.deltaY * 0.4));
      this._updateOrbitCamera();
      e.preventDefault();
    }, { passive: false });
  },

  _updateOrbitCamera() {
    const o = this._orbitState;
    const t = this._orbitTarget;
    this.camera.position.set(
      t.x + o.radius * Math.sin(o.phi) * Math.sin(o.theta),
      t.y + o.radius * Math.cos(o.phi),
      t.z + o.radius * Math.sin(o.phi) * Math.cos(o.theta)
    );
    this.camera.lookAt(t);
  },
};