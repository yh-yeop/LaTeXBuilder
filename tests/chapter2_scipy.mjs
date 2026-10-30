// 챕터 2 모델을 scipy(LSODA)로 따로 풀어 웹(JS) 결과와 대조한다. 검증용으로만 쓴다.
//   node tests/chapter2_scipy.mjs        (numpy, scipy 필요)
// 파이썬 코드는 챕터 1의 'Python 코드' 기능(genPython)이 만든 것을 그대로 쓰고,
// 그림 그리는 줄만 빼고 촘촘한 출력(dense_output)으로 JS 적분 시점의 값을 뽑는다.
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { Gut, E } from './load-ch2.mjs';

const STATES = ['A_L', 'A_E', 'A_fec', 'A_abs', 'C_b', 'C_h', 'C_asc', 'A_el'];
const TOL = 1e-6;   // 최대오차/최댓값 기준 (서로 다른 두 적분기, JS rtol 1e-9 · LSODA rtol 1e-10)
const tmp = mkdtempSync(path.join(os.tmpdir(), 'ch2-scipy-'));
let worst = 0, bad = 0;

for (const p of Gut.PARTITIONS) for (const sc of Gut.SCEN(2)) {
  const c = Gut.calibrate(Gut.F_BASE_DEFAULT, p.po);
  const m = Gut.buildModel(c.k0);
  Object.entries(sc.m).forEach(([k, v]) => { const x = m.vars.find(z => z.name === k); x.value = v; x.expr = String(v); });
  m.sim.rtol = 1e-9;
  const C = Gut.compileModel(m), r = Gut.simulate(m, C);
  // 투약 직전 중복 시점은 빼고 고르게 250개
  const nodes = r.T.map((t, k) => k).filter(k => !(k + 1 < r.T.length && r.T[k + 1] === r.T[k]));
  const pick = Array.from({ length: 250 }, (_, j) => nodes[Math.round(j * (nodes.length - 1) / 249)]);
  const tq = pick.map(k => r.T[k]);

  E.setM(m);
  let py = E.genPython();
  py = py.split('\n').filter(l => !/matplotlib|^plt\./.test(l)).join('\n');
  const SOLVE = 'sol = solve_ivp(rhs, (a, b), y, method="LSODA", rtol=1e-8, atol=1e-10)';
  if (!py.includes(SOLVE)) throw new Error('genPython 출력 형태가 예상과 다릅니다');
  py = py.replace(SOLVE, 'sol = solve_ivp(rhs, (a, b), y, method="LSODA", rtol=1e-10, atol=1e-12, dense_output=True); SEG.append((a, b, sol))');
  py = 'SEG = []\n' + py + `
import json, sys
tq = json.load(open(sys.argv[1]))
names = ${JSON.stringify(m.eqs.map(q => q.state))}
out = []
for t in tq:
    seg = [s for s in SEG if s[0] <= t < s[1]] or [SEG[-1]]
    a, b, s = seg[0]
    out.append(list(s.sol(t)))
json.dump({"names": names, "Y": out}, open(sys.argv[2], "w"))
`;
  const fpy = path.join(tmp, 'm.py'), fin = path.join(tmp, 'tq.json'), fout = path.join(tmp, 'out.json');
  writeFileSync(fpy, py); writeFileSync(fin, JSON.stringify(tq));
  execFileSync('python', [fpy, fin, fout], { stdio: ['ignore', 'inherit', 'inherit'] });
  const res = JSON.parse(readFileSync(fout, 'utf8'));

  const errs = STATES.map(s => {
    const i = res.names.indexOf(s), j = r.idx[s];
    let amax = 0, ymax = 0;
    pick.forEach((k, q) => { ymax = Math.max(ymax, Math.abs(r.Y[k][j])); amax = Math.max(amax, Math.abs(r.Y[k][j] - res.Y[q][i])); });
    return [s, ymax > 0 ? amax / ymax : 0];
  });
  const w = Math.max(...errs.map(x => x[1])); worst = Math.max(worst, w); if (!(w < TOL)) bad++;
  console.log(`${w < TOL ? '✓' : '✗'} ${p.label} · ${sc.label}: 최대오차/최댓값 ${w.toExponential(2)} (${errs.sort((a, b) => b[1] - a[1])[0][0]})`);
}
console.log(bad ? `\nscipy 대조 실패: ${bad}건` : `\nscipy 대조 통과: 15개 조합, 상태 ${STATES.length}개, 최대오차/최댓값 ${worst.toExponential(2)} (기준 ${TOL})`);
process.exit(bad ? 1 : 0);
