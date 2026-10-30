// index.html(챕터 1)의 계산 코드를 챕터 2가 쓸 수 있게 chapter2/engine.gen.js로 뽑아낸다.
// 원본은 index.html 하나다. index.html의 스크립트를 고쳤다면 이 명령을 다시 실행한다.
//   node tools/build-engine.mjs           생성
//   node tools/build-engine.mjs --check   생성 결과가 최신인지 확인 (다르면 exit 1)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'chapter2', 'engine.gen.js');

// 챕터 2에 넘기는 이름. 화면(DOM) 부팅 코드(bind/loadMathJax/renderAll)는 실행하지 않는다.
const EXPORTS = `{
  setM:x=>{M=x;}, getM:()=>M, num, fmt, parse, toText, toTex, autoLatex, labelOf, buildTex, genPython,
  compile, makeEvents, integrate, integrateEvents, interp, interp1, windowStats, computeCmp, computeExps,
  normalize, applyMeta, PV, FV, T_, ORG, DOSE_VARS, DOSE_FUNCS,
  presets:{m0:defaultModel,s1:presetStage1,s2:presetStage2,m1:presetModel1,iv:presetIV2c,ck:presetCook,c1:presetCase1}
}`;

export function buildEngine() {
  const html = readFileSync(path.join(root, 'index.html'), 'utf8');
  const m = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
  if (!m) throw new Error('index.html에서 메인 <script>를 찾지 못했습니다');
  const BOOT = /bind\(\);\s*loadMathJax\(\);\s*renderAll\(\);\s*\}\)\(\);\s*$/;
  if (!BOOT.test(m[1])) throw new Error('index.html 부팅 코드 형태가 예상과 다릅니다. tools/build-engine.mjs를 갱신하세요');
  const body = m[1].replace(BOOT, `return ${EXPORTS};\n})();`).replace(/^\(function\(\)\{/, 'globalThis.PBPK=(function(){');
  return '// 자동 생성 파일입니다. 직접 고치지 마세요.\n// 원본: index.html의 <script> (챕터 1). 다시 만들기: node tools/build-engine.mjs\n' + body + '\n';
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = buildEngine();
  if (process.argv.includes('--check')) {
    const ok = existsSync(OUT) && readFileSync(OUT, 'utf8') === out;
    console.log(ok ? 'engine.gen.js 최신 상태' : 'engine.gen.js가 index.html과 다릅니다. node tools/build-engine.mjs를 실행하세요');
    process.exit(ok ? 0 : 1);
  }
  writeFileSync(OUT, out);
  console.log('생성: ' + OUT);
}
