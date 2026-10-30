// 기존 단계(모델 0 ~ 6단계)의 회귀 확인.
//   node tests/baseline.mjs --write   현재 결과를 tests/baseline.json에 기록 (수정 전 1회)
//   node tests/baseline.mjs           기록과 비교 (상대오차 1e-12 초과 시 실패)
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { app, runStage, stateMetrics } from './harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(here, 'baseline.json');
const STAGES = ['m0', 's1', 's2', 'm1', 'iv', 'ck', 'c1'];
// 단계별 혈장(또는 대표) 농도 식
const PLASMA = { m0: 'C_h', s1: 'A_c/V_c', s2: 'C_b', m1: 'C_b', iv: 'A_1/V_1', ck: 'A_c/V_c', c1: 'C_b' };

function plasmaMetrics(r, key) {
  const f = r.C.expr(PLASMA[key]); const { T, Y } = r.main;
  const V = Y.map((y, k) => f(T[k], y, r.P));
  let cmax = -Infinity, tmax = 0, auc = 0;
  for (let k = 0; k < T.length; k++) { if (V[k] > cmax) { cmax = V[k]; tmax = T[k]; } if (k) auc += (V[k] + V[k - 1]) / 2 * (T[k] - T[k - 1]); }
  // Cmin: 마지막 투약 간격 끝 Nτ 직전 값(트로프, 노출 지표의 '구간 끝 값'과 같은 정의). 투약이 없는 모델 0은 최종값
  const P = r.P, tau = P.tau || 24, N = key === 'c1' ? P.N1 + P.N2 : (P.N_d || 1);
  const b = key === 'm0' ? T[T.length - 1] : N * tau;
  let lo = 0, hi = T.length - 1; const tb = Math.min(b - 1e-9, T[hi]);
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= tb) lo = mid; else hi = mid; }
  const cmin = V[lo] + (tb - T[lo]) / ((T[hi] - T[lo]) || 1) * (V[hi] - V[lo]);
  return { expr: PLASMA[key], troughAt: b, Cmax: cmax, Tmax: tmax, Cmin: cmin, AUC: auc };
}

function snapshot() {
  const out = {};
  for (const key of STAGES) {
    const r = runStage(key);
    out[key] = {
      title: r.M.info ? r.M.info.title : key,
      steps: r.main.T.length, warn: r.warn,
      plasma: plasmaMetrics(r, key),
      states: stateMetrics(r),
      cmp: r.cmp.map(c => ({ label: c.label, maxR: c.met.maxR, rmse: c.met.rmse, afe: c.met.afe })),
      exps: r.exps.map(x => ({ label: x.label, auc: x.auc, mx: x.mx, trough: x.trough, above: x.above }))
    };
  }
  return out;
}

const cur = snapshot();
if (process.argv.includes('--write')) {
  writeFileSync(FILE, JSON.stringify(cur, null, 2));
  for (const [k, v] of Object.entries(cur)) {
    const p = v.plasma;
    console.log(`${k.padEnd(3)} ${p.expr.padEnd(8)} Cmax ${p.Cmax.toPrecision(6)} @ ${p.Tmax.toFixed(3)} h · Cmin ${p.Cmin.toPrecision(6)} · AUC ${p.AUC.toPrecision(7)} · cmp ${v.cmp.map(c => c.maxR.toExponential(2) + '%').join(', ')}`);
  }
  console.log('기록: ' + FILE);
} else {
  const ref = JSON.parse(readFileSync(FILE, 'utf8'));
  let bad = 0, n = 0;
  const walk = (a, b, p) => {
    if (typeof b === 'number') {
      n++;
      const ok = (a === b) || (Number.isNaN(a) && Number.isNaN(b)) || (Math.abs(a - b) <= 1e-12 * Math.max(1e-300, Math.abs(b)));
      if (!ok) { bad++; if (bad <= 20) console.log(`  다름 ${p}: ${b} → ${a}`); }
    } else if (b && typeof b === 'object') {
      for (const k of Object.keys(b)) walk(a == null ? undefined : a[k], b[k], p + '.' + k);
    } else if (a !== b) { bad++; if (bad <= 20) console.log(`  다름 ${p}: ${b} → ${a}`); }
  };
  walk(JSON.parse(JSON.stringify(cur)), ref, '');
  console.log(bad ? `회귀 실패: ${bad}/${n}개 값이 기록과 다릅니다` : `회귀 통과: 기존 단계 ${STAGES.length}개, 값 ${n}개 모두 기록과 동일`);
  process.exit(bad ? 1 : 0);
}
