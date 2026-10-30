// index.html의 <script>를 그대로 Node에서 실행해 계산 함수만 꺼내 쓰는 검증용 하네스.
// 화면(DOM) 부팅 코드(bind/loadMathJax/renderAll)는 실행하지 않는다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = readFileSync(path.join(here, '..', 'index.html'), 'utf8');
const m = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
if (!m) throw new Error('index.html에서 메인 <script>를 찾지 못했습니다');
const BOOT = /bind\(\);\s*loadMathJax\(\);\s*renderAll\(\);\s*\}\)\(\);\s*$/;
if (!BOOT.test(m[1])) throw new Error('부팅 코드 형태가 예상과 다릅니다. harness.mjs를 갱신하세요');
const src = m[1].replace(BOOT, `globalThis.__app={
  setM:x=>{M=x;}, getM:()=>M, num, compile, makeEvents, integrateEvents, computeCmp, computeExps, applyMeta,
  presets:{m0:defaultModel,s1:presetStage1,s2:presetStage2,m1:presetModel1,iv:presetIV2c,ck:presetCook,c1:presetCase1},
  extra: typeof EXPORTS_FOR_TEST==='object'?EXPORTS_FOR_TEST:{}
};})();`);

const store = new Map();
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
new Function(src)();
export const app = globalThis.__app;

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
  const main = app.integrateEvents(C, P, y0, M.sim.t0, M.sim.tEnd, rtol, E.ev);
  const warns = [];
  const cmp = app.computeCmp(C, P, main, warns);
  const exps = app.computeExps(C, P, main, warns);
  return { M, C, P, main, cmp, exps, warns, warn: main.warn };
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
