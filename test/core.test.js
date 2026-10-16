'use strict';
// index.html 의 /* @core-start */ … /* @core-end */ 블록(수식 파서, LaTeX 출력, 컴파일, 적분기, 보간, 눈금)을
// 그대로 꺼내 Node에서 돌린다. 페이지는 파일 하나로 유지하면서 계산 코어만 검사하기 위한 방식.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCore() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const blocks = [...html.matchAll(/\/\* @core-start[^*]*\*\/([\s\S]*?)\/\* @core-end \*\//g)].map((m) => m[1]);
  assert.ok(blocks.length >= 4, '@core 블록이 4개 이상 있어야 한다');
  const names = ['num', 'fmt', 'tokenize', 'parse', 'mapVars', 'collectVars', 'flatten', 'toText', 'autoLatex', 'texNum', 'toTex',
    'compile', 'integrate', 'makeEvents', 'integrateEvents', 'interp1', 'parseData', 'cmpMetrics', 'windowStats', 'interp', 'niceTicks', 'decadeTicks'];
  const src = '(function(M){"use strict";\n' + blocks.join('\n') + '\nreturn {' + names.join(',') + '};\n})';
  const factory = vm.runInThisContext(src, { filename: 'index.html#core' });
  return (M) => factory(M);
}
const make = loadCore();
const K = make(null);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≈ ${b} (tol ${tol})`);
const ev = (src, vars = {}) => {
  // 파서만 쓰는 간단한 평가기 (compile 과 독립적으로 AST 모양을 검증)
  const go = (n) => {
    switch (n.t) {
      case 'num': return n.v;
      case 'var': return vars[n.n];
      case 'neg': return -go(n.a);
      case 'fn': { const a = n.args.map(go); return { exp: Math.exp, ln: Math.log, sqrt: Math.sqrt, min: Math.min, max: Math.max, abs: Math.abs }[n.n](...a); }
      default: { const a = go(n.a), b = go(n.b); return { '+': a + b, '-': a - b, '*': a * b, '/': a / b, '^': a ** b }[n.op]; }
    }
  };
  return go(K.parse(src));
};

test('파서: 우선순위·결합 규칙', () => {
  assert.equal(ev('1+2*3'), 7);
  assert.equal(ev('(1+2)*3'), 9);
  assert.equal(ev('2^3^2'), 512, '거듭제곱은 오른쪽 결합');
  assert.equal(ev('-2^2'), -4, '단항 음수는 거듭제곱보다 약하다');
  assert.equal(ev('8/2/2'), 2, '나눗셈은 왼쪽 결합');
  assert.equal(ev('2**3'), 8, '** 도 거듭제곱');
  assert.equal(ev('10-3-2'), 5);
  assert.equal(ev('1e-3*1000'), 1);
  assert.equal(ev('.5+.5'), 1);
});

test('파서: 숫자 뒤 암시적 곱셈, 유니코드 연산자', () => {
  assert.equal(ev('2x', { x: 3 }), 6);
  assert.equal(ev('2(x+1)', { x: 3 }), 8);
  assert.equal(ev('3 × 4'), 12);
  assert.equal(ev('3 · 4'), 12);
  assert.equal(ev('5 − 2'), 3);
});

test('파서: 함수와 인수 개수', () => {
  near(ev('exp(1)'), Math.E, 1e-12);
  assert.equal(ev('min(3, 1, 2)'), 1);
  assert.equal(ev('max(3, 1)'), 3);
  assert.equal(ev('sqrt(16)'), 4);
  assert.throws(() => K.parse('exp(1, 2)'), /인수 개수/);
  assert.throws(() => K.parse('mod(1)'), /인수 개수/);
  assert.throws(() => K.parse('min(1)'), /인수 개수/);
  assert.throws(() => K.parse('foo(1)'), /지원하지 않는 함수/);
});

test('파서: 오류 메시지', () => {
  assert.throws(() => K.parse(''), /비어/);
  assert.throws(() => K.parse('(1+2'), /닫는 괄호/);
  assert.throws(() => K.parse('1+'), /중간에 끝/);
  assert.throws(() => K.parse('a b'), /곱셈은 \* 로/);
  assert.throws(() => K.parse('1 $ 2'), /사용할 수 없는 문자/);
});

test('collectVars / mapVars / flatten', () => {
  const ast = K.parse('Q_h*(C_b - C_h/Kp_h) + exp(-k*t)');
  assert.deepEqual([...K.collectVars(ast)].sort(), ['C_b', 'C_h', 'Kp_h', 'Q_h', 'k', 't']);
  const renamed = K.mapVars(ast, (n) => (n.n === 'Kp_h' ? { t: 'var', n: 'K' } : n));
  assert.ok(K.collectVars(renamed).has('K') && !K.collectVars(renamed).has('Kp_h'));
  const terms = K.flatten(K.parse('a - b + -c - (d - e)'), 1, []);
  assert.deepEqual(terms.map((x) => x.sign), [1, -1, -1, -1, 1]);
});

test('toText: 왕복 후 AST가 같고 괄호는 필요한 곳에만', () => {
  const cases = ['-ka*t', 'x - -a*b', 'x^(-a*b)', '-(a+b)*c', 'Q_h*(C_b - C_h/Kp_h)', 'a + b*c', '(a + b)*c', 'a - (b - c)', 'a/(b*c)', '-(a + b)', 'a^(b + c)', '(a/b)^2', 'exp(-ka*t)', '2*a*b'];
  for (const s of cases) {
    const a = K.parse(s), txt = K.toText(a), b = K.parse(txt);
    assert.deepEqual(b, a, s + ' → ' + txt);
  }
  assert.equal(K.toText(K.parse('a + b*c')), 'a + b*c');
  assert.equal(K.toText(K.parse('(a + b)*c')), '(a + b)*c');
  assert.equal(K.toText(K.parse('a - (b - c)')), 'a - (b - c)');
  assert.equal(K.toText(K.parse('a - (b + c)')), 'a - (b + c)');
  assert.equal(K.toText(K.parse('(a + b) - c')), 'a + b - c');
  assert.equal(K.toText(K.parse('-ka*t')), '-ka*t');
  assert.equal(K.toText(K.parse('exp(-n_d*ka*tau)')), 'exp(-n_d*ka*tau)');
  assert.equal(K.toText(K.parse('a*(-b)')), 'a*(-b)');
  assert.equal(K.toText(K.parse('x - -a*b')), 'x - -a*b');
});

test('autoLatex: 아래첨자·그리스 문자·여러 글자 이름', () => {
  assert.equal(K.autoLatex('V_h'), 'V_{h}');
  assert.equal(K.autoLatex('Kp_h'), '\\mathit{Kp}_{h}');
  assert.equal(K.autoLatex('CL_int'), '\\mathit{CL}_{\\mathrm{int}}');
  assert.equal(K.autoLatex('V1'), 'V_{1}');
  assert.equal(K.autoLatex('alpha'), '\\alpha');
  assert.equal(K.autoLatex('k_alpha'), 'k_{\\alpha}');
  assert.equal(K.autoLatex('Q_h_2'), 'Q_{h,2}');
  assert.equal(K.autoLatex('t'), 't');
});

test('texNum: 정수·소수·지수 표기', () => {
  assert.equal(K.texNum(3), '3');
  assert.equal(K.texNum(-12), '-12');
  assert.equal(K.texNum(0.25), '0.25');
  assert.equal(K.texNum(3.14159265), '3.142');
  assert.equal(K.texNum(1e-5), '1\\times 10^{-5}');
  assert.equal(K.texNum(1234567), '1.235\\times 10^{6}');
  assert.equal(K.texNum(0.000123), '1.23\\times 10^{-4}');
});

test('toTex: 분수·괄호·곱셈 구분자', () => {
  const ctx = { cdot: false, label: K.autoLatex };
  assert.equal(K.toTex(K.parse('Q_h*(C_b - C_h/Kp_h)'), 0, ctx), 'Q_{h} \\, \\left(C_{b} - \\frac{C_{h}}{\\mathit{Kp}_{h}}\\right)');
  assert.equal(K.toTex(K.parse('2*a'), 0, ctx), '2 \\, a');
  assert.equal(K.toTex(K.parse('a*2'), 0, ctx), 'a \\cdot 2', '숫자가 뒤에 오면 cdot');
  assert.equal(K.toTex(K.parse('a*b'), 0, { cdot: true, label: K.autoLatex }), 'a \\cdot b');
  assert.equal(K.toTex(K.parse('exp(-ka*t)'), 0, ctx), 'e^{-\\mathit{ka} \\, t}');
  assert.equal(K.toTex(K.parse('(a/b)^2'), 0, ctx), '\\left(\\frac{a}{b}\\right)^{2}');
  assert.equal(K.toTex(K.parse('a + -b'), 0, ctx), 'a - b');
  assert.equal(K.toTex(K.parse('a + -b*c'), 0, ctx), 'a - b \\, c');
  assert.equal(K.toTex(K.parse('a*(-b)'), 0, ctx), 'a \\, \\left(-b\\right)', '뒤쪽 음수 인수는 괄호 유지');
  assert.equal(K.toTex(K.parse('-(a+b)*c'), 0, ctx), '-\\left(a + b\\right) \\, c');
  assert.equal(K.toTex(K.parse('sqrt(x)'), 0, ctx), '\\sqrt{x}');
  assert.equal(K.toTex(K.parse('a^b^c'), 0, ctx), 'a^{b^{c}}');
});

test('fmt: 유효숫자와 지수 표기', () => {
  assert.equal(K.fmt(0), '0');
  assert.equal(K.fmt(3.14159), '3.142');
  assert.equal(K.fmt(3.14159, 2), '3.1');
  assert.equal(K.fmt(0.000123), '1.23e-4');
  assert.equal(K.fmt(123456), '1.235e5');
  assert.equal(K.fmt(12345), '12350');
  assert.equal(K.fmt(NaN), 'NaN');
  assert.equal(K.num('abc'), 0);
  assert.equal(K.num('2.5'), 2.5);
});

/* ---------- 컴파일 + 적분 ---------- */
const model = (o) => Object.assign({ vars: [], eqs: [], doses: [], exps: [], cmps: [], sim: { t0: 0, tEnd: 1, tunit: 'h', rtol: 1e-7 } }, o);
const P = (vars) => Object.fromEntries(vars.filter((v) => v.kind === 'param').map((v) => [v.name, v.value]));
const pv = (name, value) => ({ name, kind: 'param', value, expr: String(value) });
const fv = (name, expr) => ({ name, kind: 'func', value: 0, expr });

test('compile+integrate: dy/dt = -k y 는 e^{-kt} 와 1e-6 이내', () => {
  const M = model({ vars: [pv('k', 0.7)], eqs: [{ state: 'y', cap: '1', ic: 1, terms: [{ sign: -1, on: true, expr: 'k*y' }] }] });
  const C = make(M).compile();
  assert.deepEqual(C.errors, []);
  const r = K.integrate(C.f, P(M.vars), [1], 0, 5, 1e-8);
  assert.equal(r.warn, null);
  for (let i = 0; i < r.T.length; i += 7) near(r.Y[i][0], Math.exp(-0.7 * r.T[i]), 1e-6, 't=' + r.T[i]);
  assert.equal(r.T[r.T.length - 1], 5);
});

test('compile: 좌변 계수(용량항), 식 변수 인라인, 꺼진 항, 순환 참조', () => {
  const M = model({
    vars: [pv('V', 2), pv('k', 1), fv('kV', 'k*V')],
    eqs: [{ state: 'C', cap: 'V', ic: 4, terms: [{ sign: -1, on: true, expr: 'kV*C' }, { sign: 1, on: false, expr: '999' }] }],
  });
  const C = make(M).compile();
  assert.deepEqual(C.errors, []);
  // V dC/dt = -(k V) C  →  dC/dt = -k C = -4
  assert.deepEqual(C.f(0, [4], P(M.vars)), [-4]);
  const bad = model({ vars: [fv('a', 'b+1'), fv('b', 'a+1')], eqs: [{ state: 'y', cap: '1', ic: 0, terms: [{ sign: 1, on: true, expr: 'a' }] }] });
  assert.ok(make(bad).compile().errors.some((e) => /순환 참조/.test(e)));
  const undef = model({ vars: [], eqs: [{ state: 'y', cap: '1', ic: 0, terms: [{ sign: 1, on: true, expr: 'zzz' }] }] });
  const Cu = make(undef).compile();
  assert.deepEqual(Cu.errors, []);
  assert.ok(Cu.warns.some((w) => /정의되지 않은 변수/.test(w)));
  assert.deepEqual(Cu.f(0, [0], {}), [0]);
});

test('compile: 문법 오류는 방정식/항 번호와 함께 보고', () => {
  const M = model({ vars: [], eqs: [{ state: 'y', cap: '1', ic: 0, terms: [{ sign: 1, on: true, expr: '(1+' }] }] });
  const C = make(M).compile();
  assert.equal(C.errors.length, 1);
  assert.match(C.errors[0], /방정식 1 항 1/);
});

test('투약: 반복 경구 1구획 모델이 중첩 원리 해석해와 1e-4 이내', () => {
  // dA/dt = -ka A ; V dC/dt = ka A - CL C ;  F·D 를 τ 마다 n번 A 에 더한다
  const ka = 1.2, V = 10, CL = 2, F = 0.8, D = 100, tau = 12, n = 3;
  const M = model({
    vars: [pv('ka', ka), pv('V', V), pv('CL', CL), pv('F', F), pv('D', D), pv('tau', tau), pv('n_d', n)],
    eqs: [
      { state: 'A', cap: '1', ic: 0, terms: [{ sign: -1, on: true, expr: 'ka*A' }] },
      { state: 'C', cap: 'V', ic: 0, terms: [{ sign: 1, on: true, expr: 'ka*A' }, { sign: -1, on: true, expr: 'CL*C' }] },
    ],
    doses: [{ on: true, target: 'A', amt: 'F*D', start: '0', tau: 'tau', n: 'n_d' }],
    sim: { t0: 0, tEnd: 48, rtol: 1e-8 },
  });
  const C = make(M).compile();
  assert.deepEqual(C.errors, []);
  const Pm = P(M.vars);
  const E = K.makeEvents(C, Pm, 2, 0, 48);
  assert.deepEqual(E.warn, []);
  assert.deepEqual(E.ev.map((e) => e.t), [0, 12, 24]);
  const r = K.integrateEvents(C, Pm, [0, 0], 0, 48, 1e-8, E.ev);
  assert.equal(r.warn, null);
  const ke = CL / V;
  const analytic = (t) => {
    let s = 0;
    for (let k = 0; k < n; k++) { const tp = t - k * tau; if (tp >= 0) s += (F * D * ka) / (V * (ka - ke)) * (Math.exp(-ke * tp) - Math.exp(-ka * tp)); }
    return s;
  };
  // 적분기의 스텝 지점에서 비교한다 (스텝 사이 선형 보간 오차는 적분 오차보다 훨씬 크다)
  for (let i = 0; i < r.T.length; i += 5) near(r.Y[i][1], analytic(r.T[i]), 1e-6, 't=' + r.T[i]);
  // 스텝 사이 선형 보간은 1e-3 안쪽 (앱의 비교 지표 ✓ 기준 0.1% 와 같은 수준)
  for (const t of [1, 6, 12.5, 23, 30, 47.9]) near(K.interp(r.T, r.Y, 1, t), analytic(t), 1e-3 * analytic(t) + 1e-6, '보간 t=' + t);
  // 질량 보존: 들어간 양 = 몸 안 양 + 제거된 양 (제거 적분은 사다리꼴)
  const last = r.T.length - 1;
  let elim = 0;
  for (let i = 1; i <= last; i++) elim += (r.Y[i][1] + r.Y[i - 1][1]) / 2 * CL * (r.T[i] - r.T[i - 1]);
  near(r.Y[last][0] + r.Y[last][1] * V + elim, F * D * n, 1e-2, '질량 보존');
});

test('makeEvents: 구간 밖 투약 제외, 횟수 상한과 τ 검증 경고', () => {
  const M = model({ vars: [], eqs: [{ state: 'A', cap: '1', ic: 0, terms: [] }],
    doses: [{ on: true, target: 'A', amt: '1', start: '-5', tau: '10', n: '3' }, { on: false, target: 'A', amt: '1', start: '0', tau: '1', n: '1' }] });
  const C = make(M).compile();
  assert.deepEqual(K.makeEvents(C, {}, 1, 0, 20).ev.map((e) => e.t), [5, 15]);
  const M2 = model({ vars: [], eqs: [{ state: 'A', cap: '1', ic: 0, terms: [] }], doses: [{ on: true, target: 'A', amt: '1', start: '0', tau: '0', n: '3' }] });
  const E2 = K.makeEvents(make(M2).compile(), {}, 1, 0, 20);
  assert.ok(E2.warn.some((w) => /τ는 0보다/.test(w)));
  assert.equal(E2.ev.length, 1);
  const M3 = model({ vars: [], eqs: [{ state: 'A', cap: '1', ic: 0, terms: [] }], doses: [{ on: true, target: 'A', amt: '1', start: '0', tau: '0.001', n: '9999' }] });
  const E3 = K.makeEvents(make(M3).compile(), {}, 1, 0, 20);
  assert.ok(E3.warn.some((w) => /5000회/.test(w)));
  assert.equal(E3.ev.length, 5000);
  const M4 = model({ vars: [], eqs: [{ state: 'A', cap: '1', ic: 0, terms: [] }], doses: [{ on: true, target: 'nope', amt: '1', start: '0', tau: '1', n: '1' }] });
  assert.ok(make(M4).compile().errors.some((e) => /대상 상태 변수/.test(e)));
});

test('integrate: 발산·강성 상황에서 멈추고 경고를 돌려준다', () => {
  const r = K.integrate((t, y) => [y[0] * y[0]], {}, [1], 0, 5, 1e-7); // y' = y², t=1 에서 폭발
  assert.ok(r.warn, '경고가 있어야 한다');
  assert.ok(r.T[r.T.length - 1] <= 1.0001);
});

test('interp1 / interp / parseData', () => {
  const T = [0, 1, 2], V = [0, 10, 0];
  assert.equal(K.interp1(T, V, 0.5), 5);
  assert.equal(K.interp1(T, V, -1), 0);
  assert.equal(K.interp1(T, V, 9), 0);
  assert.equal(K.interp(T, [[0, 1], [10, 2], [0, 3]], 1, 1.5), 2.5);
  assert.deepEqual(K.parseData('0, 1\n1\t2.5\n# 주석\n2 ; 4\nx, y\n'), [{ t: 0, y: 1 }, { t: 1, y: 2.5 }, { t: 2, y: 4 }]);
});

test('windowStats: 선형 구간의 AUC·최댓값·임계값 초과 시간', () => {
  // V(t) = 10 t  (0..10)
  const T = [0, 5, 10], V = [0, 50, 100];
  const r = K.windowStats(T, V, 2, 8, [30, 90]);
  near(r.auc, 300, 1e-9);  // ∫2..8 10t dt = 5(64-4) = 300
  assert.equal(r.mx, 80);
  near(r.above[0], 5, 1e-9); // t ≥ 3 → 3..8
  assert.equal(r.above[1], 0);
});

test('cmpMetrics: 완전 일치면 오차 0, R²=1, AFE=1', () => {
  const T = [0, 1, 2, 3], sv = [1, 2, 4, 8];
  const m = K.cmpMetrics(T.map((t, i) => ({ t, y: sv[i] })), T, sv);
  assert.equal(m.n, 4);
  assert.equal(m.rmse, 0);
  assert.equal(m.maxR, 0);
  assert.equal(m.r2, 1);
  near(m.afe, 1, 1e-12);
  const m2 = K.cmpMetrics([{ t: 1, y: 1 }], T, sv); // 시뮬 2 vs 관측 1
  assert.equal(m2.maxA, 1);
  assert.equal(m2.maxR, 100);
  near(m2.afe, 2, 1e-12);
});

test('niceTicks / decadeTicks', () => {
  assert.deepEqual(K.niceTicks(0, 1, 5), [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.deepEqual(K.niceTicks(0, 7, 5), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(K.niceTicks(3, 3, 5), [3]);
  assert.deepEqual(K.decadeTicks(0.01, 100), [0.01, 0.1, 1, 10, 100]);
});
