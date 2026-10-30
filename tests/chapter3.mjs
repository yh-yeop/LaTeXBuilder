// 챕터 3 검증 (바이러스 확산 → 약물 작용 → PBPK 연결 → 염증·복수 → 치료 기간).
//   node tests/chapter3.mjs          모두 통과해야 exit 0
//   node tests/chapter3.mjs --show   단계별 "지금 결과 읽기" 문장도 출력
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { app, runModel } from './harness.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
new Function(readFileSync(path.join(dir, '..', 'chapter3', 'stages.js'), 'utf8'))();
const C3 = globalThis.Ch3({ PV: app.PV, FV: app.FV, T_: app.T_, ORG: app.ORG, normalize: app.normalize, presets: { m1: app.presets.m1 } });

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log((ok ? '✓ ' : '✗ ') + name + ' — ' + detail); };
const e = x => x.toExponential(2);

// 단계를 불러와 화면과 같은 순서로 계산한다. over로 상수를 덮어쓸 수 있다
function stage(key, over, tEnd) {
  const m = C3.presets[key]();
  app.applyMeta(m, key);
  if (over) for (const [k, v] of Object.entries(over)) { const x = m.vars.find(z => z.name === k); x.value = v; x.expr = String(v); }
  if (tEnd) m.sim.tEnd = tEnd;   // 화면 기본 기간보다 길게 돌려 수렴을 확인할 때
  const r = runModel(m);
  r.col = s => { const i = m.eqs.findIndex(q => q.state === s); return r.main.Y.map(y => y[i]); };
  r.T = r.main.T;
  return r;
}
const R0of = P => P.beta_V * P.p_V * P.T0_m / (P.delta_I * P.c_V);

// 1. 3-1 초기 확산 해석해 (표적 세포를 고정한 선형 근사)
{
  const r = stage('v1'), P = r.P;
  const sg = P.delta_I + P.c_V, disc = Math.sqrt((P.delta_I - P.c_V) ** 2 + 4 * P.beta_V * P.T0_m * P.p_V);
  const l1 = (-sg + disc) / 2, l2 = (-sg - disc) / 2;
  const f = t => P.V0_v / (l1 - l2) * ((l1 + P.delta_I) * Math.exp(l1 * t) - (l2 + P.delta_I) * Math.exp(l2 * t));
  const V = r.col('V_l');
  let worst = 0;
  r.T.forEach((t, k) => { const y = f(t); if (y > 0) worst = Math.max(worst, Math.abs(V[k] - y) / y); });
  check('3-1 초기 확산 해석해 (V_lin)', worst < 1e-9, `적분 시점 ${r.T.length}개, 최대 상대오차 ${e(worst)} (기준 1e-9), 화면 비교 ${r.cmp[0].met.maxR.toExponential(2)}%`);
  check('3-1 화면 해석해 비교 ✓', r.cmp[0].met.maxR < 0.1, `최대 상대오차 ${r.cmp[0].met.maxR.toExponential(2)}% (기준 0.1%)`);

  // 감염 정상상태 닫힌 식: T* = T0/R0, I* = s(1 − 1/R0)/δ, V* = p·I*/c (화면 기본 30일은 아직 수렴 중이라 120일로 확인)
  const R0 = R0of(P), Ts = P.T0_m / R0, Is = P.d_T * P.T0_m * (1 - 1 / R0) / P.delta_I, Vs = P.p_V * Is / P.c_V;
  const lg = stage('v1', null, 2880);
  const d = Math.max(Math.abs(lg.col('T_m').at(-1) / Ts - 1), Math.abs(lg.col('I_m').at(-1) / Is - 1), Math.abs(lg.col('V_v').at(-1) / Vs - 1));
  check('3-1 끝값 → 감염 정상상태 닫힌 식', d < 1e-3, `R_0 ${R0.toFixed(4)}, T* ${Ts.toFixed(4)} · I* ${Is.toFixed(4)} · V* ${Vs.toFixed(3)}, 최대 상대차 ${e(d)} (120일, 기준 1e-3)`);
}

// 2. R_0 < 1이면 감염이 사라진다 (β를 1/8로)
{
  const r = stage('v1', { beta_V: 1e-5 }, 2880), V = r.col('V_v');
  const mono = V.every((v, k) => k === 0 || v <= V[k - 1] * (1 + 1e-9));
  check('3-1 R_0 < 1이면 바이러스 소멸', R0of(r.P) < 1 && mono && V.at(-1) < V[0] * 1e-6, `R_0 ${R0of(r.P).toFixed(4)}, 단조 감소, V ${V[0].toFixed(3)} → ${V.at(-1).toExponential(2)} (120일)`);
}

// 3. 3-2 치료 임계 ε_crit = 1 − 1/R_0 (임계 바로 아래·위에서 방향이 갈리는지)
{
  // 임계를 넘으면 바이러스가 사라지고, 못 넘으면 0이 아닌 새 정상상태 V' = p(1−ε)·s(1−1/R_0,eff)/(δ·c)에 머문다
  const base = stage('v2'), P = base.P, R0 = R0of(P), crit = 1 - 1 / R0;
  const Cof = eps => P.EC50_d * Math.pow(eps / (P.Emax_d - eps), 1 / P.hill_d);
  const epsLo = crit * 0.9, epsHi = Math.min(0.99 * P.Emax_d, crit * 1.1);
  const lo = stage('v2', { C_drug: Cof(epsLo) }, 5000), hi = stage('v2', { C_drug: Cof(epsHi) }, 5000);
  const vl = lo.col('V_v'), vh = hi.col('V_v');
  const Re = R0 * (1 - epsLo), Vnew = P.p_V * (1 - epsLo) * (P.d_T * P.T0_m * (1 - 1 / Re) / P.delta_I) / P.c_V;
  const okLo = Math.abs(vl.at(-1) / Vnew - 1) < 0.01, okHi = vh.at(-1) < vh[0] * 1e-6;
  check('3-2 치료 임계 ε > 1 − 1/R_0', okLo && okHi,
    `ε_crit ${crit.toFixed(4)} · 임계의 0.9배 → 새 정상상태 ${Vnew.toFixed(3)} 예상, 결과 ${vl.at(-1).toFixed(3)} (사라지지 않음) · 1.1배 → ${vh.at(-1).toExponential(2)} (사라짐)`);

  // ε = 0이면 시작한 감염 정상상태에 그대로 머문다
  const off = stage('v2', { C_drug: 0 });
  const dd = Math.max(...['T_m', 'I_m', 'V_v'].map(s => { const X = off.col(s); return Math.max(...X.map(v => Math.abs(v / X[0] - 1))); }));
  check('3-2 약 없으면 정상상태 유지', dd < 1e-6, `T_m·I_m·V 최대 상대변화 ${e(dd)}`);
}

// 4. 3-3 PBPK 연결: 질량 보존 (약물)과 바이러스 감소
{
  const r = stage('v3'), m = r.M, C = r.C;
  const fs = C.expr(m.cmps[0].sim), fr = C.expr(m.cmps[0].ref);
  let mb = 0;
  r.T.forEach((t, k) => { if (k + 1 < r.T.length && r.T[k + 1] === t) return; mb = Math.max(mb, Math.abs(fs(t, r.main.Y[k], r.P) - fr(t, r.main.Y[k], r.P))); });
  check('3-3 질량 보존 (약물)', mb < 6e-4 && r.cmp[0].met.maxR < 0.1, `28회 투약, 최대 |총량 − 누적 투여| ${e(mb)} mg (기준 0.0006 mg)`);
  const V = r.col('V_v');
  check('3-3 기준 용량에서 바이러스 감소 (참고)', V.at(-1) < V[0], `V ${V[0].toFixed(2)} → ${V.at(-1).toExponential(2)} (${Math.log10(V[0] / V.at(-1)).toFixed(2)} log10 감소)`);

  // 투약을 끄면 3-1의 감염 정상상태에 그대로 머문다 (바이러스 쪽 연결이 맞는지)
  const off = stage('v3', { Dose_mgkg: 0 }), Vo = off.col('V_v');
  check('3-3 투약 0이면 정상상태 유지', Math.max(...Vo.map(v => Math.abs(v / Vo[0] - 1))) < 1e-6, `V 최대 상대변화 ${e(Math.max(...Vo.map(v => Math.abs(v / Vo[0] - 1))))}`);
}

// 5. 3-4 염증·복수: 반응 순서(바이러스 → 염증 → 복수)와 투약 0일 때 정상상태 유지
{
  const r = stage('v4');
  const half = X => { for (let k = 0; k < X.length; k++) if (X[k] <= X[0] / 2) return r.T[k]; return null; };
  const hv = half(r.col('V_v')), hc = half(r.col('Cy')), ha = half(r.col('A_asc'));
  check('3-4 반응 순서 바이러스 → 염증 → 복수', hv != null && hc != null && ha != null && hv < hc && hc < ha,
    `절반 도달 ${(hv / 24).toFixed(2)}일 → ${(hc / 24).toFixed(2)}일 → ${(ha / 24).toFixed(2)}일`);
  const off = stage('v4', { Dose_mgkg: 0 });
  const dd = Math.max(...['V_v', 'Cy', 'A_asc'].map(s => { const X = off.col(s); return Math.max(...X.map(v => Math.abs(v / X[0] - 1))); }));
  check('3-4 투약 0이면 V·C_y·복수 모두 정상상태 유지', dd < 1e-6, `최대 상대변화 ${e(dd)} (염증·복수 기준값이 정상상태와 맞는지)`);
}

// 6. 3-5 투약 종료 후 반등
{
  const r = stage('v5'), V = r.col('V_v'), P = r.P;
  const tStop = P.N_d * P.tau, vStop = app.interp1(r.T, V, tStop);
  check('3-5 투약 종료 후 반등', vStop < V[0] * 0.5 && V.at(-1) > vStop,
    `종료(${(tStop / 24).toFixed(0)}일) V ${vStop.toExponential(2)} → 끝(84일) ${V.at(-1).toExponential(2)} (${(V.at(-1) / vStop).toExponential(2)}배)`);
}

// 7. 단계 카드의 의도·해석 가이드·지금 결과 읽기
{
  const lines = {}; let ok = true;
  for (const key of Object.keys(C3.presets)) {
    const r = stage(key), m = r.M;
    app.setM(m);
    const exps = app.computeExps(r.C, r.P, r.main, []);
    const idx = Object.fromEntries(m.eqs.map((q, i) => [q.state, i]));
    const sig = (x, p) => Number.isFinite(x) ? String(parseFloat(x.toPrecision(p || 3))) : String(x);
    const ctx = {
      T: r.T, Y: r.main.Y, P: r.P, idx, exps, cmp: [], fmt: app.fmt, windowStats: app.windowStats, interp1: app.interp1,
      f3: x => sig(x, 3), pct: x => sig(x * 100, 3) + '%',
      col: s => r.main.Y.map(y => y[idx[s]]), series: txt => { const f = r.C.expr(txt); return r.T.map((t, k) => f(t, r.main.Y[k], r.P)); }
    };
    try { lines[key] = C3.info[key].interpret(ctx); } catch (err) { lines[key] = ['오류: ' + err.message]; ok = false; }
    if (!Array.isArray(lines[key]) || !lines[key].length || lines[key].some(x => typeof x !== 'string' || /NaN|undefined|Infinity/.test(x))) ok = false;
    if (!C3.info[key].why || !(C3.info[key].guide || []).length) ok = false;
  }
  check('단계별 의도·해석 가이드·결과 읽기', ok, Object.keys(lines).length + '개 단계');
  if (process.argv.includes('--show')) for (const [k, ls] of Object.entries(lines)) { console.log('  [' + k + ']'); ls.forEach(x => console.log('   - ' + x)); }
}

const bad = results.filter(r => !r.ok).length;
console.log(bad ? `\n챕터 3 검증 실패: ${bad}/${results.length}` : `\n챕터 3 검증 통과: ${results.length}개 항목`);
process.exit(bad ? 1 : 0);
