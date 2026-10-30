// index.html의 <script>에서 계산 코드를 꺼내 Node에서 쓰는 검증용 하네스.
// 꺼내는 방법은 챕터 2 엔진 생성(tools/build-engine.mjs)과 같고, 화면 부팅 코드는 실행하지 않는다.
// 생성 파일이 아니라 index.html에서 매번 새로 꺼내므로 챕터 1의 현재 코드를 그대로 검사한다.
import { buildEngine } from '../tools/build-engine.mjs';

if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
}
const prev = globalThis.PBPK;
new Function(buildEngine())();
export const app = globalThis.PBPK;
if (prev) globalThis.PBPK = prev;

// 단계 하나를 불러와 화면의 run()과 같은 순서로 계산한다.
export function runStage(key) {
  const M = app.presets[key]();
  if (key !== 'm0') app.applyMeta(M, key);
  return runModel(M);
}
export function runModel(M) {
  app.setM(M);
  const C = app.compile();
  if (C.errors.length) throw new Error(C.errors.join('; '));
  const P = {}; M.vars.forEach(v => { if (v.kind === 'param') P[v.name] = app.num(v.value); });
  const y0 = M.eqs.map(q => app.num(q.ic));
  const rtol = Math.max(1e-12, app.num(M.sim.rtol) || 1e-7);
  const E = app.makeEvents(C, P, M.eqs.length, M.sim.t0, M.sim.tEnd);
  const main = app.integrateEvents(C, P, y0, M.sim.t0, M.sim.tEnd, rtol, E.ev, M.sim.method);
  const warns = [];
  const cmp = app.computeCmp(C, P, main, warns);
  const exps = app.computeExps(C, P, main, warns);
  return { M, C, P, main, cmp, exps, warns, warn: main.warn, stiff: !!main.stiff };
}

// 요약 지표 표와 같은 정의: 최종값, 최댓값, 최솟값, 사다리꼴 AUC(0→끝)
export function stateMetrics(r) {
  const { T, Y } = r.main; const out = {};
  r.M.eqs.forEach((q, i) => {
    let mx = -Infinity, tmx = T[0], mn = Infinity, auc = 0;
    for (let k = 0; k < T.length; k++) {
      const y = Y[k][i];
      if (y > mx) { mx = y; tmx = T[k]; } if (y < mn) mn = y;
      if (k > 0) auc += (y + Y[k - 1][i]) / 2 * (T[k] - T[k - 1]);
    }
    out[q.state] = { final: Y[T.length - 1][i], max: mx, tmax: tmx, min: mn, auc };
  });
  return out;
}
