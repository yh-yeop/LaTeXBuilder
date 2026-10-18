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
    'compile', 'integrate', 'integrateStiff', 'makeEvents', 'integrateEvents', 'interp1', 'parseData', 'cmpMetrics', 'windowStats', 'interp', 'niceTicks', 'decadeTicks',
    'nelderMead', 'nelderMeadIter', 'fitProblem', 'parseUnit', 'unitText', 'inferUnit', 'checkUnits',
    'b64urlEncode', 'b64urlDecode', 'encodeShare', 'decodeShare', 'plotToSvg', 'genPython', 'genR', 'genJulia', 'genSBML'];
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

/* ---------- 강성 적분기 (Rodas3) · 자동 전환 ---------- */
test('integrateStiff: y\' = -1000(y - cos t) 가 해석해와 1e-4 이내 (3차 정확도)', () => {
  const lam = 1000;
  const exact = (t) => (lam * lam * Math.cos(t) + lam * Math.sin(t)) / (1 + lam * lam) - lam * lam / (1 + lam * lam) * Math.exp(-lam * t);
  const f = (t, y) => [-lam * (y[0] - Math.cos(t))];
  const r = K.integrateStiff(f, {}, [0], 0, 2, 1e-6, 400);
  assert.equal(r.warn, null);
  assert.equal(r.T[r.T.length - 1], 2);
  for (let i = 0; i < r.T.length; i++) near(r.Y[i][0], exact(r.T[i]), 1e-4, 't=' + r.T[i]);
  assert.ok(r.T.length < 2000, '스텝 수가 명시적 방법보다 훨씬 적어야 한다: ' + r.T.length);
  // 고정 최대 스텝(div)을 반으로 줄이면 오차가 약 1/8 (3차)
  const e = (div) => Math.abs(K.integrateStiff((t, y) => [-y[0]], {}, [1], 0, 1, 1e-1, div).Y.at(-1)[0] - Math.exp(-1));
  const ratio = e(100) / e(200);
  assert.ok(ratio > 5 && ratio < 12, '오차 비 ' + ratio);
});

test('integrateStiff: Robertson 문제가 빠르게 끝나고 참고값과 맞는다', () => {
  const rob = (t, y) => [-0.04 * y[0] + 1e4 * y[1] * y[2], 0.04 * y[0] - 1e4 * y[1] * y[2] - 3e7 * y[1] * y[1], 3e7 * y[1] * y[1]];
  const t0 = Date.now();
  const r = K.integrateStiff(rob, {}, [1, 0, 0], 0, 40, 1e-6, 400);
  assert.ok(Date.now() - t0 < 2000, '2초 안에 끝나야 한다');
  assert.equal(r.warn, null);
  const L = r.Y[r.Y.length - 1];
  near(L[0], 0.7158270687, 1e-5, 'y1'); near(L[1], 9.185534764e-6, 1e-8, 'y2'); near(L[2], 0.2841637457, 1e-5, 'y3');
  near(L[0] + L[1] + L[2], 1, 1e-8, '질량 보존');
});

test('integrateEvents: 자동 모드는 강성이 감지되면 강성 적분기로 바꾸고 stiff 를 돌려준다', () => {
  const lam = 1e5;
  const exact = (t) => (lam * lam * Math.cos(t) + lam * Math.sin(t)) / (1 + lam * lam) - lam * lam / (1 + lam * lam) * Math.exp(-lam * t);
  const C = { f: (t, y) => [-lam * (y[0] - Math.cos(t))], caps: [() => 1], doseFns: [] };
  const t0 = Date.now();
  const r = K.integrateEvents(C, {}, [0], 0, 2, 1e-6, []);
  assert.ok(Date.now() - t0 < 3000);
  assert.equal(r.warn, null);
  assert.equal(r.stiff, true);
  for (let i = 0; i < r.T.length; i += 3) near(r.Y[i][0], exact(r.T[i]), 1e-4, 't=' + r.T[i]);
  // 명시적 전용은 강성 감지를 하지 않는다 (스텝 상한까지 돌거나 끝남)
  const re = K.integrate(C.f, {}, [0], 0, 2, 1e-6, 400, { detect: true, maxSteps: 1000 });
  assert.ok(re.code === 'stiff' || re.code === 'steps');
  const ok = K.integrateEvents(C, {}, [0], 0, 2, 1e-6, [], 'explicit');
  assert.equal(ok.stiff, false);
  // 비강성 문제는 자동 모드에서도 명시적 방법으로 끝난다
  const r2 = K.integrateEvents({ f: (t, y) => [-0.7 * y[0]], caps: [() => 1], doseFns: [] }, {}, [1], 0, 5, 1e-8, []);
  assert.equal(r2.stiff, false);
  near(r2.Y.at(-1)[0], Math.exp(-3.5), 1e-6);
  // 'stiff' 를 지정하면 투약이 있어도 강성 적분기로 계산한다
  const r3 = K.integrateEvents({ f: (t, y) => [-0.7 * y[0]], caps: [() => 1], doseFns: [] }, {}, [0], 0, 2, 1e-8, [{ t: 0, i: 0, amt: 1 }, { t: 1, i: 0, amt: 1 }], 'stiff');
  assert.equal(r3.stiff, true);
  near(r3.Y.at(-1)[0], Math.exp(-1.4) + Math.exp(-0.7), 1e-6);
});

/* ---------- Nelder–Mead · 파라미터 추정 ---------- */
test('nelderMead: 2차 함수와 Rosenbrock 함수의 최소점으로 수렴', () => {
  const q = K.nelderMead((x) => (x[0] - 3) ** 2 + 2 * (x[1] + 1) ** 2 + 5, [0, 0], { maxIter: 500, tol: 1e-14, xtol: 1e-9 });
  near(q.x[0], 3, 1e-6); near(q.x[1], -1, 1e-6); near(q.fx, 5, 1e-10);
  const rosen = (x) => 100 * (x[1] - x[0] * x[0]) ** 2 + (1 - x[0]) ** 2;
  const r = K.nelderMead(rosen, [-1.2, 1], { maxIter: 5000, tol: 1e-14, xtol: 1e-8 });
  near(r.x[0], 1, 1e-4); near(r.x[1], 1, 1e-4);
  assert.ok(r.iter < 5000, '반복 상한 전에 수렴');
  // 반복자: onIter 가 false 를 돌려주면 멈춘다
  let n = 0;
  const s = K.nelderMead(rosen, [-1.2, 1], { maxIter: 5000, onIter: () => ++n < 10 });
  assert.equal(n, 10); assert.equal(s.iter, 10);
  const it = K.nelderMeadIter(rosen, [0, 0], { maxIter: 3 });
  assert.equal(it.next().done, false); it.next(); it.next();
  assert.equal(it.next().done, true);
});

test('fitProblem: 1구획 경구 모델의 ka, CL 을 실측 데이터로 복원', () => {
  const ka0 = 1.3, CL0 = 2.5, V = 10, D = 100;
  const data = [];
  for (const t of [0.5, 1, 2, 4, 6, 8, 12, 18, 24]) {
    const ke = CL0 / V;
    data.push(t + ', ' + (D * ka0 / (V * (ka0 - ke)) * (Math.exp(-ke * t) - Math.exp(-ka0 * t))));
  }
  const mk = (ka, CL) => model({
    vars: [Object.assign(pv('ka', ka), { min: 0.05, max: 5, log: true }), Object.assign(pv('CL', CL), { min: 0.2, max: 20 }), pv('V', V), pv('D', D)],
    eqs: [
      { state: 'A', cap: '1', ic: 0, terms: [{ sign: -1, on: true, expr: 'ka*A' }] },
      { state: 'C', cap: 'V', ic: 0, terms: [{ sign: 1, on: true, expr: 'ka*A' }, { sign: -1, on: true, expr: 'CL*C' }] },
    ],
    doses: [{ on: true, target: 'A', amt: 'D', start: '0', tau: '24', n: '1' }],
    cmps: [{ on: true, label: '실측', sim: 'C', kind: 'data', ref: '', data: data.join('\n') }, { on: true, label: '꺼진 기준식은 무시', sim: 'C', kind: 'ref', ref: '0', data: '' }],
    sim: { t0: 0, tEnd: 24, tunit: 'h', rtol: 1e-7 },
  });
  const Mx = mk(0.3, 8);
  const Kx = make(Mx);
  const F = Kx.fitProblem(Kx.compile(), ['ka', 'CL'], [true, false]);
  assert.deepEqual(F.logScale, [true, false]);
  const before = F.evaluate(F.toParams(F.x0));
  assert.ok(before.loss > 1);
  const r = Kx.nelderMead(F.loss, F.x0, { step: 0.15, maxIter: 300, tol: 1e-12, xtol: 1e-5 });
  const vals = F.toValues(r.x);
  near(vals[0], ka0, 2e-3, 'ka'); near(vals[1], CL0, 5e-3, 'CL');
  const after = F.evaluate(F.toParams(r.x));
  assert.ok(after.loss < 1e-6, 'loss ' + after.loss);
  assert.equal(after.sets.length, 1);
  assert.ok(after.sets[0].met.maxR < 0.5);
  // 경계 밖은 벌점으로 커진다
  assert.ok(F.loss([2, 0.5]) > F.loss([1, 0.5]));
  // 실측 데이터 비교가 없으면 오류
  const none = mk(1, 2); none.cmps = [];
  assert.throws(() => make(none).fitProblem(make(none).compile(), ['ka'], []), /실측 데이터/);
  assert.throws(() => Kx.fitProblem(Kx.compile(), ['nope'], []), /상수 변수/);
});

/* ---------- 단위 검사 ---------- */
test('parseUnit / unitText: 자주 쓰는 단위 문자열을 차원 벡터로', () => {
  assert.deepEqual(K.parseUnit('mg'), [1, 0, 0, 0]);
  assert.deepEqual(K.parseUnit('kg'), [1, 0, 0, 0]);
  assert.deepEqual(K.parseUnit('L'), [0, 1, 0, 0]);
  assert.deepEqual(K.parseUnit('mL'), [0, 1, 0, 0]);
  assert.deepEqual(K.parseUnit('h'), [0, 0, 1, 0]);
  assert.deepEqual(K.parseUnit('min'), [0, 0, 1, 0]);
  assert.deepEqual(K.parseUnit('µM'), [0, -1, 0, 1]);
  assert.deepEqual(K.parseUnit('uM'), [0, -1, 0, 1]);
  assert.deepEqual(K.parseUnit('1/h'), [0, 0, -1, 0]);
  assert.deepEqual(K.parseUnit('h^-1'), [0, 0, -1, 0]);
  assert.deepEqual(K.parseUnit('h-1'), [0, 0, -1, 0]);
  assert.deepEqual(K.parseUnit('mg/L'), [1, -1, 0, 0]);
  assert.deepEqual(K.parseUnit('L/h'), [0, 1, -1, 0]);
  assert.deepEqual(K.parseUnit('mg/L/h'), [1, -1, -1, 0]);
  assert.deepEqual(K.parseUnit('L/h/kg'), [-1, 1, -1, 0]);
  assert.deepEqual(K.parseUnit('ng·h/mL'), [1, -1, 1, 0]);
  assert.deepEqual(K.parseUnit('µM·h'), [0, -1, 1, 1]);
  assert.deepEqual(K.parseUnit('mg/kg'), [0, 0, 0, 0]);
  assert.deepEqual(K.parseUnit('-'), [0, 0, 0, 0]);
  assert.deepEqual(K.parseUnit('%BW'), [0, 0, 0, 0]);
  assert.deepEqual(K.parseUnit('회'), [0, 0, 0, 0]);
  assert.equal(K.parseUnit(''), null, '빈 단위는 모름');
  assert.equal(K.parseUnit('furlong'), null);
  assert.equal(K.parseUnit('mg/zz'), null);
  assert.equal(K.unitText([1, -1, -1, 0]), 'mg/L/h');
  assert.equal(K.unitText([0, 0, -1, 0]), '1/h');
  assert.equal(K.unitText([0, 0, 0, 0]), '-');
  assert.equal(K.unitText([1, 0, 1, 0]), 'mg·h');
  assert.equal(K.unitText([0, 2, 0, 0]), 'L^2');
});

test('inferUnit: 사칙연산·거듭제곱·함수 규칙', () => {
  const U = { Q: K.parseUnit('L/h'), C: K.parseUnit('mg/L'), V: K.parseUnit('L'), k: K.parseUnit('1/h'), Kp: K.parseUnit('-'), A: K.parseUnit('mg') };
  const inf = (s) => K.inferUnit(K.parse(s), (n) => U[n] || null);
  assert.deepEqual(inf('Q*(C - C/Kp)'), [1, 0, -1, 0]);
  assert.deepEqual(inf('A/V'), [1, -1, 0, 0]);
  assert.deepEqual(inf('V^2'), [0, 2, 0, 0]);
  assert.deepEqual(inf('V^-1'), [0, -1, 0, 0]);
  assert.deepEqual(inf('sqrt(V^2)'), [0, 1, 0, 0]);
  assert.deepEqual(inf('exp(-k*t)'), [0, 0, 0, 0]);
  assert.deepEqual(inf('k*t + 1'), [0, 0, 0, 0]);
  assert.deepEqual(inf('min(A, 2*A)'), [1, 0, 0, 0]);
  assert.deepEqual(inf('abs(-A)'), [1, 0, 0, 0]);
  assert.deepEqual(inf('step(t - 24)*A'), [1, 0, 0, 0]);
  assert.deepEqual(inf('Q*(t - 24)'), [0, 1, 0, 0], '숫자는 어느 단위든 될 수 있다');
  assert.deepEqual(inf('A*(1 + 2)'), [1, 0, 0, 0]);
  assert.equal(inf('3').any, true);
  assert.equal(inf('Q*2').any, undefined);
  assert.deepEqual(inf('min(A, 1e-9)'), [1, 0, 0, 0]);
  assert.equal(inf('A*zz'), null, '모르는 변수가 곱해지면 모름');
  assert.deepEqual(inf('A + zz'), [1, 0, 0, 0], '덧셈은 아는 쪽의 단위');
  assert.equal(inf('A^Kp'), null, '지수가 수가 아니면 모름');
  assert.throws(() => inf('A + V'), /단위가 다릅니다/);
  assert.throws(() => inf('exp(A)'), /무차원/);
  assert.throws(() => inf('A^V'), /지수는 무차원/);
  assert.throws(() => inf('min(A, V)'), /서로 다릅니다/);
});

test('checkUnits: 방정식 항의 단위가 좌변과 다르면 경고, 모르는 단위는 건너뜀', () => {
  const pvu = (name, value, unit) => Object.assign(pv(name, value), { unit });
  const good = model({
    vars: [pvu('V_h', 1.5, 'L'), pvu('Q_h', 90, 'L/h'), pvu('C_b', 10, 'mg/L'), pvu('Kp_h', 5, '-'), pvu('CL_int', 30, 'L/h')],
    eqs: [{ state: 'C_h', cap: 'V_h', ic: 0, unit: 'mg/L', terms: [{ sign: 1, on: true, expr: 'Q_h*(C_b - C_h/Kp_h)' }, { sign: -1, on: true, expr: 'CL_int*(C_h/Kp_h)' }] }],
  });
  assert.deepEqual(make(good).checkUnits(), []);
  const bad = model({
    vars: [pvu('V_h', 1.5, 'L'), pvu('Q_h', 90, 'L/h'), pvu('C_b', 10, 'mg/L'), pvu('Kp_h', 5, '-'), pvu('k', 1, '1/h'), pvu('x', 1, '')],
    eqs: [{ state: 'C_h', cap: 'V_h', ic: 0, unit: 'mg/L', terms: [
      { sign: 1, on: true, expr: 'Q_h*(C_b - C_h/Kp_h)' },
      { sign: -1, on: true, expr: 'k*C_h' },            // mg/L/h ≠ mg/h
      { sign: 1, on: true, expr: 'x*C_h' },             // x 단위 모름 → 건너뜀
      { sign: 1, on: false, expr: 'Q_h' },              // 꺼진 항 → 건너뜀
      { sign: 1, on: true, expr: 'C_b + Q_h' },         // 덧셈 불일치
      { sign: 1, on: true, expr: 'exp(C_b)' },          // 함수 인수
    ] }],
  });
  const w = make(bad).checkUnits();
  assert.equal(w.length, 3, w.join(' | '));
  assert.match(w[0], /방정식 1 항 2: mg\/h 이어야 하는데 mg\/L\/h/);
  assert.match(w[1], /방정식 1 항 5: .*단위가 다릅니다/);
  assert.match(w[2], /방정식 1 항 6: exp\(\)의 인수는 무차원/);
  // 식 변수의 단위가 비어 있으면 식에서 추론한다; 상태 단위를 모르면 그 방정식은 건너뛴다
  const inferred = model({
    vars: [pvu('CL_kg', 0.4, 'L/h/kg'), pvu('BW', 3.5, 'kg'), fv('CL', 'CL_kg*BW'), pvu('V', 10, 'L')],
    eqs: [{ state: 'A', cap: '1', ic: 0, unit: 'mg', terms: [{ sign: -1, on: true, expr: 'CL*A/V' }, { sign: -1, on: true, expr: 'CL*A' }] },
      { state: 'B', cap: '1', ic: 0, unit: '', terms: [{ sign: 1, on: true, expr: 'V' }] }],
  });
  const w2 = make(inferred).checkUnits();
  assert.equal(w2.length, 1);
  assert.match(w2[0], /방정식 1 항 2: mg\/h 이어야 하는데 mg·L\/h/);
});

/* ---------- 공유 링크 ---------- */
test('encodeShare / decodeShare: 압축(z.)과 비압축(j.) 모두 왕복', async () => {
  const obj = { vars: [{ name: 'V_h', value: 1.5, unit: 'L', note: '한글 메모 · µM' }], eqs: [{ state: 'C_h', terms: [{ expr: 'Q_h*(C_b - C_h/Kp_h)' }] }], sim: { t0: 0, tEnd: 0.5 } };
  const z = await K.encodeShare(obj);
  assert.match(z, /^z\.[A-Za-z0-9_-]+$/, 'Node 22 에는 CompressionStream 이 있으므로 압축 경로');
  assert.deepEqual(await K.decodeShare(z), obj);
  const j = 'j.' + K.b64urlEncode(new TextEncoder().encode(JSON.stringify(obj)));
  assert.deepEqual(await K.decodeShare(j), obj);
  assert.deepEqual([...K.b64urlDecode(K.b64urlEncode(new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255])))], [0, 1, 2, 250, 251, 252, 253, 254, 255]);
  // 큰 모델은 압축이 훨씬 짧다
  const big = { eqs: Array.from({ length: 20 }, (_, i) => ({ state: 'C_' + i, terms: [{ expr: 'Q_h*(C_b - C_' + i + '/Kp_h)' }] })) };
  const zb = await K.encodeShare(big);
  assert.ok(zb.length < JSON.stringify(big).length / 3, zb.length + ' vs ' + JSON.stringify(big).length);
  await assert.rejects(() => K.decodeShare('x.abc'), /형식/);
  await assert.rejects(() => K.decodeShare('j.' + K.b64urlEncode(new TextEncoder().encode('{bad'))));
});

/* ---------- 그래프 SVG ---------- */
function xmlBalanced(xml) {
  const body = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const stack = [];
  for (const m of body.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)[^<>]*?(\/?)>/g)) {
    if (m[1]) { if (stack.pop() !== m[2]) return false; } else if (!m[3]) stack.push(m[2]);
  }
  return stack.length === 0 && !/[<>]/.test(body.replace(/<[^<>]*>/g, ''));
}
test('plotToSvg: 유효한 XML, polyline 수 = 시리즈 수, 점·눈금·투약 표시', () => {
  const T = [0, 1, 2, 3];
  const d = { W: 600, H: 340, L: 56, Tp: 12, pw: 530, ph: 292, xmin: 0, xmax: 3, ymin: 0, ymax: 10, logY: false,
    xTicks: [0, 1, 2, 3], yTicks: [0, 5, 10], xLabel: 't [h] <&>', events: [0, 1.5, 9],
    series: [{ T, y: [1, 2, 4, 8], color: '#3a62e0', w: 2.4 }, { T, y: [8, NaN, 2, 1], color: '#e5484d', w: 2, dash: [5, 4] }],
    marks: [{ color: '#0b7285', pts: [{ t: 0.5, y: 2 }, { t: 2.5, y: 6 }] }], colors: { bg: '#ffffff', text: '#111', muted: '#667', grid: '#ddd', border: '#ccc' } };
  const svg = K.plotToSvg(d);
  assert.ok(xmlBalanced(svg), 'XML 균형');
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.equal((svg.match(/<polyline /g) || []).length, 2);
  assert.equal((svg.match(/<circle /g) || []).length, 2);
  assert.equal((svg.match(/<path /g) || []).length, 2, '구간 안의 투약 시점만');
  assert.ok(svg.includes('t [h] &lt;&amp;&gt;'));
  assert.equal((svg.match(/<text /g) || []).length, 4 + 3 + 1);
  // 두 번째 시리즈의 NaN 점은 빠진다 (3점)
  const pl = svg.match(/<polyline points="([^"]*)"/g);
  assert.equal(pl[1].split('"')[1].split(' ').length, 3);
  // 로그 축에서 0 이하 값은 빠진다
  const lg = K.plotToSvg(Object.assign({}, d, { logY: true, ymin: 1, ymax: 10, yTicks: [1, 10], series: [{ T, y: [0, 1, 10, -1], color: '#000' }] }));
  assert.equal(lg.match(/<polyline points="([^"]*)"/)[1].split(' ').length, 2);
});

/* ---------- 코드 내보내기 ---------- */
const exportModel = () => model({
  vars: [Object.assign(pv('V_h', 1.5), { unit: 'L' }), pv('Q_h', 90), pv('C_b', 10), pv('Kp_h', 5), pv('CL_int', 30), pv('D', 100), fv('kV', 'Q_h/V_h')],
  eqs: [
    { state: 'C_h', cap: 'V_h', ic: 0, unit: 'mg/L', terms: [{ sign: 1, on: true, expr: 'Q_h*(C_b - C_h/Kp_h)' }, { sign: -1, on: true, expr: 'CL_int*(C_h/Kp_h)' }, { sign: 1, on: false, expr: '999' }] },
    { state: 'A', cap: '1', ic: 2, unit: 'mg', terms: [{ sign: -1, on: true, expr: 'kV*A*exp(-0.1*t)' }, { sign: 1, on: true, expr: 'step(t-1)*min(A, 1e-7)' }] },
  ],
  doses: [{ on: true, target: 'A', amt: 'D', start: '0', tau: '2', n: '3' }, { on: true, target: 'C_h', amt: 'D/2', start: '1', tau: '1', n: '1' }],
  sim: { t0: 0, tEnd: 6, tunit: 'h', rtol: 1e-7 },
});
test('genPython / genR / genJulia: 상태·상수·식 변수·투약이 코드에 들어간다', () => {
  const Mx = exportModel(); const Kx = make(Mx);
  for (const [name, src] of [['py', Kx.genPython()], ['R', Kx.genR()], ['jl', Kx.genJulia()]]) {
    for (const s of ['C_h', 'A', 'V_h', 'Q_h', 'Kp_h', 'CL_int', 'kV']) assert.ok(new RegExp('\\b' + s + '\\b').test(src), name + ' 에 ' + s);
    assert.ok(!/\b999\b/.test(src), name + ': 꺼진 항은 제외');
    assert.ok(src.includes('exp('), name);
  }
  const py = Kx.genPython();
  assert.ok(py.includes('solve_ivp') && py.includes('def rhs(t, y):') && py.includes('1.0 if (t - 1) >= 0'));
  const R = Kx.genR();
  assert.ok(R.includes('library(deSolve)') && R.includes('ode(') && R.includes('method = "add"'));
  assert.match(R, /time = c\(0, 1, 2, 4\)/);
  assert.match(R, /value = c\(100, 33\.3333\d*, 100, 100\)/);  // D/2 ÷ V_h
  assert.match(R, /V_h = 1\.5,   # L\n/);
  assert.ok(R.includes('ifelse((t - 1) >= 0, 1, 0)'));
  const jl = Kx.genJulia();
  assert.ok(jl.includes('using DifferentialEquations') && jl.includes('function rhs!(du, u, p, t)') && jl.includes('ODEProblem('));
  assert.match(jl, /PresetTimeCallback\(\[0\.0, 2\.0, 4\.0\], integ -> \(integ\.u\[2\] \+= 100\.0\)\)/);
  assert.match(jl, /V_h = 1\.5,/);
  assert.ok(jl.includes('u0 = [0.0, 2.0]'));
  // 오류가 있으면 주석으로 알린다
  const bad = exportModel(); bad.eqs[0].terms[0].expr = '(1+';
  assert.match(make(bad).genPython(), /^# 식에 오류/); assert.match(make(bad).genR(), /^# 식에 오류/); assert.match(make(bad).genJulia(), /^# 식에 오류/);
});

test('genSBML: 유효한 XML 이고 species·parameter·rateRule·event 가 있다', () => {
  const Mx = exportModel(); const Kx = make(Mx);
  const x = Kx.genSBML();
  assert.ok(xmlBalanced(x), 'XML 균형');
  assert.ok(x.startsWith('<?xml version="1.0"'));
  assert.ok(x.includes('level="3" version="2"'));
  assert.equal((x.match(/<compartment /g) || []).length, 1);
  assert.ok(x.includes('<species id="C_h"') && x.includes('<species id="A"') && x.includes('initialAmount="2"'));
  for (const p of ['V_h', 'Q_h', 'Kp_h', 'CL_int', 'D']) assert.ok(x.includes('<parameter id="' + p + '" value='), p);
  assert.ok(x.includes('<parameter id="kV" constant="false"/>') && x.includes('<assignmentRule variable="kV">'));
  assert.equal((x.match(/<rateRule /g) || []).length, 2);
  assert.equal((x.match(/<event /g) || []).length, 4);
  assert.ok(x.includes('definitionURL="http://www.sbml.org/sbml/symbols/time"'));
  assert.ok(x.includes('<piecewise>') && x.includes('<apply><min/>') && x.includes('<cn type="e-notation">1<sep/>-7</cn>'));
  assert.ok(!x.includes('999'));
  const bad = exportModel(); bad.eqs[0].terms[0].expr = '(1+';
  assert.match(make(bad).genSBML(), /^<!-- 식에 오류/);
});
