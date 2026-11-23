'use strict';
// index.html 에 MathJax(tex-svg)를 넣어 인터넷 없이도 수식이 보이는 단일 HTML 파일을 만든다.
//   node tools/build-standalone.js [tex-svg.js 경로] [출력 경로]
// tex-svg.js 경로를 생략하면 node_modules/mathjax/es5/tex-svg.js 를 찾는다. 없으면 예:
//   npm pack mathjax@3.2.2 && tar xzf mathjax-3.2.2.tgz package/es5/tex-svg.js
//   node tools/build-standalone.js package/es5/tex-svg.js
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const mjPath = process.argv[2] || path.join(root, 'node_modules', 'mathjax', 'es5', 'tex-svg.js');
const outPath = process.argv[3] || path.join(root, 'dist', 'latexbuilder.html');

if (!fs.existsSync(mjPath)) {
  console.error('MathJax tex-svg.js 를 찾을 수 없습니다: ' + mjPath);
  console.error('npm pack mathjax@3.2.2 && tar xzf mathjax-3.2.2.tgz package/es5/tex-svg.js 후 경로를 인수로 주세요.');
  process.exit(1);
}
const mj = fs.readFileSync(mjPath, 'utf8');
// <script> 안에 그대로 넣으므로 HTML 파서가 스크립트를 끝내거나 꼬이게 할 문자열이 없어야 한다.
if (/<\/?script/i.test(mj)) throw new Error('MathJax 소스에 <script 문자열이 있어 인라인할 수 없습니다');

let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const CDN = "s.src='https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.min.js';";
if (html.split(CDN).length !== 2) throw new Error('index.html 에서 MathJax CDN 주소를 정확히 한 번 찾지 못했습니다');
// 같은 onload 흐름을 유지하도록 인라인 소스를 Blob URL 로 바꿔 불러온다. 실패하면 원래 CDN 으로 되돌아간다.
html = html.replace(CDN,
  "try{ s.src=URL.createObjectURL(new Blob([document.getElementById('mathjax-inline').textContent],{type:'text/javascript'})); }" +
  "catch(e){ s.src='https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.min.js'; }");
const head = html.indexOf('</head>');
if (head < 0) throw new Error('</head> 를 찾지 못했습니다');
html = html.slice(0, head) + '<script type="text/plain" id="mathjax-inline">' + mj + '</script>\n' + html.slice(head);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, html);
console.log(outPath + ' (' + (Buffer.byteLength(html) / 1024 / 1024).toFixed(2) + ' MB)');
