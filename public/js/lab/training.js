// Lógica pura del panel de entreno (parte 4; spec/04 §6 y §9.6). Sin DOM.

const int = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const isInt = (n) => Number.isInteger(n);

// formulario → cuerpo de POST /api/lab/trainings, con los mismos límites que el servidor (evo/api.js)
export function trainingBody(f) {
  const errors = [];
  if (!f.netId) errors.push('Elige la red que va a entrenar.');
  const mix = { antagonist: Number(f.mix.antagonist) || 0, hallOfFame: Number(f.mix.hallOfFame) || 0, self: Number(f.mix.self) || 0 };
  if (!(mix.antagonist + mix.hallOfFame + mix.self > 0)) errors.push('La mezcla de rivales está a cero: sube al menos un rival (antagonista, sala de la fama o ella misma).');
  let duration;
  if (f.durationKind === 'minutes') {
    const m = Number(f.minutes);
    if (!(m > 0)) errors.push('Los minutos tienen que ser más que 0, p. ej. 10.');
    duration = { minutes: m };
  } else if (f.durationKind === 'plateau') {
    const w = int(f.window), g = Number(f.minGain);
    if (!(isInt(w) && w >= 1)) errors.push('La ventana de la meseta tiene que ser un entero de 1 o más partidas, p. ej. 50.');
    duration = { plateau: { window: w, minGain: Number.isFinite(g) ? g : 0 } };
  } else {
    const n = int(f.games);
    if (!(isInt(n) && n >= 1)) errors.push('Las partidas tienen que ser un entero de 1 o más, p. ej. 200.');
    duration = { games: n };
  }
  const speed = ['turbo', 'x1', 'x10'].includes(f.speed) ? f.speed : 'turbo';
  const workers = int(f.workers);
  if (speed === 'turbo' && !(isInt(workers) && workers >= 1 && workers <= 32)) errors.push('Los hilos van de 1 a 32.');
  let soldiers = f.soldiers;
  if (soldiers !== 'random') {
    soldiers = int(soldiers);
    if (!(isInt(soldiers) && soldiers >= 1 && soldiers <= 4)) errors.push('Los soldados por bando van de 1 a 4, o al azar.');
  }
  let seed;
  if (f.seed !== '' && f.seed !== null && f.seed !== undefined) {
    seed = int(f.seed);
    if (!(isInt(seed) && seed >= 0 && seed < 2 ** 31)) errors.push('La semilla tiene que ser un entero entre 0 y 2147483647 (o vacía para una al azar).');
  }
  if (errors.length) return { body: null, errors };
  const opponents = { ...mix, hard: Number(f.hard) || 0, ghost: Number(f.ghost) || 0 };
  if (f.antagonistId) opponents.antagonistId = f.antagonistId;
  const body = { netId: f.netId, opponents, speed };
  if (speed === 'turbo') body.workers = workers;
  body.duration = duration;
  body.soldiers = soldiers;
  if (seed !== undefined) body.seed = seed;
  if (f.exploiter) body.exploiter = true;
  return { body, errors };
}

// cuántos hilos se usan de verdad (M12, spec/04 §9.7): con gradiente (o "ambos") las partidas de un lote se juegan con
// los mismos pesos, así que corren a la vez como mucho `batchGames`; con evolución, todos. null si no hay nada que avisar
export function threadNote(learning, workers, speed) {
  if (speed !== 'turbo') return null;
  const l = learning || {};
  const method = l.method || 'gradient';
  if (method === 'evolution') return null;
  const batch = Math.max(1, Number(l.gradient && l.gradient.batchGames) || 4);
  const asked = Number(workers);
  if (!(asked > batch)) return null;
  const lead = method === 'both' ? `En la parte de gradiente se usan como mucho ${batch} de los ${asked} hilos (en la de evolución, todos)` : `Con aprendizaje por gradiente se usan como mucho ${batch} de los ${asked} hilos`;
  return { used: batch, asked, text: `${lead}: las ${batch} partidas de cada lote se juegan con los mismos pesos antes de soñar. Para usar más, sube "Partidas por lote" en el editor (Aprendizaje, nivel Científico; sueña menos veces) o entrena por evolución.` };
}

// media de los últimos n valores (al principio, de los que haya)
export function movingAverage(values, n) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    out.push(sum / Math.min(i + 1, n));
  }
  return out;
}

export function curveSeries(curve, n = 20) {
  const pts = curve || [];
  const reward = pts.map((p) => Number(p.reward) || 0);
  const wins = pts.map((p) => (p.win ? 1 : 0));
  return { games: pts.map((p) => p.game), reward, rewardAvg: movingAverage(reward, n), winRate: movingAverage(wins, n) };
}

// marcas redondas (1, 2, 2.5 o 5 × 10^k) que cubren [min, max]
export function niceTicks(min, max, n = 4) {
  let lo = Number(min), hi = Number(max);
  if (!(hi > lo)) { const d = Math.abs(lo) > 0 ? Math.abs(lo) : 1; lo -= d; hi += d; }
  const rough = (hi - lo) / Math.max(1, n);
  const e = Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * 10 ** e).find((s) => s >= rough - 1e-12);
  const start = Math.floor(lo / step + 1e-9) * step, end = Math.ceil(hi / step - 1e-9) * step;
  const out = [];
  for (let v = start, i = 0; v <= end + step / 2 && i < 50; i++, v = start + i * step) out.push(Number(v.toPrecision(12)));
  return out;
}

const r2 = (v) => Math.round(v * 100) / 100;
export function linePath(xs, ys, sx, sy) {
  return xs.map((x, i) => `${i ? 'L' : 'M'}${r2(sx(x))},${r2(sy(ys[i]))}`).join('');
}
