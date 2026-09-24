// Fondo de la portada (P5): un fluido de verdad, escrito a mano en WebGL. Es el método de "fluidos estables" (Jos Stam,
// SIGGRAPH 1999) en la GPU, como en GPU Gems cap. 38: la velocidad se arrastra a sí misma, se le quita la divergencia
// resolviendo la presión (iteraciones de Jacobi) y arrastra la tinta; un poco de vorticidad le da los remolinos. La tinta
// la echan el ratón y, desde fuera, las cabezas de las curvas que se trazan en el plano (`splat`).
// Devuelve {splat(x, y, dx, dy, rgb), stop()} o null si el navegador no puede (sin WebGL o sin texturas de coma flotante):
// entonces la portada se queda con el fondo 2D. Se para con la pestaña oculta.
const VS = `precision highp float;
attribute vec2 aPos; uniform vec2 texel; varying vec2 vUv, vL, vR, vT, vB;
void main(){ vUv = aPos*.5+.5; vL = vUv-vec2(texel.x,0.); vR = vUv+vec2(texel.x,0.); vT = vUv+vec2(0.,texel.y); vB = vUv-vec2(0.,texel.y); gl_Position = vec4(aPos,0.,1.); }`;
const HEAD = 'precision highp float; varying vec2 vUv, vL, vR, vT, vB; uniform vec2 texel;\n';
const FS = {
  splat: `uniform sampler2D uTarget; uniform float aspect, radius; uniform vec3 color; uniform vec2 point;
    void main(){ vec2 p = vUv-point; p.x *= aspect; gl_FragColor = vec4(texture2D(uTarget,vUv).xyz + exp(-dot(p,p)/radius)*color, 1.); }`,
  advect: `uniform sampler2D uVelocity, uSource; uniform float dt, dissipation;
    void main(){ vec2 c = vUv - dt*texture2D(uVelocity,vUv).xy*texel; gl_FragColor = vec4(texture2D(uSource,c).xyz/(1.+dissipation*dt), 1.); }`,
  divergence: `uniform sampler2D uVelocity;
    void main(){ float L = texture2D(uVelocity,vL).x, R = texture2D(uVelocity,vR).x, T = texture2D(uVelocity,vT).y, B = texture2D(uVelocity,vB).y;
      vec2 C = texture2D(uVelocity,vUv).xy; if (vL.x<0.) L = -C.x; if (vR.x>1.) R = -C.x; if (vT.y>1.) T = -C.y; if (vB.y<0.) B = -C.y;
      gl_FragColor = vec4(.5*(R-L+T-B),0.,0.,1.); }`,
  curl: `uniform sampler2D uVelocity;
    void main(){ gl_FragColor = vec4(.5*(texture2D(uVelocity,vR).y - texture2D(uVelocity,vL).y - texture2D(uVelocity,vT).x + texture2D(uVelocity,vB).x),0.,0.,1.); }`,
  vorticity: `uniform sampler2D uVelocity, uCurl; uniform float curl, dt;
    void main(){ float L = texture2D(uCurl,vL).x, R = texture2D(uCurl,vR).x, T = texture2D(uCurl,vT).x, B = texture2D(uCurl,vB).x, C = texture2D(uCurl,vUv).x;
      vec2 f = .5*vec2(abs(T)-abs(B), abs(R)-abs(L)); f /= length(f)+1e-4; f *= curl*C; f.y *= -1.;
      gl_FragColor = vec4(clamp(texture2D(uVelocity,vUv).xy + f*dt, -1000., 1000.),0.,1.); }`,
  scale: `uniform sampler2D uTexture; uniform float value; void main(){ gl_FragColor = value*texture2D(uTexture,vUv); }`,
  pressure: `uniform sampler2D uPressure, uDivergence;
    void main(){ gl_FragColor = vec4(.25*(texture2D(uPressure,vL).x + texture2D(uPressure,vR).x + texture2D(uPressure,vT).x + texture2D(uPressure,vB).x - texture2D(uDivergence,vUv).x),0.,0.,1.); }`,
  gradient: `uniform sampler2D uPressure, uVelocity;
    void main(){ vec2 v = texture2D(uVelocity,vUv).xy - vec2(texture2D(uPressure,vR).x - texture2D(uPressure,vL).x, texture2D(uPressure,vT).x - texture2D(uPressure,vB).x);
      gl_FragColor = vec4(v,0.,1.); }`,
  display: `uniform sampler2D uTexture; uniform vec3 base;
    void main(){ vec3 c = texture2D(uTexture,vUv).rgb; c = c/(1.+.7*c); gl_FragColor = vec4(base + c, 1.); }`,
};
const QUALITY = { alta: { sim: 128, dye: 768, iters: 20 }, media: { sim: 96, dye: 512, iters: 12 } };

export function startFluid(canvas, { quality = 'alta' } = {}) {
  const Q = QUALITY[quality];
  if (!Q) return null;
  const opts = { alpha: false, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false };
  let gl = canvas.getContext('webgl2', opts);
  const gl2 = !!gl;
  if (!gl) gl = canvas.getContext('webgl', opts);
  if (!gl) return null;
  let IFMT, TYPE, filter;
  if (gl2) {
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return null;
    IFMT = gl.RGBA16F; TYPE = gl.HALF_FLOAT; filter = gl.LINEAR;
  } else {
    const hf = gl.getExtension('OES_texture_half_float');
    if (!hf) return null;
    IFMT = gl.RGBA; TYPE = hf.HALF_FLOAT_OES; filter = gl.getExtension('OES_texture_half_float_linear') ? gl.LINEAR : gl.NEAREST;
  }

  // ---------- programas y el rectángulo que cubre la pantalla ----------
  const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  let P;
  try {
    const vs = shader(gl.VERTEX_SHADER, VS);
    P = Object.fromEntries(Object.entries(FS).map(([k, src]) => {
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, shader(gl.FRAGMENT_SHADER, HEAD + src));
      gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {};
      for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) { const n = gl.getActiveUniform(p, i).name; u[n] = gl.getUniformLocation(p, n); }
      return [k, { p, u }];
    }));
  } catch { return null; }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  // ---------- texturas de coma flotante: velocidad, tinta, presión, divergencia, remolino ----------
  const target = (w, h) => {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.texImage2D(gl.TEXTURE_2D, 0, IFMT, w, h, 0, gl.RGBA, TYPE, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer');
    gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb, w, h, free() { gl.deleteTexture(tex); gl.deleteFramebuffer(fb); } };
  };
  const double = (w, h) => { let a = target(w, h), b = target(w, h); return { get read() { return a; }, get write() { return b; }, swap() { [a, b] = [b, a]; }, w, h, free() { a.free(); b.free(); } }; };
  const res = (n) => { const ar = gl.drawingBufferWidth / gl.drawingBufferHeight; return ar >= 1 ? [Math.round(n * ar), n] : [n, Math.round(n / ar)]; };
  let vel, dye, pres, div, curl, simW, simH;
  const fit = () => {
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (vel && canvas.width === w && canvas.height === h) return;
    canvas.width = w; canvas.height = h;
    for (const t of [vel, dye, pres, div, curl]) if (t) t.free();
    [simW, simH] = res(Q.sim);
    const [dw, dh] = res(Q.dye);
    vel = double(simW, simH); pres = double(simW, simH); div = target(simW, simH); curl = target(simW, simH); dye = double(dw, dh);
  };
  try { fit(); } catch { return null; }

  let unit = 0;
  const use = (name) => { const p = P[name]; gl.useProgram(p.p); gl.uniform2f(p.u.texel, 1 / simW, 1 / simH); unit = 0; return p.u; };
  const tex = (loc, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t.tex); gl.uniform1i(loc, unit); unit += 1; };
  const draw = (t) => {
    if (t) { gl.viewport(0, 0, t.w, t.h); gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb); }
    else { gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };

  // ---------- tinta y empujón: (x, y) en 0..1 desde arriba a la izquierda, (dx, dy) en fracciones de pantalla ----------
  function splat(x, y, dx, dy, rgb, radius = 0.0022) {
    const aspect = canvas.width / canvas.height;
    let u = use('splat');
    tex(u.uTarget, vel.read); gl.uniform1f(u.aspect, aspect); gl.uniform2f(u.point, x, 1 - y);
    gl.uniform3f(u.color, dx * 5000, -dy * 5000, 0); gl.uniform1f(u.radius, radius);
    draw(vel.write); vel.swap();
    u = use('splat');
    tex(u.uTarget, dye.read); gl.uniform1f(u.aspect, aspect); gl.uniform2f(u.point, x, 1 - y);
    gl.uniform3f(u.color, rgb[0], rgb[1], rgb[2]); gl.uniform1f(u.radius, radius);
    draw(dye.write); dye.swap();
  }

  function step(dt) {
    let u = use('curl'); tex(u.uVelocity, vel.read); draw(curl);
    u = use('vorticity'); tex(u.uVelocity, vel.read); tex(u.uCurl, curl); gl.uniform1f(u.curl, 18); gl.uniform1f(u.dt, dt); draw(vel.write); vel.swap();
    u = use('divergence'); tex(u.uVelocity, vel.read); draw(div);
    u = use('scale'); tex(u.uTexture, pres.read); gl.uniform1f(u.value, 0.8); draw(pres.write); pres.swap();
    for (let i = 0; i < Q.iters; i++) { u = use('pressure'); tex(u.uPressure, pres.read); tex(u.uDivergence, div); draw(pres.write); pres.swap(); }
    u = use('gradient'); tex(u.uPressure, pres.read); tex(u.uVelocity, vel.read); draw(vel.write); vel.swap();
    u = use('advect'); tex(u.uVelocity, vel.read); tex(u.uSource, vel.read); gl.uniform1f(u.dt, dt); gl.uniform1f(u.dissipation, 0.25); draw(vel.write); vel.swap();
    u = use('advect'); tex(u.uVelocity, vel.read); tex(u.uSource, dye.read); gl.uniform1f(u.dt, dt); gl.uniform1f(u.dissipation, 0.9); draw(dye.write); dye.swap();
    u = use('display'); tex(u.uTexture, dye.read); gl.uniform3f(u.base, 6 / 255, 10 / 255, 20 / 255); draw(null);
  }

  // ---------- ratón ----------
  const mouse = { x: -1, y: -1 };
  let turn = 0;
  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    if (mouse.x >= 0) { const dx = x - mouse.x, dy = y - mouse.y; if (Math.abs(dx) + Math.abs(dy) > 1e-4) splat(x, y, dx, dy, (turn++ % 3) ? [0.05, 0.22, 0.32] : [0.16, 0.1, 0.34]); }
    mouse.x = x; mouse.y = y;
  };
  window.addEventListener('pointermove', onMove);

  let raf = 0, alive = true, last = performance.now();
  const frame = (now) => {
    if (!alive) return;
    const dt = Math.min(0.025, (now - last) / 1000);
    last = now;
    try { fit(); step(dt); } catch { stop(); return; }
    raf = requestAnimationFrame(frame);
  };
  const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else if (alive) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', onVis);
  raf = requestAnimationFrame(frame);
  function stop() {
    alive = false; cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove); document.removeEventListener('visibilitychange', onVis);
    for (const t of [vel, dye, pres, div, curl]) if (t) t.free();
    vel = null;
  }
  return { splat, stop };
}
