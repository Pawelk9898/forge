// scene.js — Three.js 3D scene

const Scene = {
  renderer:  null,
  camera:    null,
  scene:     null,
  tool:      null,
  stock:     null,
  toolpath:  null,
  segments:  [],
  animFrame: null,
  _isPlaying: false,

  // Smooth movement
  _toolTarget:   { x: 0, y: 0, z: 0 },
  _toolCurrent:  { x: 0, y: 0, z: 0 },
  _lerpSpeed:    0.08,

  init() {
    const container = document.getElementById('scene-container');
    const canvas    = document.getElementById('three-canvas');

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false
    });
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
    // Strong ambient — base brightness
    const ambient = new THREE.AmbientLight(0x6699dd, 5.0);
    this.scene.add(ambient);

    // Main directional — from upper left
    const dir1 = new THREE.DirectionalLight(0xffffff, 2.0);
    dir1.position.set(150, 200, 150);
    dir1.castShadow             = true;
    dir1.shadow.mapSize.width   = 2048;
    dir1.shadow.mapSize.height  = 2048;
    dir1.shadow.camera.near     = 0.5;
    dir1.shadow.camera.far      = 800;
    dir1.shadow.camera.left     = -200;
    dir1.shadow.camera.right    = 200;
    dir1.shadow.camera.top      = 200;
    dir1.shadow.camera.bottom   = -200;
    dir1.shadow.bias            = -0.001;
    this.scene.add(dir1);

    // Fill light — from right
    const dir2 = new THREE.DirectionalLight(0xaaaaff, 1.2);
    dir2.position.set(-100, 100, -50);
    this.scene.add(dir2);

    // Rim light — from behind
    const dir3 = new THREE.DirectionalLight(0x4466ff, 0.8);
    dir3.position.set(0, -50, -200);
    this.scene.add(dir3);

    // Cyan accent — matches UI theme
    const point1 = new THREE.PointLight(0x00e5ff, 1.0, 500);
    point1.position.set(-150, 150, -100);
    this.scene.add(point1);
  },

  _setupEnvironment() {
    // Grid floor — brighter
    const grid = new THREE.GridHelper(600, 60, 0x1a3a6a, 0x112244);
    grid.position.y = -1;
    this.scene.add(grid);

    // Subtle ground plane to catch shadows
    const groundGeo = new THREE.PlaneGeometry(600, 600);
    const groundMat = new THREE.MeshLambertMaterial({
      color:       0x0a1828,
      transparent: true,
      opacity:     0.6,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x    = -Math.PI / 2;
    ground.position.y    = -1.5;
    ground.receiveShadow = true;
    this.scene.add(ground);
  },

  buildFromSimulation(segments, toolDiameter, stockParams) {
    this._clearScene();
    this.segments = segments;

    const D  = toolDiameter;
    const sx = stockParams.x;
    const sy = stockParams.y;
    const sz = stockParams.z;

    // ── Stock ──────────────────────────────────────────
    // Main body — brighter, more visible material
    const stockGeo = new THREE.BoxGeometry(sx, sz, sy);
    const stockMat = new THREE.MeshPhongMaterial({
      color:       0x3a5080,
      emissive:    0x0f2040,
      specular:    0x88aadd,
      shininess:   40,
      transparent: true,
      opacity:     0.82,
    });
    this.stock = new THREE.Mesh(stockGeo, stockMat);
    this.stock.position.set(sx / 2, -sz / 2, sy / 2);
    this.stock.castShadow    = true;
    this.stock.receiveShadow = true;
    this.scene.add(this.stock);

    // Top face — brighter highlight
    const topGeo = new THREE.PlaneGeometry(sx, sy);
    const topMat = new THREE.MeshPhongMaterial({
      color:    0x4a6090,
      emissive: 0x152035,
      specular: 0x99bbee,
      shininess: 80,
    });
    const top = new THREE.Mesh(topGeo, topMat);
    top.rotation.x   = -Math.PI / 2;
    top.position.set(sx / 2, 0.5, sy / 2);
    top.receiveShadow = true;
    this.scene.add(top);

    // Wireframe edges — brighter
    const edges   = new THREE.EdgesGeometry(stockGeo);
    const edgeMat = new THREE.LineBasicMaterial({
      color:       0x6688bb,
      transparent: true,
      opacity:     0.7,
    });
    const wireframe = new THREE.LineSegments(edges, edgeMat);
    wireframe.position.copy(this.stock.position);
    this.scene.add(wireframe);

    // ── Tool ──────────────────────────────────────────
    this._buildTool(D);

    // ── Toolpath ──────────────────────────────────────
    this._buildToolpathLine(segments);

    // Frame camera
    const cx = sx / 2;
    const cz = sy / 2;
    this._orbitTarget   = new THREE.Vector3(cx, 0, cz);
    this._orbitState.radius = Math.max(sx, sy, sz) * 2.2;
    this._orbitState.theta  = -0.6;
    this._orbitState.phi    = 0.75;
    this._updateOrbitCamera();

    // Set tool to first segment start
    if (segments.length > 0) {
      const s = segments[0];
      this._toolTarget  = { x: s.x_start, y: -s.z_start, z: s.y_start };
      this._toolCurrent = { ...this._toolTarget };
      this.tool.position.set(this._toolCurrent.x, this._toolCurrent.y, this._toolCurrent.z);
    }
  },

  _buildTool(D) {
    const toolGroup = new THREE.Group();

    // Shank — bright steel
    const shankGeo = new THREE.CylinderGeometry(D / 2, D / 2, 45, 20);
    const shankMat = new THREE.MeshPhongMaterial({
      color:     0xaaaacc,
      emissive:  0x222233,
      specular:  0xffffff,
      shininess: 120,
    });
    const shank = new THREE.Mesh(shankGeo, shankMat);
    shank.position.y    = 22.5;
    shank.castShadow    = true;
    toolGroup.add(shank);

    // Flute body — slightly darker
    const fluteGeo = new THREE.CylinderGeometry(D / 2, D / 2 * 0.96, 30, 20);
    const fluteMat = new THREE.MeshPhongMaterial({
      color:     0x888899,
      emissive:  0x111122,
      specular:  0xddddff,
      shininess: 160,
    });
    const flute = new THREE.Mesh(fluteGeo, fluteMat);
    flute.position.y = -15;
    flute.castShadow = true;
    toolGroup.add(flute);

    // Tip
    const tipGeo = new THREE.CylinderGeometry(D / 2 * 0.96, D / 2 * 0.2, 5, 20);
    const tipMat = new THREE.MeshPhongMaterial({
      color:     0x555566,
      emissive:  0x111120,
      specular:  0xaaaacc,
      shininess: 200,
    });
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.y = -32.5;
    tip.castShadow = true;
    toolGroup.add(tip);

    // Tool glow at tip
    this.toolLight = new THREE.PointLight(0xff6d00, 0, 40);
    this.toolLight.position.y = -35;
    toolGroup.add(this.toolLight);

    // Flute spiral lines (visual only)
    for (let f = 0; f < 4; f++) {
      const pts = [];
      for (let i = 0; i <= 20; i++) {
        const t     = i / 20;
        const angle = (f / 4) * Math.PI * 2 + t * Math.PI * 1.5;
        const r     = D / 2;
        pts.push(new THREE.Vector3(
          r * Math.cos(angle),
          -t * 30 - 1,
          r * Math.sin(angle)
        ));
      }
      const fluteGeoLine = new THREE.BufferGeometry().setFromPoints(pts);
      const fluteLine    = new THREE.Line(fluteGeoLine, new THREE.LineBasicMaterial({
        color:       0x333344,
        transparent: true,
        opacity:     0.6,
      }));
      toolGroup.add(fluteLine);
    }

    this.tool = toolGroup;
    this.scene.add(this.tool);
  },

  _buildToolpathLine(segments) {
    if (this.toolpath) this.scene.remove(this.toolpath);

    const points = [];
    const colors = [];
    const color  = new THREE.Color();

    segments.forEach(seg => {
      if (!seg.is_cutting) {
        color.setHex(0x333355);
      } else if (seg.force_critical) {
        color.setHex(0xff1744);
      } else if (seg.force_warning) {
        color.setHex(0xffb300);
      } else {
        color.setHex(0x00e676);
      }

      points.push(new THREE.Vector3(seg.x_start, -seg.z_start, seg.y_start));
      colors.push(color.r, color.g, color.b);
      points.push(new THREE.Vector3(seg.x_end, -seg.z_end, seg.y_end));
      colors.push(color.r, color.g, color.b);
    });

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent:  true,
      opacity:      0.8,
    });

    this.toolpath = new THREE.LineSegments(geo, mat);
    this.scene.add(this.toolpath);
  },

  // Set target — tool lerps smoothly to it
  goToSegment(seg) {
    if (!this.tool) return;

    const tx = (seg.x_start + seg.x_end) / 2;
    const ty = (seg.y_start + seg.y_end) / 2;
    const tz = seg.z_start;

    this._toolTarget = { x: tx, y: -tz, z: ty };

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

  _animate() {
    this.animFrame = requestAnimationFrame(() => this._animate());

    // Smooth tool movement — lerp current toward target
    if (this.tool) {
      this._toolCurrent.x += (this._toolTarget.x - this._toolCurrent.x) * this._lerpSpeed;
      this._toolCurrent.y += (this._toolTarget.y - this._toolCurrent.y) * this._lerpSpeed;
      this._toolCurrent.z += (this._toolTarget.z - this._toolCurrent.z) * this._lerpSpeed;
      this.tool.position.set(
        this._toolCurrent.x,
        this._toolCurrent.y,
        this._toolCurrent.z
      );

      // Spin when playing
      if (this._isPlaying) {
        this.tool.children.forEach(c => {
          if (c instanceof THREE.Mesh) c.rotation.y += 0.2;
        });
      }
    }

    this.renderer.render(this.scene, this.camera);
  },

  _clearScene() {
    ['stock', 'tool', 'toolpath'].forEach(key => {
      if (this[key]) {
        this.scene.remove(this[key]);
        this[key] = null;
      }
    });
    // Also remove top face and edges — remove all non-light, non-grid children
    const toRemove = [];
    this.scene.children.forEach(c => {
      if (c instanceof THREE.Mesh || c instanceof THREE.LineSegments || c instanceof THREE.Line) {
        if (c !== this.stock && c !== this.tool && c !== this.toolpath) {
          toRemove.push(c);
        }
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
  _orbitState:  {
    dragging: false,
    lastX: 0, lastY: 0,
    theta: -0.6, phi: 0.75, radius: 280
  },

  _initOrbitControls(canvas) {
    const o = this._orbitState;

    canvas.addEventListener('mousedown', e => {
      o.dragging = true;
      o.lastX    = e.clientX;
      o.lastY    = e.clientY;
    });

    canvas.addEventListener('mousemove', e => {
      if (!o.dragging) return;
      o.theta -= (e.clientX - o.lastX) * 0.005;
      o.phi    = Math.max(0.15, Math.min(Math.PI / 2.1, o.phi - (e.clientY - o.lastY) * 0.005));
      o.lastX  = e.clientX;
      o.lastY  = e.clientY;
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