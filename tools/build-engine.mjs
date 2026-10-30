// index.html(챕터 1)의 계산 코드를 챕터 2가 쓸 수 있게 chapter2/engine.gen.js로 뽑아낸다.
// 원본은 index.html 하나다. index.html의 스크립트를 고쳤다면 이 명령을 다시 실행한다.
//   node tools/build-engine.mjs           생성
//   node tools/build-engine.mjs --check   생성 결과가 최신인지 확인 (다르면 exit 1)
// 줄바꿈은 LF로 맞춰 비교·생성한다 (Git이 CRLF로 바꿔 체크아웃해도 결과가 같도록).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(root, 'chapter2', 'engine.gen.js');
const lf = s => s.replace(/\r\n/g, '\n');

// 챕터 2와 검증 스크립트에 넘기는 이름. 화면 부팅 코드(마지막 init)는 실행하지 않는다.
const EXPORTS = `{
  setM:x=>{M=x;}, getM:()=>M, num, fmt, parse, toText, toTex, autoLatex, labelOf, buildTex, genPython,
  compile, makeEvents, integrate, integrateEvents, interp, interp1, windowStats, computeCmp, computeExps,
  normalize, applyMeta, PV, FV, T_, ORG, DOSE_VARS, DOSE_FUNCS,
  presets:{m0:defaultModel,s1:presetStage1,s2:presetStage2,m1:presetModel1,iv:presetIV2c,ck:presetCook,c1:presetCase1}
}`;

export function buildEngine() {
  const html = lf(readFileSync(path.join(root, 'index.html'), 'utf8'));
  const m = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/);
  if (!m) throw new Error('index.html에서 메인 <script>를 찾지 못했습니다');
  const src = m[1];
  if (!/^\(function\(\)\{/.test(src)) throw new Error('index.html 스크립트가 (function(){ 로 시작하지 않습니다. tools/build-engine.mjs를 갱신하세요');
  // 끝부분: (async function init(){ … })(); })();  → init 대신 이름 묶음을 돌려준다
  const at = src.lastIndexOf('(async function init(){');
  if (at < 0 || !/\}\)\(\);\s*\}\)\(\);\s*$/.test(src)) throw new Error('index.html 부팅 코드 형태가 예상과 다릅니다. tools/build-engine.mjs를 갱신하세요');
  const body = src.slice(0, at).replace(/^\(function\(\)\{/, 'globalThis.PBPK=(function(){') + `return ${EXPORTS};\n})();`;
  return '// 자동 생성 파일입니다. 직접 고치지 마세요.\n// 원본: index.html의 <script> (챕터 1). 다시 만들기: node tools/build-engine.mjs\n' + body + '\n';
}
// 챕터 편집기 페이지: index.html을 그대로 쓰되 단계 묶음(stages.js)과 색(theme.css)만 끼운다.
// 진행 단계·설명·저장 키 등은 index.html이 STAGE_PACK을 읽어 바꾼다.
export const CHAPTER_DIRS = ['chapter2', 'chapter3'];
export const PAGE = path.join(root, 'chapter2', 'index.html');
export function buildChapterPage() {
  const html = lf(readFileSync(path.join(root, 'index.html'), 'utf8'));
  const MAIN = '<script>\n(function(){';
  if (html.split(MAIN).length !== 2 || !html.includes('</head>') || !html.startsWith('<!DOCTYPE html>\n'))
    throw new Error('index.html 형태가 예상과 다릅니다. tools/build-engine.mjs를 갱신하세요');
  return html
    .replace('<!DOCTYPE html>\n', '<!DOCTYPE html>\n<!-- 자동 생성 파일입니다. 직접 고치지 마세요. 원본: index.html + chapter2/stages.js. 다시 만들기: node tools/build-engine.mjs -->\n')
    .replace('</head>', '<link rel="stylesheet" href="theme.css">\n</head>')
    .replace(MAIN, '<script src="stages.js"></script>\n' + MAIN);
}

const TARGETS = [[OUT, buildEngine], ...CHAPTER_DIRS.map(d => [path.join(root, d, 'index.html'), buildChapterPage])];
export const isFresh = () => TARGETS.every(([f, b]) => existsSync(f) && lf(readFileSync(f, 'utf8')) === b());

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const stale = TARGETS.filter(([f, b]) => !(existsSync(f) && lf(readFileSync(f, 'utf8')) === b())).map(([f]) => path.relative(root, f).split(path.sep).join('/'));
    console.log(stale.length ? `${stale.join(', ')}가 index.html과 다릅니다. node tools/build-engine.mjs를 실행하세요` : '생성 파일 최신 상태 (engine.gen.js · 챕터 편집기 ' + CHAPTER_DIRS.length + '개)');
    process.exit(stale.length ? 1 : 0);
  }
  for (const [f, b] of TARGETS) { writeFileSync(f, b()); console.log('생성: ' + f); }
}
