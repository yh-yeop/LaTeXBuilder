# 수식 빌더 · PBPK 투여 모델링

미분방정식(ODE)을 편집하면서 LaTeX 수식, 시뮬레이션 그래프, 비교 지표를 바로 확인하는 웹 도구입니다.
고양이 FIP 치료제 GS-441524의 PBPK 모델을 단계별로 만들고 비교하는 예시(모델 0 ~ 6단계)가 들어 있습니다.

## 쓰는 법
- 페이지 오른쪽 위 **진행 단계**에서 단계를 누르면 해당 모델을 불러옵니다.
- 왼쪽 **변수** 슬라이더를 움직이면 결과가 바로 다시 계산됩니다.
- 상단 **사용법** 버튼과 각 영역 제목 옆 **?**에서 자세한 설명을 볼 수 있습니다.
- 작업은 브라우저(localStorage)에 저장됩니다. 보관하려면 **모델 내보내기 (JSON)**를 쓰세요.

## 구성
- `index.html` 한 파일로 동작합니다 (HTML·CSS·JS 포함).
- 수식 렌더링은 MathJax 3 (cdnjs)를 불러옵니다. 오프라인에서는 LaTeX 원문으로 표시됩니다.

## 챕터 2 · 장 상태 시나리오 (`chapter2/`)
챕터 1(모델 0 ~ 6단계)과 별개의 탐구 모델입니다. 몸 식은 챕터 1의 3단계 모델 1을 그대로 쓰고, 장관만 내강 → 장 세포 → 혈액(입구 k_in, 출구 k_out, 혈액 유입 k_b, 대변 통과 k_tr) 3구획으로 바꿨습니다. F는 입력이 아니라 결과값입니다.
- `chapter2/engine.gen.js`는 `index.html`의 계산 코드를 자동 추출한 파일입니다. 직접 고치지 말고 `index.html`을 고친 뒤 `node tools/build-engine.mjs`로 다시 만드세요.
- 페이지가 스크립트 파일을 불러오므로 로컬에서는 정적 서버로 여세요 (예: `python -m http.server`).

## 검증
- `node tests/baseline.mjs` — 챕터 1 모든 단계의 지표가 `tests/baseline.json` 기록과 같은지 (회귀)
- `node tests/chapter2.mjs` — 챕터 2 해석해·F 닫힌 식·질량 보존·보정·엔진 추출본 최신 여부
- `node tests/chapter2_scipy.mjs` — 챕터 2 모델을 scipy로 풀어 대조 (numpy, scipy 필요)

## 주의
모델 파라미터 일부는 문헌 값이고 일부는 가정입니다. 페이지의 변수 카드에서 근거 표시(문헌·보정·계산·가정)를 확인하세요.
연구·학습용이며 임상 판단에 쓰기 위한 도구가 아닙니다.

## 참고 문헌
- 한만길 (2020). 고양이 전염성복막염(FIP)에 감염된 고양이의 치료에 GS-441524를 적용한 증례. with CAP 18(5): 20–25.
- Coggins et al. (2025). J Small Anim Pract.
- Cook et al. (2022). Viruses 14(11): 2429 / 정오표 Viruses 16(3): 397 (2024).
- Renner et al. (2026). J Feline Med Surg.
- Cooke et al. (2026). Pathogens 15(3): 291.
- A generic physiologically based kinetic model for the domestic cat (Felis catus) (2026).
