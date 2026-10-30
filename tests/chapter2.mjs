// 챕터 2 검증. 모두 통과해야 exit 0.
//   node tests/chapter2.mjs
import { buildEngine } from '../tools/build-engine.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Gut } from './load-ch2.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log((ok ? '✓ ' : '✗ ') + name + ' — ' + detail); };
const e = x => x.toExponential(2);

// 0. 엔진 추출본이 index.html과 같은지
check('엔진 추출본 최신', readFileSync(path.join(here, '..', 'chapter2', 'engine.gen.js'), 'utf8') === buildEngine(), 'chapter2/engine.gen.js == index.html에서 새로 추출한 결과');

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

const bad = results.filter(r => !r.ok).length;
console.log(bad ? `\n챕터 2 검증 실패: ${bad}/${results.length}` : `\n챕터 2 검증 통과: ${results.length}개 항목`);
process.exit(bad ? 1 : 0);
