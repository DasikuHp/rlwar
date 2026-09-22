// Red ejecutable a partir de un genoma (spec/02 §5): forward, backward (con BPTT), parámetros.
// Puro: sin I/O, sin aleatoriedad. Float64Array en memoria; arrays JSON al serializar.
import { analyzeGenome, weightShapes, initWeights, BLOCK_FLAGS, GenomeError } from './genome.js';

export { GenomeError, initWeights };

export class NetError extends Error {
  constructor(message, blockId = null) { super(message); this.name = 'NetError'; this.blockId = blockId; }
}

const { isEye, isMemory } = BLOCK_FLAGS;

// ---------- activaciones y derivadas (spec/02 §4) ----------
const GC = Math.sqrt(2 / Math.PI);
const ACT = {
  relu: [(x) => (x > 0 ? x : 0), (x) => (x > 0 ? 1 : 0)],
  tanh: [Math.tanh, (x, y) => 1 - y * y],
  sigmoid: [(x) => 1 / (1 + Math.exp(-x)), (x, y) => y * (1 - y)],
  leaky: [(x) => (x > 0 ? x : 0.01 * x), (x) => (x > 0 ? 1 : 0.01)],
  gelu: [(x) => 0.5 * x * (1 + Math.tanh(GC * (x + 0.044715 * x * x * x))),
    (x) => { const u = GC * (x + 0.044715 * x * x * x); const t = Math.tanh(u); return 0.5 * (1 + t) + 0.5 * x * (1 - t * t) * GC * (1 + 3 * 0.044715 * x * x); }],
  sine: [Math.sin, Math.cos],
  linear: [(x) => x, () => 1],
};
const sigm = (x) => 1 / (1 + Math.exp(-x));

// y_j = b_j + Σ_i x_i W[i*out+j]
function matvec(W, b, x, out, y = new Float64Array(out)) {
  for (let j = 0; j < out; j++) y[j] = b ? b[j] : 0;
  for (let i = 0; i < x.length; i++) { const xi = x[i]; if (xi === 0) continue; const base = i * out; for (let j = 0; j < out; j++) y[j] += xi * W[base + j]; }
  return y;
}
// gradientes de matvec: dW += x ⊗ dy, db += dy, dx += W dy
function matvecBack(W, x, dy, out, dW, db, dx) {
  for (let i = 0; i < x.length; i++) {
    const base = i * out, xi = x[i];
    let s = 0;
    for (let j = 0; j < out; j++) { dW[base + j] += xi * dy[j]; s += W[base + j] * dy[j]; }
    if (dx) dx[i] += s;
  }
  if (db) for (let j = 0; j < out; j++) db[j] += dy[j];
}
const concatRows = (parts) => { let n = 0; for (const p of parts) n += p.length; const out = new Float64Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

export function compile(genome) {
  const a = analyzeGenome(genome);
  const g = a.genome;
  const byId = Object.fromEntries(g.blocks.map((b) => [b.id, b]));
  const N = g.imagination.n;
  // parámetros en Float64Array (copia: setFlat no toca el genoma de origen)
  const params = {};
  const list = [];
  for (const id of a.order) {
    const b = byId[id];
    const shapes = weightShapes(b, a.dims[id]);
    if (!shapes) continue;
    params[id] = {};
    for (const key of Object.keys(shapes)) { params[id][key] = Float64Array.from(g.weights[id][key]); list.push({ blockId: id, key, array: params[id][key] }); }
  }
  const rows = (id) => (a.streams[id] === 'cand' ? N : a.streams[id] === 'move' ? 9 : 1);
  const memIds = a.order.filter((id) => isMemory(byId[id].type));

  const net = {
    genome: g, order: a.order, streams: a.streams, dims: a.dims, inputs: a.inputs, N,
    zeroState() {
      const st = {};
      for (const id of memIds) { const u = byId[id].params.units; st[id] = byId[id].type === 'lstm' ? { h: new Float64Array(u), c: new Float64Array(u) } : new Float64Array(u); }
      return st;
    },
    paramList() { return list; },
    paramCount() { return list.reduce((s, p) => s + p.array.length, 0); },
    getFlat() { const out = new Float64Array(this.paramCount()); let o = 0; for (const p of list) { out.set(p.array, o); o += p.array.length; } return out; },
    setFlat(flat) { let o = 0; for (const p of list) { p.array.set(flat.subarray(o, o + p.array.length)); o += p.array.length; } },
    flattenGrads(grads) { const out = new Float64Array(this.paramCount()); let o = 0; for (const p of list) { const gr = grads[p.blockId] && grads[p.blockId][p.key]; if (gr) out.set(gr, o); o += p.array.length; } return out; },
    serialize() { const w = {}; for (const bl of g.blocks) { if (!params[bl.id]) continue; w[bl.id] = {}; for (const [key, arr] of Object.entries(params[bl.id])) w[bl.id][key] = Array.from(arr); } return w; },
    zeroGrads() { const gr = {}; for (const p of list) (gr[p.blockId] ||= {})[p.key] = new Float64Array(p.array.length); return gr; },

    forward(obs, state) {
      const vals = {}, tape = { blocks: {}, obs, state };
      const outputs = { choose: null, adjust: null, move: null, value: null };
      const activations = {}, attention = {};
      const newState = { ...state };
      for (const id of a.order) {
        const b = byId[id], type = b.type, p = b.params, W = params[id], st = a.streams[id], nr = rows(id), ins = a.inputs[id];
        if (isEye(type)) {
          const src = st === 'ctx' ? obs.ctx : st === 'cand' ? obs.cand : obs.move;
          const v = src && src[id];
          const need = a.dims[id].out;
          if (st === 'ctx') { if (!v || v.length !== need) throw new NetError(`falta la observación del ojo "${id}" (${need} números)`, id); vals[id] = v; }
          else { if (!Array.isArray(v) || v.length !== nr || v.some((r) => r.length !== need)) throw new NetError(`falta la observación del ojo "${id}" (${nr} filas de ${need})`, id); vals[id] = v; }
          activations[id] = vals[id];
          continue;
        }
        // entradas: por fila; el contexto se difunde a cada fila
        const xs = new Array(nr);
        for (let r = 0; r < nr; r++) xs[r] = concatRows(ins.map((i) => (a.streams[i] === 'ctx' ? vals[i] : vals[i][r])));
        const T = { xs };
        tape.blocks[id] = T;
        let out;
        switch (type) {
          case 'dense': {
            const [f] = ACT[p.activation]; const u = p.units;
            T.z = new Array(nr); out = new Array(nr);
            for (let r = 0; r < nr; r++) { const z = matvec(W.W, W.b, xs[r], u); T.z[r] = z; const y = new Float64Array(u); for (let j = 0; j < u; j++) y[j] = f(z[j]); out[r] = y; }
            break;
          }
          case 'concat': case 'skip': out = xs; break;
          case 'add': case 'mul': {
            out = new Array(nr);
            const d = a.dims[id].out;
            T.parts = new Array(nr);
            for (let r = 0; r < nr; r++) {
              const parts = ins.map((i) => (a.streams[i] === 'ctx' ? vals[i] : vals[i][r]));
              T.parts[r] = parts;
              const y = new Float64Array(d);
              if (type === 'add') { for (const q of parts) for (let j = 0; j < d; j++) y[j] += q[j]; }
              else { y.fill(1); for (const q of parts) for (let j = 0; j < d; j++) y[j] *= q[j]; }
              out[r] = y;
            }
            break;
          }
          case 'norm': {
            const d = a.dims[id].in; out = new Array(nr); T.xhat = new Array(nr); T.inv = new Array(nr);
            for (let r = 0; r < nr; r++) {
              const x = xs[r]; let mean = 0; for (let j = 0; j < d; j++) mean += x[j]; mean /= d;
              let vr = 0; for (let j = 0; j < d; j++) vr += (x[j] - mean) ** 2; vr /= d;
              const inv = 1 / Math.sqrt(vr + p.eps); const xh = new Float64Array(d), y = new Float64Array(d);
              for (let j = 0; j < d; j++) { xh[j] = (x[j] - mean) * inv; y[j] = W.g[j] * xh[j] + W.b[j]; }
              T.xhat[r] = xh; T.inv[r] = inv; out[r] = y;
            }
            break;
          }
          case 'attention': {
            const H = p.heads, K = p.keyDim, HK = H * K, scale = 1 / Math.sqrt(K);
            const ctxIns = ins.filter((i) => a.streams[i] === 'ctx'), kvIns = ins.filter((i) => a.streams[i] !== 'ctx');
            const n = rows(kvIns[0]);
            const xq = concatRows(ctxIns.map((i) => vals[i]));
            const q = W.Wq ? matvec(W.Wq, null, xq, HK) : Float64Array.from(W.q0);
            const xk = new Array(n), ks = new Array(n), vs = new Array(n);
            for (let r = 0; r < n; r++) { xk[r] = concatRows(kvIns.map((i) => vals[i][r])); ks[r] = matvec(W.Wk, null, xk[r], HK); vs[r] = matvec(W.Wv, null, xk[r], HK); }
            const att = new Array(H), y = new Float64Array(HK);
            for (let h = 0; h < H; h++) {
              const sc = new Float64Array(n); let mx = -Infinity;
              for (let r = 0; r < n; r++) { let s = 0; for (let d = 0; d < K; d++) s += q[h * K + d] * ks[r][h * K + d]; sc[r] = s * scale; if (sc[r] > mx) mx = sc[r]; }
              let z = 0; const aw = new Float64Array(n);
              for (let r = 0; r < n; r++) { aw[r] = Math.exp(sc[r] - mx); z += aw[r]; }
              for (let r = 0; r < n; r++) aw[r] /= z;
              att[h] = aw;
              for (let r = 0; r < n; r++) for (let d = 0; d < K; d++) y[h * K + d] += aw[r] * vs[r][h * K + d];
            }
            Object.assign(T, { xq, q, xk, ks, vs, att, n, H, K, scale });
            attention[id] = att; out = [y];
            break;
          }
          case 'pool': {
            const kvIns = ins.filter((i) => a.streams[i] !== 'ctx'); const n = rows(kvIns[0]); const d = a.dims[id].out;
            const rowsIn = new Array(n); for (let r = 0; r < n; r++) rowsIn[r] = concatRows(kvIns.map((i) => vals[i][r]));
            const y = new Float64Array(d);
            if (p.op === 'mean') { for (let r = 0; r < n; r++) for (let j = 0; j < d; j++) y[j] += rowsIn[r][j] / n; }
            else { const arg = new Int32Array(d); y.fill(-Infinity); for (let r = 0; r < n; r++) for (let j = 0; j < d; j++) if (rowsIn[r][j] > y[j]) { y[j] = rowsIn[r][j]; arg[j] = r; } T.arg = arg; }
            Object.assign(T, { rowsIn, n }); out = [y];
            break;
          }
          case 'echo': case 'teamMemory': {
            const u = p.units, x = xs[0];
            const fromTeam = type === 'teamMemory' && obs.team && obs.team[id];
            const hprev = fromTeam ? obs.team[id] : state[id];
            const z = matvec(W.Wx, W.b, x, u); const zh = matvec(W.Wh, null, hprev, u);
            const h = new Float64Array(u); for (let j = 0; j < u; j++) h[j] = Math.tanh(z[j] + zh[j]);
            Object.assign(T, { hprev, h, fromTeam: !!fromTeam }); newState[id] = h; out = [h];
            break;
          }
          case 'gru': {
            const u = p.units, x = xs[0], hprev = state[id];
            const xh = concatRows([x, hprev]);
            const z = matvec(W.Wz, W.bz, xh, u).map(sigm), r_ = matvec(W.Wr, W.br, xh, u).map(sigm);
            const rh = new Float64Array(u); for (let j = 0; j < u; j++) rh[j] = r_[j] * hprev[j];
            const xrh = concatRows([x, rh]);
            const ht = matvec(W.Wh, W.bh, xrh, u).map(Math.tanh);
            const h = new Float64Array(u); for (let j = 0; j < u; j++) h[j] = (1 - z[j]) * hprev[j] + z[j] * ht[j];
            Object.assign(T, { hprev, xh, z, r: r_, xrh, ht, h }); newState[id] = h; out = [h];
            break;
          }
          case 'lstm': {
            const u = p.units, x = xs[0], { h: hprev, c: cprev } = state[id];
            const xh = concatRows([x, hprev]);
            const i_ = matvec(W.Wi, W.bi, xh, u).map(sigm), f_ = matvec(W.Wf, W.bf, xh, u).map(sigm), o_ = matvec(W.Wo, W.bo, xh, u).map(sigm), g_ = matvec(W.Wg, W.bg, xh, u).map(Math.tanh);
            const c = new Float64Array(u), h = new Float64Array(u), tc = new Float64Array(u);
            for (let j = 0; j < u; j++) { c[j] = f_[j] * cprev[j] + i_[j] * g_[j]; tc[j] = Math.tanh(c[j]); h[j] = o_[j] * tc[j]; }
            Object.assign(T, { hprev, cprev, xh, i: i_, f: f_, o: o_, g: g_, c, tc, h }); newState[id] = { h, c }; out = [h];
            break;
          }
          case 'hand.choose': case 'hand.value': {
            out = new Array(nr);
            for (let r = 0; r < nr; r++) out[r] = matvec(W.W, W.b, xs[r], 1);
            if (type === 'hand.choose') outputs.choose = { scores: Float64Array.from(out, (y) => y[0]) };
            else outputs.value = out[0][0];
            break;
          }
          case 'hand.adjust': {
            const k = p.params; out = new Array(nr);
            for (let r = 0; r < nr; r++) out[r] = matvec(W.W, W.b, xs[r], k);
            outputs.adjust = { mu: out.map((y) => Float64Array.from(y)) };
            break;
          }
          case 'foot.move': {
            out = new Array(nr); const scores = new Float64Array(nr); const mu = p.adjust ? new Array(nr) : null;
            for (let r = 0; r < nr; r++) {
              const s = matvec(W.W, W.b, xs[r], 1); scores[r] = s[0];
              if (p.adjust) { const m = matvec(W.Wa, W.ba, xs[r], 2); mu[r] = Float64Array.from(m); out[r] = concatRows([s, m]); } else out[r] = s;
            }
            outputs.move = { scores, mu };
            break;
          }
          default: throw new NetError(`bloque sin implementación: ${type}`, id);
        }
        vals[id] = st === 'ctx' ? out[0] : out;
        activations[id] = vals[id];
      }
      tape.vals = vals;
      return { outputs, activations, attention, state: newState, tape };
    },

    backward(tape, gradOut = {}, stateGradNext = null) {
      const grads = this.zeroGrads();
      const gv = {}; // gradiente respecto de la salida de cada bloque (misma forma que vals)
      const stateGrad = {};
      const ensure = (id) => { if (!gv[id]) { const nr = rows(id), d = a.dims[id].out; gv[id] = a.streams[id] === 'ctx' ? new Float64Array(d) : Array.from({ length: nr }, () => new Float64Array(d)); } return gv[id]; };
      const rowGrad = (id, r) => (a.streams[id] === 'ctx' ? ensure(id) : ensure(id)[r]);
      // siembra desde las cabezas
      for (const id of a.order) {
        const type = byId[id].type;
        if (type === 'hand.choose' && gradOut.choose) { const gvs = ensure(id); for (let r = 0; r < N; r++) gvs[r][0] = gradOut.choose[r]; }
        if (type === 'hand.value' && gradOut.value !== null && gradOut.value !== undefined) ensure(id)[0] = gradOut.value;
        if (type === 'hand.adjust' && gradOut.adjust) { const gvs = ensure(id); for (let r = 0; r < N; r++) gvs[r].set(gradOut.adjust[r]); }
        if (type === 'foot.move' && gradOut.move) { const gvs = ensure(id); for (let r = 0; r < 9; r++) { gvs[r][0] = gradOut.move.scores ? gradOut.move.scores[r] : 0; if (gradOut.move.mu && byId[id].params.adjust) { gvs[r][1] = gradOut.move.mu[r][0]; gvs[r][2] = gradOut.move.mu[r][1]; } } }
      }
      const scatter = (id, r, dx) => { // reparte dx (gradiente de la fila r concatenada) a las entradas
        let o = 0;
        for (const i of a.inputs[id]) {
          const d = a.dims[i].out; const tgt = a.streams[i] === 'ctx' ? ensure(i) : ensure(i)[r];
          for (let j = 0; j < d; j++) tgt[j] += dx[o + j];
          o += d;
        }
      };
      for (let k = a.order.length - 1; k >= 0; k--) {
        const id = a.order[k], b = byId[id], type = b.type, p = b.params, W = params[id], T = tape.blocks[id], nr = rows(id);
        if (isEye(type)) continue;
        const G = grads[id];
        switch (type) {
          case 'dense': {
            const [, df] = ACT[p.activation]; const u = p.units;
            for (let r = 0; r < nr; r++) {
              const gy = rowGrad(id, r); if (!gy) continue;
              const z = T.z[r], yr = a.streams[id] === 'ctx' ? tape.vals[id] : tape.vals[id][r];
              const dz = new Float64Array(u); for (let j = 0; j < u; j++) dz[j] = gy[j] * df(z[j], yr[j]);
              const dx = new Float64Array(T.xs[r].length);
              matvecBack(W.W, T.xs[r], dz, u, G.W, G.b, dx);
              scatter(id, r, dx);
            }
            break;
          }
          case 'concat': case 'skip': for (let r = 0; r < nr; r++) if (gv[id]) scatter(id, r, rowGrad(id, r)); break;
          case 'add': case 'mul': {
            const d = a.dims[id].out;
            for (let r = 0; r < nr; r++) {
              const gy = rowGrad(id, r); if (!gy) continue;
              const parts = T.parts[r];
              a.inputs[id].forEach((i, q) => {
                const tgt = a.streams[i] === 'ctx' ? ensure(i) : ensure(i)[r];
                for (let j = 0; j < d; j++) {
                  if (type === 'add') tgt[j] += gy[j];
                  else { let prod = 1; for (let m = 0; m < parts.length; m++) if (m !== q) prod *= parts[m][j]; tgt[j] += gy[j] * prod; }
                }
              });
            }
            break;
          }
          case 'norm': {
            const d = a.dims[id].in;
            for (let r = 0; r < nr; r++) {
              const gy = rowGrad(id, r); if (!gy) continue;
              const xh = T.xhat[r], inv = T.inv[r];
              const dxh = new Float64Array(d); let m1 = 0, m2 = 0;
              for (let j = 0; j < d; j++) { G.g[j] += gy[j] * xh[j]; G.b[j] += gy[j]; dxh[j] = gy[j] * W.g[j]; m1 += dxh[j]; m2 += dxh[j] * xh[j]; }
              m1 /= d; m2 /= d;
              const dx = new Float64Array(d); for (let j = 0; j < d; j++) dx[j] = inv * (dxh[j] - m1 - xh[j] * m2);
              scatter(id, r, dx);
            }
            break;
          }
          case 'attention': {
            const gy = gv[id]; if (!gy) break;
            const { xq, q, xk, ks, vs, att, n, H, K, scale } = T; const HK = H * K;
            const dq = new Float64Array(HK); const dks = Array.from({ length: n }, () => new Float64Array(HK)), dvs = Array.from({ length: n }, () => new Float64Array(HK));
            for (let h = 0; h < H; h++) {
              const aw = att[h]; const da = new Float64Array(n);
              for (let r = 0; r < n; r++) { let s = 0; for (let d = 0; d < K; d++) { dvs[r][h * K + d] += aw[r] * gy[h * K + d]; s += gy[h * K + d] * vs[r][h * K + d]; } da[r] = s; }
              let dot = 0; for (let r = 0; r < n; r++) dot += aw[r] * da[r];
              for (let r = 0; r < n; r++) { const ds = aw[r] * (da[r] - dot) * scale; for (let d = 0; d < K; d++) { dq[h * K + d] += ds * ks[r][h * K + d]; dks[r][h * K + d] += ds * q[h * K + d]; } }
            }
            const ctxIns = a.inputs[id].filter((i) => a.streams[i] === 'ctx'), kvIns = a.inputs[id].filter((i) => a.streams[i] !== 'ctx');
            if (W.Wq) { const dxq = new Float64Array(xq.length); matvecBack(W.Wq, xq, dq, HK, G.Wq, null, dxq); let o = 0; for (const i of ctxIns) { const t = ensure(i); for (let j = 0; j < a.dims[i].out; j++) t[j] += dxq[o + j]; o += a.dims[i].out; } }
            else for (let j = 0; j < HK; j++) G.q0[j] += dq[j];
            for (let r = 0; r < n; r++) {
              const dx = new Float64Array(xk[r].length);
              matvecBack(W.Wk, xk[r], dks[r], HK, G.Wk, null, dx); matvecBack(W.Wv, xk[r], dvs[r], HK, G.Wv, null, dx);
              let o = 0; for (const i of kvIns) { const t = ensure(i)[r]; for (let j = 0; j < a.dims[i].out; j++) t[j] += dx[o + j]; o += a.dims[i].out; }
            }
            break;
          }
          case 'pool': {
            const gy = gv[id]; if (!gy) break;
            const { n } = T; const d = a.dims[id].out; const kvIns = a.inputs[id].filter((i) => a.streams[i] !== 'ctx');
            for (let r = 0; r < n; r++) {
              const dx = new Float64Array(d);
              if (p.op === 'mean') for (let j = 0; j < d; j++) dx[j] = gy[j] / n; else for (let j = 0; j < d; j++) if (T.arg[j] === r) dx[j] = gy[j];
              let o = 0; for (const i of kvIns) { const t = ensure(i)[r]; for (let j = 0; j < a.dims[i].out; j++) t[j] += dx[o + j]; o += a.dims[i].out; }
            }
            break;
          }
          case 'echo': case 'teamMemory': {
            const u = p.units; const gy = new Float64Array(u);
            if (gv[id]) for (let j = 0; j < u; j++) gy[j] += gv[id][j];
            if (stateGradNext && stateGradNext[id]) for (let j = 0; j < u; j++) gy[j] += stateGradNext[id][j];
            const dz = new Float64Array(u); for (let j = 0; j < u; j++) dz[j] = gy[j] * (1 - T.h[j] * T.h[j]);
            const dx = new Float64Array(T.xs[0].length), dh = new Float64Array(u);
            matvecBack(W.Wx, T.xs[0], dz, u, G.Wx, G.b, dx);
            matvecBack(W.Wh, T.hprev, dz, u, G.Wh, null, dh);
            if (!T.fromTeam) stateGrad[id] = dh; else stateGrad[id] = new Float64Array(u);
            scatter(id, 0, dx);
            break;
          }
          case 'gru': {
            const u = p.units, inD = T.xs[0].length; const gy = new Float64Array(u);
            if (gv[id]) for (let j = 0; j < u; j++) gy[j] += gv[id][j];
            if (stateGradNext && stateGradNext[id]) for (let j = 0; j < u; j++) gy[j] += stateGradNext[id][j];
            const { hprev, xh, z, r: r_, xrh, ht } = T;
            const dz = new Float64Array(u), dht = new Float64Array(u), dh = new Float64Array(u);
            for (let j = 0; j < u; j++) { dz[j] = gy[j] * (ht[j] - hprev[j]); dht[j] = gy[j] * z[j]; dh[j] = gy[j] * (1 - z[j]); }
            const dpreH = new Float64Array(u); for (let j = 0; j < u; j++) dpreH[j] = dht[j] * (1 - ht[j] * ht[j]);
            const dxrh = new Float64Array(xrh.length); matvecBack(W.Wh, xrh, dpreH, u, G.Wh, G.bh, dxrh);
            const dr = new Float64Array(u); for (let j = 0; j < u; j++) { dr[j] = dxrh[inD + j] * hprev[j]; dh[j] += dxrh[inD + j] * r_[j]; }
            const dpreZ = new Float64Array(u), dpreR = new Float64Array(u);
            for (let j = 0; j < u; j++) { dpreZ[j] = dz[j] * z[j] * (1 - z[j]); dpreR[j] = dr[j] * r_[j] * (1 - r_[j]); }
            const dxh = new Float64Array(xh.length);
            matvecBack(W.Wz, xh, dpreZ, u, G.Wz, G.bz, dxh); matvecBack(W.Wr, xh, dpreR, u, G.Wr, G.br, dxh);
            const dx = new Float64Array(inD); for (let j = 0; j < inD; j++) dx[j] = dxrh[j] + dxh[j];
            for (let j = 0; j < u; j++) dh[j] += dxh[inD + j];
            stateGrad[id] = dh; scatter(id, 0, dx);
            break;
          }
          case 'lstm': {
            const u = p.units, inD = T.xs[0].length; const gy = new Float64Array(u), gc = new Float64Array(u);
            if (gv[id]) for (let j = 0; j < u; j++) gy[j] += gv[id][j];
            if (stateGradNext && stateGradNext[id]) { for (let j = 0; j < u; j++) { gy[j] += stateGradNext[id].h[j]; gc[j] += stateGradNext[id].c[j]; } }
            const { cprev, xh, i: i_, f: f_, o: o_, g: g_, tc } = T;
            const dpi = new Float64Array(u), dpf = new Float64Array(u), dpo = new Float64Array(u), dpg = new Float64Array(u), dcprev = new Float64Array(u);
            for (let j = 0; j < u; j++) {
              const dc = gc[j] + gy[j] * o_[j] * (1 - tc[j] * tc[j]);
              dpo[j] = gy[j] * tc[j] * o_[j] * (1 - o_[j]);
              dpf[j] = dc * cprev[j] * f_[j] * (1 - f_[j]);
              dpi[j] = dc * g_[j] * i_[j] * (1 - i_[j]);
              dpg[j] = dc * i_[j] * (1 - g_[j] * g_[j]);
              dcprev[j] = dc * f_[j];
            }
            const dxh = new Float64Array(xh.length);
            matvecBack(W.Wi, xh, dpi, u, G.Wi, G.bi, dxh); matvecBack(W.Wf, xh, dpf, u, G.Wf, G.bf, dxh);
            matvecBack(W.Wo, xh, dpo, u, G.Wo, G.bo, dxh); matvecBack(W.Wg, xh, dpg, u, G.Wg, G.bg, dxh);
            const dx = dxh.subarray(0, inD), dh = Float64Array.from(dxh.subarray(inD));
            stateGrad[id] = { h: dh, c: dcprev }; scatter(id, 0, dx);
            break;
          }
          case 'hand.choose': case 'hand.value': {
            for (let r = 0; r < nr; r++) { const gy = rowGrad(id, r); if (!gy) continue; const dx = new Float64Array(T.xs[r].length); matvecBack(W.W, T.xs[r], gy, 1, G.W, G.b, dx); scatter(id, r, dx); }
            break;
          }
          case 'hand.adjust': {
            for (let r = 0; r < nr; r++) { const gy = rowGrad(id, r); if (!gy) continue; const dx = new Float64Array(T.xs[r].length); matvecBack(W.W, T.xs[r], gy, p.params, G.W, G.b, dx); scatter(id, r, dx); }
            break;
          }
          case 'foot.move': {
            for (let r = 0; r < nr; r++) {
              const gy = rowGrad(id, r); if (!gy) continue;
              const dx = new Float64Array(T.xs[r].length);
              matvecBack(W.W, T.xs[r], gy.subarray(0, 1), 1, G.W, G.b, dx);
              if (p.adjust) matvecBack(W.Wa, T.xs[r], gy.subarray(1, 3), 2, G.Wa, G.ba, dx);
              scatter(id, r, dx);
            }
            break;
          }
          default: break;
        }
      }
      for (const id of memIds) if (!stateGrad[id]) { const u = byId[id].params.units; stateGrad[id] = byId[id].type === 'lstm' ? { h: new Float64Array(u), c: new Float64Array(u) } : new Float64Array(u); }
      return { grads, stateGrad };
    },
  };
  return net;
}
