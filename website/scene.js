/*
  Phagocytosis, told by scrolling.

  A macrophage (translucent blue, with a kidney-shaped nucleus and lysosome
  granules inside) senses a rod-shaped bacterium, reaches for it with
  filopodia, wraps its membrane around it, pulls it in and digests it. How far
  the story has got follows how far down the page the visitor has scrolled,
  eased so it glides rather than jumps.

  Everything is drawn with three.js (r128, loaded before this file) on one
  canvas fixed behind the page. The cell surfaces are shaded on the GPU:
  noise gives the membrane its slow ruffling, and the engulfing cup is a
  displacement of the same surface, so the shape changes smoothly.

  Without WebGL the page simply has no scene. With reduced motion, the scene
  still follows the scroll but nothing moves on its own.
*/
(function phagocytosis() {
  if (!window.THREE) return;

  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const small = Math.min(innerWidth, innerHeight) < 700;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    return;
  }
  const canvas = renderer.domElement;
  canvas.className = "bio-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.prepend(canvas);
  let pixelRatio = Math.min(devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 0, 14);

  // Lights for the few standard materials (nucleus, granules, blood cells).
  scene.add(new THREE.AmbientLight(0x8fa2ff, 0.55));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
  keyLight.position.set(-4, 6, 8);
  scene.add(keyLight);
  const rimLight = new THREE.PointLight(0x22d3f5, 1.6, 40);
  rimLight.position.set(6, -3, 6);
  scene.add(rimLight);

  const C = {
    cyan: new THREE.Color(0x22d3f5),
    blue: new THREE.Color(0x1a7cf7),
    violet: new THREE.Color(0x7b5cf5),
    pink: new THREE.Color(0xe38af9),
  };

  // Simplex noise (Ashima Arts, MIT licence), shared by the shaders.
  const NOISE = `
    vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
    vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
    vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
    vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
    float snoise(vec3 v){
      const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
      vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
      vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
      vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
      i=mod289(i);
      vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
      float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
      vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
      vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
      vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
      vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
      vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
      vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
      vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
      p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
      vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
      return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
    }`;

  // The whole story lives in one group, moved to one side of wide screens.
  const stage = new THREE.Group();
  scene.add(stage);

  /* ========================================================================
     Macrophage
     ======================================================================== */
  const RADIUS = 2.0;
  const macrophage = new THREE.Group();
  stage.add(macrophage);

  const membraneUniforms = {
    uTime: { value: 0 },
    uDir: { value: new THREE.Vector3(1, 0, 0) },
    uCap: { value: 1.05 },   // half-angle of the cup opening, in radians
    uCup: { value: 0 },      // how strongly the cup is formed, 0 to 1
    uReach: { value: 1.1 },  // how far the cup's lips reach out
    uRadius: { value: RADIUS },
    uCyan: { value: C.cyan },
    uBlue: { value: C.blue },
    uViolet: { value: C.violet },
    uPink: { value: C.pink },
    uGlow: { value: 0 },
  };

  const membraneVertex = `
    uniform float uTime, uCap, uCup, uReach, uRadius;
    uniform vec3 uDir;
    varying vec3 vNormalW;
    varying vec3 vViewW;
    varying float vLip;
    varying float vRuffle;
    ${NOISE}
    float lipAt(vec3 unit) {
      float a = acos(clamp(dot(unit, uDir), -1.0, 1.0));
      return exp(-pow((a - uCap) / 0.34, 2.0));
    }
    float lastSlow;
    vec3 surface(vec3 unit) {
      float a = acos(clamp(dot(unit, uDir), -1.0, 1.0));
      float lip = exp(-pow((a - uCap) / 0.34, 2.0));
      float inside = 1.0 - smoothstep(uCap - 0.2, uCap + 0.05, a);
      float slow = snoise(unit * 1.2 + vec3(uTime * 0.13, 0.0, uTime * 0.09));
      // A cheap ripple in place of a second noise field.
      float fine = sin(unit.x * 9.0 + uTime * 0.7) * sin(unit.y * 8.0 - uTime * 0.5) * sin(unit.z * 7.0 + uTime * 0.4);
      lastSlow = slow;
      vec3 p = unit * uRadius * (1.0 + slow * 0.11 + fine * 0.03);
      p += (uDir * 0.85 + unit * 0.35) * lip * uCup * uReach;
      p -= unit * inside * uCup * 0.42;
      return p;
    }
    void main() {
      vec3 unit = normalize(position);
      vec3 p = surface(unit);
      float slowHere = lastSlow;
      // The normal of the moved surface, from two nearby points on it.
      vec3 helper = abs(unit.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
      vec3 t = normalize(cross(unit, helper));
      vec3 b = normalize(cross(unit, t));
      vec3 pt = surface(normalize(unit + t * 0.02));
      vec3 pb = surface(normalize(unit + b * 0.02));
      vec3 n = normalize(cross(pt - p, pb - p));
      if (dot(n, unit) < 0.0) n = -n;

      vec4 world = modelMatrix * vec4(p, 1.0);
      vNormalW = normalize(mat3(modelMatrix) * n);
      vViewW = normalize(cameraPosition - world.xyz);
      vLip = lipAt(unit) * uCup;
      vRuffle = slowHere;
      gl_Position = projectionMatrix * viewMatrix * world;
    }`;

  const membraneFragment = `
    uniform vec3 uCyan, uBlue, uViolet, uPink;
    uniform float uGlow;
    varying vec3 vNormalW;
    varying vec3 vViewW;
    varying float vLip;
    varying float vRuffle;
    void main() {
      vec3 n = normalize(vNormalW);
      vec3 v = normalize(vViewW);
      #ifdef BACK_FACE
        n = -n;
      #endif
      float facing = max(dot(n, v), 0.0);
      float fresnel = pow(1.0 - facing, 2.0);
      vec3 light = normalize(vec3(-0.45, 0.75, 0.55));
      float wrap = clamp((dot(n, light) + 0.5) / 1.5, 0.0, 1.0);

      vec3 base = mix(uBlue, uCyan, clamp(n.y * 0.5 + 0.55 + vRuffle * 0.25, 0.0, 1.0));
      base = mix(base, uViolet, clamp(-n.x * 0.35 + fresnel * 0.4, 0.0, 1.0));
      vec3 col = base * (0.3 + 0.7 * wrap);
      col += pow(max(dot(reflect(-light, n), v), 0.0), 40.0) * 0.55;
      col += fresnel * mix(uCyan, vec3(1.0), 0.35) * 0.85;
      col += vLip * uPink * 0.22 + uGlow * uCyan * 0.18;

      float alpha = clamp(0.2 + fresnel * 0.9 + vLip * 0.15, 0.0, 0.95);
      #ifdef BACK_FACE
        col *= 0.55;
        alpha *= 0.4;
      #endif
      gl_FragColor = vec4(col, alpha);
    }`;

  const bodyGeometry = new THREE.IcosahedronGeometry(1, small ? 24 : 36);
  const membraneBack = new THREE.Mesh(bodyGeometry, new THREE.ShaderMaterial({
    uniforms: membraneUniforms, vertexShader: membraneVertex, fragmentShader: membraneFragment,
    defines: { BACK_FACE: 1 }, side: THREE.BackSide, transparent: true, depthWrite: false,
  }));
  const membraneFront = new THREE.Mesh(bodyGeometry, new THREE.ShaderMaterial({
    uniforms: membraneUniforms, vertexShader: membraneVertex, fragmentShader: membraneFragment,
    side: THREE.FrontSide, transparent: true, depthWrite: false,
  }));
  membraneBack.renderOrder = 2;
  membraneFront.renderOrder = 3;
  macrophage.add(membraneBack, membraneFront);

  // Kidney-shaped nucleus, shaped once on the CPU.
  const nucleusGeometry = new THREE.SphereGeometry(0.72, 48, 32);
  {
    const pos = nucleusGeometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 1) {
      v.fromBufferAttribute(pos, i);
      v.x *= 1.35; v.y *= 0.9; v.z *= 0.95;
      // The hilum: a dent on one side.
      const dent = Math.exp(-(v.y * v.y + v.z * v.z) / 0.18) * Math.max(v.x, 0) * 0.45;
      v.x -= dent;
      v.multiplyScalar(1 + 0.04 * Math.sin(v.x * 7 + v.y * 5) * Math.cos(v.z * 6));
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    nucleusGeometry.computeVertexNormals();
  }
  const nucleus = new THREE.Mesh(nucleusGeometry, new THREE.MeshPhysicalMaterial({
    color: 0x6a4ce0, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.3, emissive: 0x2a1a70, emissiveIntensity: 0.35,
  }));
  nucleus.renderOrder = 0;
  macrophage.add(nucleus);

  // Lysosomes and other granules, drifting inside the cell.
  const granuleGeometry = new THREE.SphereGeometry(1, 14, 10);
  const granules = [];
  const lysosomeMaterial = new THREE.MeshPhysicalMaterial({ color: 0xe38af9, emissive: 0x7a2a90, emissiveIntensity: 0.5, roughness: 0.25, clearcoat: 1 });
  const vesicleMaterial = new THREE.MeshPhysicalMaterial({ color: 0x55e0ff, emissive: 0x0a5a80, emissiveIntensity: 0.5, roughness: 0.25, clearcoat: 1 });
  for (let i = 0; i < 26; i += 1) {
    const lysosome = i % 3 !== 0;
    const mesh = new THREE.Mesh(granuleGeometry, lysosome ? lysosomeMaterial : vesicleMaterial);
    const r = 0.9 + Math.random() * 0.55;
    const theta = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1);
    const home = new THREE.Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)).multiplyScalar(r);
    const size = 0.05 + Math.random() * 0.07;
    mesh.scale.setScalar(size);
    mesh.position.copy(home);
    mesh.renderOrder = 0;
    macrophage.add(mesh);
    granules.push({ mesh, home, size, lysosome, speed: 0.3 + Math.random() * 0.5, phase: Math.random() * 10 });
  }

  // Filopodia: thin, waving feelers that reach toward the bacterium first.
  const filopodiumMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 0 }, uCyan: { value: C.cyan } },
    vertexShader: `
      uniform float uTime;
      attribute float seed;
      varying float vT;
      varying vec3 vNormalW;
      varying vec3 vViewW;
      void main() {
        float t = position.y + 0.5;           // 0 at the cell, 1 at the tip
        vec3 p = position;
        p.x += sin(t * 6.0 - uTime * 2.2) * 0.06 * t;
        p.z += cos(t * 5.0 - uTime * 1.7) * 0.05 * t;
        vT = t;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewW = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform float uAlpha;
      uniform vec3 uCyan;
      varying float vT;
      varying vec3 vNormalW;
      varying vec3 vViewW;
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewW))), 1.5);
        vec3 col = mix(uCyan * 0.8, vec3(0.85, 0.97, 1.0), rim);
        gl_FragColor = vec4(col, uAlpha * (0.45 + rim * 0.55) * (1.0 - vT * 0.35));
      }`,
    transparent: true, depthWrite: false,
  });
  const filopodiumGeometry = new THREE.CylinderGeometry(0.012, 0.055, 1, 10, 40, true);
  const filopodia = [-1, -0.35, 0.35, 1].map((spread, i) => {
    const mesh = new THREE.Mesh(filopodiumGeometry, filopodiumMaterial);
    mesh.renderOrder = 1;
    macrophage.add(mesh);
    return { mesh, spread, lift: (i % 2 ? 1 : -1) * 0.35 };
  });

  /* ========================================================================
     Bacterium: a rod with a fuzzy surface and three whipping flagella
     ======================================================================== */
  const bacterium = new THREE.Group();
  stage.add(bacterium);

  const capsulePoints = [];
  {
    const r = 0.34, half = 0.56, steps = 14;
    for (let i = 0; i <= steps; i += 1) {
      const a = -Math.PI / 2 + (i / steps) * (Math.PI / 2);
      capsulePoints.push(new THREE.Vector2(Math.max(0.0001, r * Math.cos(a)), -half + r * Math.sin(a)));
    }
    for (let i = 0; i <= steps; i += 1) {
      const a = (i / steps) * (Math.PI / 2);
      capsulePoints.push(new THREE.Vector2(Math.max(0.0001, r * Math.cos(a)), half + r * Math.sin(a)));
    }
  }
  const capsuleGeometry = new THREE.LatheGeometry(capsulePoints, 64);
  capsuleGeometry.rotateZ(-Math.PI / 2); // long axis along +x
  const bacteriumUniforms = { uTime: { value: 0 }, uDissolve: { value: 0 }, uPink: { value: C.pink } };
  const bacteriumBody = new THREE.Mesh(capsuleGeometry, new THREE.ShaderMaterial({
    uniforms: bacteriumUniforms,
    vertexShader: `
      uniform float uTime;
      varying vec3 vLocal;
      varying vec3 vNormalW;
      varying vec3 vViewW;
      ${NOISE}
      void main() {
        vec3 p = position + normal * snoise(position * 6.0 + uTime * 0.4) * 0.022;
        vLocal = position;
        vec4 world = modelMatrix * vec4(p, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewW = normalize(cameraPosition - world.xyz);
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `
      uniform float uDissolve;
      uniform vec3 uPink;
      varying vec3 vLocal;
      varying vec3 vNormalW;
      varying vec3 vViewW;
      ${NOISE}
      void main() {
        float d = snoise(vLocal * 3.4) * 0.5 + 0.5;
        if (d < uDissolve) discard;
        vec3 n = normalize(vNormalW);
        vec3 v = normalize(vViewW);
        vec3 light = normalize(vec3(-0.45, 0.75, 0.55));
        float wrap = clamp((dot(n, light) + 0.4) / 1.4, 0.0, 1.0);
        float fresnel = pow(1.0 - max(dot(n, v), 0.0), 2.2);
        vec3 deep = vec3(0.55, 0.12, 0.48);
        vec3 col = mix(deep, uPink, wrap);
        col *= 0.92 + 0.08 * sin(vLocal.x * 22.0);
        col += pow(max(dot(reflect(-light, n), v), 0.0), 30.0) * 0.45;
        col += fresnel * vec3(1.0, 0.75, 1.0) * 0.55;
        float edge = (1.0 - smoothstep(uDissolve, uDissolve + 0.07, d)) * step(0.001, uDissolve);
        col += edge * vec3(1.0, 0.9, 1.0) * 1.6;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }));
  bacteriumBody.renderOrder = 1;
  bacterium.add(bacteriumBody);

  const flagellumMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uPink: { value: C.pink } },
    vertexShader: `
      uniform float uTime;
      varying float vT;
      void main() {
        float t = position.y + 0.5;
        vec3 p = position;
        p.x += sin(t * 11.0 - uTime * 9.0) * 0.16 * t;
        p.z += cos(t * 9.0 - uTime * 7.0) * 0.08 * t;
        vT = t;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uAlpha;
      uniform vec3 uPink;
      varying float vT;
      void main() { gl_FragColor = vec4(mix(uPink, vec3(1.0, 0.85, 1.0), vT * 0.5), uAlpha * (0.85 - vT * 0.5)); }`,
    transparent: true, depthWrite: false,
  });
  const flagellumGeometry = new THREE.CylinderGeometry(0.008, 0.02, 1, 6, 60, true);
  [-0.35, 0, 0.35].forEach((angle) => {
    const pivot = new THREE.Group();
    pivot.position.set(-0.86, 0, 0);
    pivot.rotation.set(angle, 0, Math.PI / 2 + angle * 0.4);
    const mesh = new THREE.Mesh(flagellumGeometry, flagellumMaterial);
    mesh.scale.y = 2.4;
    mesh.position.y = 1.2;
    mesh.renderOrder = 1;
    pivot.add(mesh);
    bacterium.add(pivot);
  });

  // A burst of fragments when digestion finishes.
  const BURST = 160;
  const burstDirs = new Float32Array(BURST * 3);
  for (let i = 0; i < BURST; i += 1) {
    const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(0.3 + Math.random());
    burstDirs.set([v.x, v.y, v.z], i * 3);
  }
  const burstGeometry = new THREE.BufferGeometry();
  burstGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BURST * 3), 3));
  burstGeometry.setAttribute("dir", new THREE.BufferAttribute(burstDirs, 3));
  const burstMaterial = new THREE.ShaderMaterial({
    uniforms: { uBurst: { value: 0 }, uScale: { value: 1 } },
    vertexShader: `
      uniform float uBurst, uScale;
      attribute vec3 dir;
      void main() {
        vec4 mv = modelViewMatrix * vec4(dir * uBurst * 0.9, 1.0);
        gl_PointSize = 3.0 * uScale * (14.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uBurst;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * sin(3.14159 * clamp(uBurst, 0.0, 1.0));
        gl_FragColor = vec4(1.0, 0.7, 1.0, a * 0.9);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const burst = new THREE.Points(burstGeometry, burstMaterial);
  burst.renderOrder = 4;
  stage.add(burst);

  /* ========================================================================
     Surroundings: drifting particles and a few distant red blood cells
     ======================================================================== */
  const DUST = small ? 350 : 700;
  const dustPositions = new Float32Array(DUST * 3);
  const dustSeeds = new Float32Array(DUST);
  for (let i = 0; i < DUST; i += 1) {
    dustPositions.set([(Math.random() - 0.5) * 30, (Math.random() - 0.5) * 20, -14 + Math.random() * 16], i * 3);
    dustSeeds[i] = Math.random();
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute("seed", new THREE.BufferAttribute(dustSeeds, 1));
  const dustMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uScroll: { value: 0 } },
    vertexShader: `
      uniform float uTime, uScale, uScroll;
      attribute float seed;
      varying float vSeed;
      varying float vDepth;
      void main() {
        vec3 p = position;
        p.y = mod(p.y + uTime * (0.05 + seed * 0.1) + uScroll * (1.0 + (p.z + 14.0) * 0.15) + 10.0, 20.0) - 10.0;
        p.x += sin(uTime * 0.2 + seed * 30.0) * 0.3;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vSeed = seed;
        vDepth = clamp(-mv.z / 30.0, 0.0, 1.0);
        gl_PointSize = (1.2 + seed * 3.0) * uScale * (14.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vSeed;
      varying float vDepth;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.05, d);
        vec3 col = mix(vec3(0.13, 0.83, 0.96), vec3(0.89, 0.54, 0.98), vSeed);
        gl_FragColor = vec4(col, a * (0.55 - vDepth * 0.35));
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  scene.add(new THREE.Points(dustGeometry, dustMaterial));

  // Red blood cells: the biconcave disc profile of Evans and Fung (1972).
  const rbcPoints = [];
  {
    const steps = 40, R = 1;
    const thickness = (t) => 0.5 * Math.sqrt(Math.max(0, 1 - t * t)) * (0.207 + 2.003 * t * t - 1.123 * t ** 4);
    for (let i = steps; i >= 0; i -= 1) rbcPoints.push(new THREE.Vector2(Math.max(0.0001, R * (i / steps)), -thickness(i / steps)));
    for (let i = 1; i <= steps; i += 1) rbcPoints.push(new THREE.Vector2(Math.max(0.0001, R * (i / steps)), thickness(i / steps)));
    rbcPoints.reverse();
  }
  const rbcGeometry = new THREE.LatheGeometry(rbcPoints, 64);
  const rbcMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xb4508c, roughness: 0.45, clearcoat: 0.6, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide,
  });
  const bloodCells = [
    [10, 5.5, -13, 1.6], [7.5, -6.5, -11, 1.3], [-13, -8, -16, 1.8], [14, -1, -15, 1.5], [3, 8.5, -14, 1.2],
  ].map(([x, y, z, s], i) => {
    const mesh = new THREE.Mesh(rbcGeometry, rbcMaterial);
    mesh.position.set(x, y, z);
    mesh.scale.setScalar(s);
    mesh.rotation.set(i * 0.9, i * 1.7, i * 0.4);
    scene.add(mesh);
    return { mesh, base: new THREE.Vector3(x, y, z), spin: 0.05 + i * 0.02 };
  });

  /* ========================================================================
     The story, as a function of scroll progress p (0 to 1)
     ======================================================================== */
  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
  const span = (p, a, b) => smooth((p - a) / (b - a));

  const M_START = new THREE.Vector3(-1.5, -0.35, 0);
  const M_END = new THREE.Vector3(-0.55, -0.1, 0);
  const APPROACH = new THREE.Vector3(1, 0.42, 0.18).normalize();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const xAxis = new THREE.Vector3(1, 0, 0);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const swimQuat = new THREE.Quaternion();
  const alignQuat = new THREE.Quaternion();
  const wobbleQuat = new THREE.Quaternion();

  function pose(p, time) {
    const sensing = span(p, 0.0, 0.2);
    const contact = span(p, 0.16, 0.36);
    const press = span(p, 0.34, 0.5);
    const close = span(p, 0.4, 0.54);
    const pullIn = span(p, 0.5, 0.64);
    const digest = span(p, 0.64, 0.86);
    const rest = span(p, 0.86, 1.0);

    // Macrophage glides toward its prey, then drifts on at the end.
    const M = tmp.copy(M_START).lerp(M_END, sensing);
    M.x += rest * 0.6;
    M.y += Math.sin(time * 0.35) * 0.08;
    macrophage.position.copy(M);

    // Bacterium: swims freely, is caught at the surface, pressed into the cup, pulled inside.
    const free = new THREE.Vector3(2.9 + Math.sin(time * 0.6) * 0.25, 1.35 + Math.sin(time * 0.9) * 0.18, 0.3 + Math.cos(time * 0.5) * 0.2);
    const atSurface = M.clone().addScaledVector(APPROACH, RADIUS + 0.5);
    const inCup = M.clone().addScaledVector(APPROACH, RADIUS - 0.1);
    const inside = M.clone().addScaledVector(APPROACH, 0.75).add(tmp2.set(0, -0.15, 0.2));
    const B = free.lerp(atSurface, contact).lerp(inCup, press).lerp(inside, pullIn);
    // Once inside, it rides along with the cell.
    bacterium.position.copy(B);

    // Swim orientation wobbles; once caught it turns to enter end first.
    wobbleQuat.setFromAxisAngle(yAxis, Math.sin(time * 1.3) * 0.35);
    swimQuat.setFromUnitVectors(xAxis, tmp2.set(-0.9, -0.25, 0.3).normalize()).multiply(wobbleQuat);
    alignQuat.setFromUnitVectors(xAxis, tmp2.copy(APPROACH).negate());
    bacterium.quaternion.copy(swimQuat).slerp(alignQuat, contact);
    bacterium.rotateX(time * (0.8 - contact * 0.6));

    const shrink = 1 - digest * 0.55;
    bacterium.scale.setScalar(shrink);
    bacteriumUniforms.uDissolve.value = span(p, 0.7, 0.87) * 1.02;
    flagellumMaterial.uniforms.uAlpha.value = 1 - span(p, 0.44, 0.6);

    // Cup: forms on contact, closes over the bacterium, then smooths away.
    const dir = tmp2.copy(B).sub(M).normalize();
    membraneUniforms.uDir.value.copy(dir);
    membraneUniforms.uCup.value = contact * (1 - span(p, 0.58, 0.7));
    membraneUniforms.uCap.value = 1.05 * (1 - close);
    membraneUniforms.uReach.value = 1.15 * (1 - pullIn * 0.85);
    membraneUniforms.uGlow.value = Math.sin(Math.PI * digest);

    // Filopodia reach out while sensing, then retract once contact is made.
    const reach = span(p, 0.03, 0.2) * (1 - span(p, 0.3, 0.42));
    filopodiumMaterial.uniforms.uAlpha.value = reach;
    const toPrey = B.clone().sub(M);
    const gap = Math.max(0.2, toPrey.length() - RADIUS * 0.95);
    toPrey.normalize();
    filopodia.forEach((f) => {
      const d = toPrey.clone().add(new THREE.Vector3(-toPrey.y, toPrey.x, 0).multiplyScalar(f.spread * 0.45)).add(new THREE.Vector3(0, 0, f.lift)).normalize();
      const length = Math.max(0.001, reach * gap * (0.75 + Math.abs(f.spread) * 0.1));
      f.mesh.visible = reach > 0.01;
      f.mesh.quaternion.setFromUnitVectors(yAxis, d);
      f.mesh.scale.set(1, length, 1);
      f.mesh.position.copy(d).multiplyScalar(RADIUS * 0.92 + length / 2);
    });

    // Granules drift; lysosomes rush to the phagosome during digestion.
    const localPrey = B.clone().sub(M);
    granules.forEach((g, i) => {
      const drift = g.home.clone().add(new THREE.Vector3(
        Math.sin(time * g.speed + g.phase) * 0.12,
        Math.cos(time * g.speed * 0.8 + g.phase) * 0.12,
        Math.sin(time * g.speed * 0.6 + g.phase * 2) * 0.12,
      ));
      const fuse = g.lysosome ? span(p, 0.6 + (i % 5) * 0.02, 0.78 + (i % 5) * 0.02) * (1 - span(p, 0.88, 1)) : 0;
      const target = localPrey.clone().add(g.home.clone().normalize().multiplyScalar(0.28 * shrink));
      g.mesh.position.copy(drift.lerp(target, fuse));
      g.mesh.scale.setScalar(g.size * (1 + fuse * 0.6));
    });
    nucleus.position.copy(dir).multiplyScalar(-0.55).add(tmp.set(0, 0.05, -0.2));
    nucleus.rotation.set(0.3, time * 0.05 + 0.6, 0.2);

    burst.position.copy(B);
    burstMaterial.uniforms.uBurst.value = span(p, 0.78, 0.95);
  }

  /* ========================================================================
     Layout, scrolling and the render loop
     ======================================================================== */
  // Past the hero, the scene slides further right to keep clear of the text.
  let stageRight = 0, stageFar = 0;
  function layout() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const halfHeight = camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const halfWidth = halfHeight * camera.aspect;
    // Wide screens: the right side, clear of the text. Narrow screens: centred and dimmed by CSS.
    if (w > 900) {
      stageRight = halfWidth * 0.46;
      stageFar = halfWidth * 0.62;
      stage.position.set(stageRight, -0.2, 0);
      stage.scale.setScalar(Math.min(1, halfWidth / 7.5));
    } else {
      stageRight = stageFar = 0.4;
      stage.position.set(0.4, -0.5, 0);
      stage.scale.setScalar(Math.min(0.85, halfWidth / 4.6));
    }
    const pixelScale = renderer.getPixelRatio();
    dustMaterial.uniforms.uScale.value = pixelScale;
    burstMaterial.uniforms.uScale.value = pixelScale;
  }

  let target = 0, progress = 0;
  function readScroll() {
    const max = document.documentElement.scrollHeight - innerHeight;
    target = max > 0 ? clamp01(scrollY / max) : 0;
  }

  const pointer = { x: 0, y: 0 }, eased = { x: 0, y: 0 };
  addEventListener("pointermove", (e) => {
    pointer.x = e.clientX / innerWidth - 0.5;
    pointer.y = e.clientY / innerHeight - 0.5;
  }, { passive: true });

  let clockStart = performance.now();
  // If frames take too long, lower the drawing resolution step by step.
  let slowFrames = 0, lastNow = 0;
  function adapt(now) {
    const dt = lastNow ? now - lastNow : 16;
    lastNow = now;
    slowFrames = dt > 24 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
    if (slowFrames > 45 && pixelRatio > 0.75) {
      pixelRatio = Math.max(0.75, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio);
      layout();
      slowFrames = 0;
    }
  }

  function frame(now) {
    if (!reduceMotion) adapt(now);
    const time = reduceMotion ? 0 : (now - clockStart) / 1000;
    progress += (target - progress) * (reduceMotion ? 1 : 0.1);
    if (Math.abs(target - progress) < 0.0005) progress = target;

    eased.x += (pointer.x - eased.x) * 0.04;
    eased.y += (pointer.y - eased.y) * 0.04;
    camera.position.x = eased.x * 0.8;
    camera.position.y = -eased.y * 0.5;
    camera.lookAt(0, 0, 0);

    membraneUniforms.uTime.value = time;
    bacteriumUniforms.uTime.value = time;
    flagellumMaterial.uniforms.uTime.value = time;
    filopodiumMaterial.uniforms.uTime.value = time;
    dustMaterial.uniforms.uTime.value = time;
    dustMaterial.uniforms.uScroll.value = progress;

    bloodCells.forEach((c, i) => {
      c.mesh.rotation.y += reduceMotion ? 0 : c.spin * 0.01;
      c.mesh.rotation.x += reduceMotion ? 0 : c.spin * 0.006;
      c.mesh.position.y = c.base.y + progress * (3 + i) - (3 + i) * 0.5;
    });

    stage.position.x = stageRight + (stageFar - stageRight) * span(progress, 0.02, 0.12);
    pose(progress, time);
    renderer.render(scene, camera);
  }

  // Reduced motion: draw only when the scroll changes. Otherwise run a loop,
  // paused while the tab is hidden.
  let running = false, raf = 0;
  function loop(now) { frame(now); raf = requestAnimationFrame(loop); }
  function start() { if (!running && !document.hidden) { running = true; raf = requestAnimationFrame(loop); } }
  function stop() { running = false; cancelAnimationFrame(raf); }

  layout();
  readScroll();
  progress = target;
  addEventListener("resize", () => { layout(); readScroll(); if (reduceMotion) frame(0); });
  addEventListener("scroll", () => { readScroll(); if (reduceMotion) requestAnimationFrame(frame); }, { passive: true });

  if (reduceMotion) {
    frame(0);
  } else {
    document.addEventListener("visibilitychange", () => { document.hidden ? stop() : start(); });
    start();
  }
})();
