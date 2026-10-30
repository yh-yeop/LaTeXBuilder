// 챕터 2 모듈(engine.gen.js + stages.js + model.js)을 분석 화면과 같은 순서로 Node에 불러온다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'chapter2');
if (!globalThis.localStorage) globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
for (const f of ['engine.gen.js', 'stages.js', 'model.js']) new Function(readFileSync(path.join(dir, f), 'utf8'))();
export const Gut = globalThis.Gut;
export const E = globalThis.PBPK;
export const Ch2 = globalThis.Ch2;
