// 챕터 2 검증. 모두 통과해야 exit 0.
//   node tests/chapter2.mjs
import { isFresh } from '../tools/build-engine.mjs';
import { Gut, E, Ch2 } from './load-ch2.mjs';

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? '✓ ' : '✗ ') + name + ' — ' + detail); };
const e = x => x.toExponential(2);

// 0. 엔진 추출본이 index.html과 같은지
check('생성 파일 최신', isFresh(), 'chapter2/engine.gen.js · chapter2/index.html == index.html에서 새로 만든 결과');

// 보정 (기본 기준 F, 프리셋 3개)
const cal = Gut.PARTITIONS.map(p => ({ p, c: Gut.calibrate(Gut.F_BASE_DEFAULT, p.po) }));
for (const { p, c } of cal)
  check(`보정 ${p.label}`, Math.abs(c.Cmax / Gut.CMAX_TARGET - 1) < 1e-6 && Math.abs(c.F - Gut.F_BASE_DEFAULT) < 1e-12,
    `Cmax ${c.Cmax.toFixed(5)} / 목표 ${Gut.CMAX_TARGET.toFixed(5)} mg/L, F ${c.F.toFixed(9)}, λ ${c.lam.toFixed(4)}`);

// 적분기가 실제로 계산한 시점에서 해석해와 비교한다 (선형 보간 오차를 섞지 않기 위해).
// norm: 최대 |수치 − 해석| / 최대 |해석| (판정 기준)
// rel:  |해석| > 1e-3·최대인 점에서의 점별 상대오차 (참고. 공용 적분기의 절대 허용오차 1e-10 mg가 꼬리에서 하한이 됨)
function nodeErr(r, keys, fns) {
  let norm = 0, rel = 0;
  keys.forEach((s, j) => {
    const i = r.idx[s]; let ymax = 0, amax = 0;
    r.T.forEach(t => { ymax = Math.max(ymax, Math.abs(fns[j](t))); });
    r.T.forEach((t, k) => {
      if (k + 1 < r.T.length && r.T[k + 1] === t) return;   // 투약 직전 값(같은 시각에 투약 뒤 값이 따로 있음)
      const y = fns[j](t), d = Math.abs(r.Y[k][i] - y); amax = Math.max(amax, d);
      if (Math.abs(y) > 1e-3 * ymax) rel = Math.max(rel, d / Math.abs(y));
    });
    norm = Math.max(norm, amax / ymax);
  });
  return { norm, rel };
}
const single = (k, tEnd, rtol) => {
  const m = Gut.buildModel(k), C = Gut.compileModel(m);
  return { m, r: Gut.simulate(m, C, { N_d: 1 }, { tEnd, rtol }) };
};
const D = m => m.vars.find(v => v.name === 'BW').value * m.vars.find(v => v.name === 'Dose_mgkg').value;

// 1a. 극한 조건 k_out = k_tr = 0 (연쇄 흡수) 해석해
{
  const k = { k_in: 1.3, k_out: 0, k_b: 2.1, k_tr: 0 };
  const { m, r } = single(k, 24, 1e-10);
  const a = Gut.gutChainAnalytic(k.k_in, k.k_b, D(m));
  const err = nodeErr(r, ['A_L', 'A_E'], [a.L, a.E]);
  check('해석해 (극한 k_out = k_tr = 0)', err.norm < 1e-9, `적분 시점 ${r.T.length}개, 최대오차/최댓값 ${e(err.norm)} (기준 1e-9), 점별 상대오차 ${e(err.rel)}`);
}
// 1b. 일반 조건 (기준 프리셋 + 시나리오) 장 부분 2×2 해석해
{
  let norm = 0, rel = 0, n = 0;
  for (const { c } of cal) for (const sc of Gut.SCEN(2)) {
    const k = Gut.applyMult(c.k0, sc.m);
    const { m, r } = single(k, 24, 1e-10);
    const a = Gut.gutAnalytic(k, D(m));
    const er = nodeErr(r, ['A_L', 'A_E', 'A_fec', 'A_abs'], [a.L, a.E, a.fec, a.abs]);
    norm = Math.max(norm, er.norm); rel = Math.max(rel, er.rel); n++;
  }
  check('해석해 (일반 조건, 장 4개 상태)', norm < 1e-9, `${n}개 조합, 최대오차/최댓값 ${e(norm)} (기준 1e-9), 점별 상대오차 ${e(rel)}`);
}

// 2. 수치 F (= 혈액으로 들어간 누적량 / 투여량) vs 닫힌 식
{
  let worst = 0, n = 0, resid = 0;
  for (const { c } of cal) for (const sc of [...Gut.SCEN(2), { m: { m_in: 0.25, m_out: 4, m_tr: 4 } }, { m: { m_in: 4, m_out: 0.25, m_tr: 0.25 } }]) {
    const k = Gut.applyMult(c.k0, sc.m);
    const slow = Math.min(...Gut.gutAnalytic(k, 1).lambdas.map(Math.abs));
    const { m, r } = single(k, 40 / slow, 1e-10);
    const y = r.Y[r.Y.length - 1], dose = D(m);
    resid = Math.max(resid, (y[r.idx.A_L] + y[r.idx.A_E]) / dose);
    worst = Math.max(worst, Math.abs(y[r.idx.A_abs] / dose - Gut.Fclosed(k))); n++;
  }
  check('F 닫힌 식 = 수치 F', worst < 1e-8, `${n}개 조합, 최대 |F수치 − F식| ${e(worst)} (장 잔량 ${e(resid)} × 투여량에서 종료)`);
}

// 3. 질량 보존: 투여량 = 모든 구획 잔량 + 장 세포 + 대변 누적 + 소실 누적 (기본 일정, 기본 허용오차)
{
  let worst = 0, worstAbs = 0;
  for (const { c } of cal) for (const sc of Gut.SCEN(2)) {
    const m = Gut.buildModel(Gut.applyMult(c.k0, sc.m)), C = Gut.compileModel(m);
    const r = Gut.simulate(m, C);
    const fs = C.expr(m.cmps[0].sim), fr = C.expr(m.cmps[0].ref), fb = C.expr(Gut.BODY_SUM());
    r.T.forEach((t, k) => {
      if (k > 0 && r.T[k] === r.T[k - 1]) return;   // 투약 직전·직후 중복 시점은 투약 뒤 값만
      const ref = (k + 1 < r.T.length && r.T[k + 1] === t) ? null : fr(t, r.Y[k], r.P);
      if (ref == null) return;
      worst = Math.max(worst, Math.abs(fs(t, r.Y[k], r.P) - ref));
      worstAbs = Math.max(worstAbs, Math.abs(r.Y[k][r.idx.A_abs] - fb(t, r.Y[k], r.P)));
    });
  }
  check('질량 보존', worst < 6e-4, `15개 조합 · 12 mg/kg × 7회, 최대 |총량 − 누적 투여| ${e(worst)} mg (기준 0.0006 mg)`);
  check('혈액 유입 누적 = 몸 안 총량 + 소실', worstAbs < 6e-4, `최대 차이 ${e(worstAbs)} mg`);
}

// 4. 경계선: m_in = m_tr·(pb + po·m_out)에서 F 비율 = 1
{
  let worst = 0;
  for (const { c } of cal) for (const mo of [0.25, 0.5, 1, 2, 4]) for (const mt of [0.5, 1, 2]) {
    const mi = Gut.boundaryMin(c.k0, mo, mt);
    worst = Math.max(worst, Math.abs(Gut.Fclosed(Gut.applyMult(c.k0, { m_in: mi, m_out: mo, m_tr: mt })) / c.F - 1));
  }
  check('F 비율 = 1 경계선 식', worst < 1e-12, `최대 |F비율 − 1| ${e(worst)}`);
}

/* ================= 챕터 2 단계 (2-1 ~ 2-5, stages.js) ================= */
const C2 = Ch2({ PV: E.PV, FV: E.FV, T_: E.T_, ORG: E.ORG, normalize: E.normalize, presets: { m1: E.presets.m1 } });
{
  const c = Gut.calibrate(0.6, 0.5);
  const d = Math.max(...Object.keys(C2.K0).map(k => Math.abs(C2.K0[k] / c.k0[k] - 1)));
  check('단계 기준 속도 K0 = 보정 결과', d < 1e-9, `stages.js K0 vs calibrate(F 0.6, 균형) 최대 상대차 ${e(d)}`);
}
const stage = (key, over, opt) => {
  const m = C2.presets[key](), C = Gut.compileModel(m), r = Gut.simulate(m, C, over, opt);
  E.setM(m); const cmp = E.computeCmp(C, r.P, { T: r.T, Y: r.Y }, []);
  return { m, C, r, cmp };
};
const col = (r, s) => r.Y.map(y => y[r.idx[s]]);
const OFF = { en_on: 0, ab_on: 0, fip_on: 0 };
// 2-1: 로지스틱 해석해(경쟁자 없는 y_c), 평형점
{
  const { r, cmp } = stage('g1');
  const P = r.P, f = t => 1 / (1 + (1 / P.x0 - 1) * Math.exp(-P.r_c * t));
  const er = nodeErr(r, ['y_c'], [f]);
  check('2-1 로지스틱 해석해 (y_c)', er.norm < 1e-9 && cmp[0].met.maxR < 0.1, `적분 시점 최대오차/최댓값 ${e(er.norm)} (기준 1e-9), 화면 비교 최대 상대오차 ${cmp[0].met.maxR.toExponential(2)}% (기준 0.1%)`);
  const xc = col(r, 'x_c').at(-1), xo = col(r, 'x_o').at(-1);
  const xcs = (1 - P.a_co) / (1 - P.a_co * P.a_oc), xos = (1 - P.a_oc) / (1 - P.a_co * P.a_oc);
  const d = Math.max(Math.abs(xc / xcs - 1), Math.abs(xo / xos - 1));
  check('2-1 끝값 → 평형점 닫힌 식', d < 1e-3, `x_c ${xc.toFixed(6)} / ${xcs.toFixed(6)}, x_o ${xo.toFixed(6)} / ${xos.toFixed(6)}, 최대 상대차 ${e(d)} (1440 h, 기준 1e-3)`);
}
// 2-2: 교란을 끄면 평형 유지, 기본 교란(장염)의 깊이와 회복
{
  const off = stage('g2', OFF).r, d = Math.max(...['x_c', 'x_o'].map(s => Math.max(...col(off, s).map(v => Math.abs(v - col(off, s)[0])))));
  check('2-2 교란 끄면 평형 유지', d < 1e-9, `x_c·x_o 최대 변화 ${e(d)}`);
  const { r } = stage('g2'), xc = col(r, 'x_c'), eq = xc[0], mn = Math.min(...xc);
  check('2-2 장염 후 회복 (참고)', xc.at(-1) / eq > 0.99, `공생균 최저 ${(mn / eq * 100).toFixed(1)}% → 720 h에 ${(xc.at(-1) / eq * 100).toFixed(2)}% (평형 대비)`);
}
// 2-3: 교란을 끄면 S_m = P_gp = 1, 기본 교란에서 P-gp 최저
{
  const off = stage('g3', OFF).r, d = Math.max(...['S_m', 'P_gp'].map(s => Math.max(...col(off, s).map(v => Math.abs(v - 1)))));
  check('2-3 교란 끄면 S_m = P_gp = 1', d < 1e-9, `최대 |값 − 1| ${e(d)}`);
  const { r } = stage('g3'), p = col(r, 'P_gp'), k = p.indexOf(Math.min(...p));
  check('2-3 장염 중 P-gp 감소 (참고)', Math.min(...p) < 1, `P_gp 최저 ${Math.min(...p).toFixed(3)} @ ${r.T[k].toFixed(0)} h, 720 h에 ${p.at(-1).toFixed(4)}`);
}
// 2-4: 질량 보존, 교란을 끄면 2-5(배수 1)와 같음, 교란 전·중·후 비교
{
  const { m, C, r, cmp } = stage('g4');
  const fs = C.expr(m.cmps[0].sim), fr = C.expr(m.cmps[0].ref);
  let mb = 0; r.T.forEach((t, k) => { if (k + 1 < r.T.length && r.T[k + 1] === t) return; mb = Math.max(mb, Math.abs(fs(t, r.Y[k], r.P) - fr(t, r.Y[k], r.P))); });
  check('2-4 질량 보존', mb < 6e-4 && cmp[0].met.maxR < 0.1, `28회 투약, 최대 |총량 − 누적 투여| ${e(mb)} mg (기준 0.0006 mg)`);
  const a = Gut.metrics(stage('g4', OFF).r), b5 = stage('g5', { N_d: 28 }, { tEnd: 672 }).r, b = Gut.metrics(b5);
  const dd = Math.max(...['Cmax', 'Cmin', 'AUC'].map(k => Math.abs(a[k] / b[k] - 1)));
  check('2-4 교란 끄면 2-5(배수 1)와 같음', dd < 1e-4, `마지막 간격 Cmax·Cmin·AUCτ 최대 상대차 ${e(dd)}`);
  E.setM(m); const ex = E.computeExps(C, r.P, { T: r.T, Y: r.Y }, []);
  const [pre, dur, last, Ft, Fa] = ex;
  check('2-4 교란 전·중·후 (참고)', isFinite(dur.auc), `AUCτ 전 ${pre.auc.toFixed(3)} → 장염 중 ${dur.auc.toFixed(3)} (${(dur.auc / pre.auc).toFixed(3)}배) → 마지막 ${last.auc.toFixed(3)} (${(last.auc / pre.auc).toFixed(4)}배), 장염 중 F(t) 최대 ${Ft.mx.toFixed(4)}, 장염 뒤 F(t) 최대 ${Fa.mx.toFixed(4)} (기준 0.6)`);
}

// 단계 카드의 "지금 결과 읽기" (발표용 해석 문장)가 기본값에서 오류 없이 만들어지는지
{
  const lines = {}; let ok = true;
  for (const key of Object.keys(C2.presets)) {
    const { m, C, r } = stage(key); E.setM(m);
    const exps = E.computeExps(C, r.P, { T: r.T, Y: r.Y }, []);
    const ctx = { T: r.T, Y: r.Y, P: r.P, idx: r.idx, exps, cmp: [], fmt: E.fmt, windowStats: E.windowStats, interp1: E.interp1,
      col: s => r.Y.map(y => y[r.idx[s]]), series: txt => { const f = C.expr(txt); return r.T.map((t, k) => f(t, r.Y[k], r.P)); } };
    try { lines[key] = C2.info[key].interpret(ctx); } catch (err) { lines[key] = ['오류: ' + err.message]; ok = false; }
    if (!Array.isArray(lines[key]) || !lines[key].length || lines[key].some(x => typeof x !== 'string' || /NaN|undefined/.test(x))) ok = false;
    if (!C2.info[key].why || !(C2.info[key].guide || []).length) ok = false;
  }
  check('단계별 의도·해석 가이드·결과 읽기', ok, Object.keys(lines).length + '개 단계');
  if (process.argv.includes('--show')) for (const [k, ls] of Object.entries(lines)) { console.log('  [' + k + ']'); ls.forEach(x => console.log('   - ' + x)); }
}

const bad = results.filter(r => !r.ok).length;
console.log(bad ? `\n챕터 2 검증 실패: ${bad}/${results.length}` : `\n챕터 2 검증 통과: ${results.length}개 항목`);
process.exit(bad ? 1 : 0);
