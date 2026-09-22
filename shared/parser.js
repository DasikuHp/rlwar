// Parser matemático compatible con la sintaxis de Graphwar:
//   variables: x, y, y' (yp), y'' (ypp)   |   constantes: e, pi
//   operadores: + - * / ^ (con multiplicación implícita: "2x", "3(x+1)", "x y")
//   funciones: sqrt ln log abs sin cos tan exp atan
// Compila a una función f(x, y, yp, ypp) => number (NaN/Inf propagan y provocan explosión).

const FUNCS = {
  sqrt: Math.sqrt, ln: Math.log, log: Math.log10, abs: Math.abs,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, atan: Math.atan,
};
const VARS = { x: 0, y: 1, yp: 2, ypp: 3, e: -1, pi: -1 };

export function tokenize(src) {
  const t = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const num = parseFloat(src.slice(i, j));
      if (!isFinite(num)) throw new Error(`Número inválido: "${src.slice(i, j)}"`);
      t.push({ type: 'num', value: num });
      i = j; continue;
    }
    if (/[a-zA-Z]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      const name = src.slice(i, j).toLowerCase();
      let primes = 0;
      while (src[j] === "'") { primes++; j++; }
      if (name === 'y' && primes === 1) t.push({ type: 'var', name: 'yp' });
      else if (name === 'y' && primes === 2) t.push({ type: 'var', name: 'ypp' });
      else if (primes > 0) throw new Error(`Variable inválida: ${name}${"'".repeat(primes)} (usa y' o y'')`);
      else t.push({ type: 'id', name });
      i = j; continue;
    }
    if ('+-*/^()'.includes(c)) { t.push({ type: c }); i++; continue; }
    throw new Error(`Carácter inválido: "${c}"`);
  }
  return t;
}

// Inserta multiplicaciones implícitas entre átomos adyacentes
function withImplicit(tokens) {
  const isAtomEnd = (tk) => tk && (tk.type === 'num' || tk.type === 'var' || tk.type === ')');
  const isAtomStart = (tk) => tk && (tk.type === 'num' || tk.type === 'var' ||
    (tk.type === 'id' && (FUNCS[tk.name] || tk.name in VARS)) || tk.type === '(');
  const out = [];
  for (const tk of tokens) {
    if (out.length && isAtomEnd(out[out.length - 1]) && isAtomStart(tk)) out.push({ type: '*' });
    out.push(tk);
  }
  return out;
}

export function parse(src) {
  const tokens = withImplicit(tokenize(src));
  let p = 0;
  const peek = () => tokens[p];
  const eat = () => tokens[p++];

  function expr() {
    let node = term();
    while (peek() && (peek().type === '+' || peek().type === '-')) {
      const op = eat().type, r = term(), l = node;
      node = op === '+' ? (v) => l(v) + r(v) : (v) => l(v) - r(v);
    }
    return node;
  }
  function term() {
    let node = unary();
    while (peek() && (peek().type === '*' || peek().type === '/')) {
      const op = eat().type, r = unary(), l = node;
      node = op === '*' ? (v) => l(v) * r(v) : (v) => l(v) / r(v);
    }
    return node;
  }
  function unary() {
    if (peek() && peek().type === '-') { eat(); const n = unary(); return (v) => -n(v); }
    if (peek() && peek().type === '+') { eat(); return unary(); }
    return power();
  }
  function power() {
    const base = atom();
    if (peek() && peek().type === '^') {
      eat();
      const exp = unary(); // associativo por la derecha
      return (v) => Math.pow(base(v), exp(v));
    }
    return base;
  }
  function atom() {
    const tk = eat();
    if (!tk) throw new Error('Expresión incompleta');
    if (tk.type === 'num') { const n = tk.value; return () => n; }
    if (tk.type === '(') {
      const n = expr();
      const close = eat();
      if (!close || close.type !== ')') throw new Error('Falta un paréntesis de cierre');
      return n;
    }
    if (tk.type === 'var') { const idx = VARS[tk.name]; return (v) => v[idx]; }
    if (tk.type === 'id') {
      if (tk.name in VARS) {
        if (tk.name === 'e') return () => Math.E;
        if (tk.name === 'pi') return () => Math.PI;
        const idx = VARS[tk.name]; return (v) => v[idx];
      }
      const fn = FUNCS[tk.name];
      if (fn) {
        const open = eat();
        if (!open || open.type !== '(') throw new Error(`Se esperaba "(" tras ${tk.name}()`);
        const arg = expr();
        const close = eat();
        if (!close || close.type !== ')') throw new Error(`Falta ")" en ${tk.name}()`);
        return (v) => fn(arg(v));
      }
      throw new Error(`Identificador desconocido: "${tk.name}"`);
    }
    throw new Error(`Token inesperado: "${tk.type}"`);
  }

  const root = expr();
  if (p < tokens.length) throw new Error(`Token inesperado al final: "${tokens[p].type === 'var' ? tokens[p].name : tokens[p].type === 'num' ? tokens[p].value : tokens[p].type}"`);
  return root;
}

export function compile(src) {
  if (typeof src !== 'string' || !src.trim()) throw new Error('Expresión vacía');
  if (src.length > 300) throw new Error('Expresión demasiado larga (máx. 300 caracteres)');
  const node = parse(src);
  // El AST trabaja con un vector de variables; aquí lo exponemos como f(x, y, y', y'')
  return (x = 0, y = 0, yp = 0, ypp = 0) => node([x, y, yp, ypp]);
}

export function tryCompile(src) {
  try { return { ok: true, f: compile(src) }; }
  catch (e) { return { ok: false, error: e.message }; }
}
