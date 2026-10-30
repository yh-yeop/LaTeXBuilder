# 수식 빌더 · PBPK 투여 모델링

미분방정식(ODE)을 편집하면서 LaTeX 수식, 시뮬레이션 그래프, 비교 지표를 바로 확인하는 웹 도구입니다.
고양이 FIP 치료제 GS-441524의 PBPK 모델을 단계별로 만들고 비교하는 예시(모델 0 ~ 6단계)가 들어 있습니다.

## 쓰는 법
- 페이지 오른쪽 위 **진행 단계**에서 단계를 누르면 해당 모델을 불러옵니다.
- 왼쪽 **변수** 슬라이더를 움직이면 결과가 바로 다시 계산됩니다.
- 상단 **사용법** 버튼과 각 영역 제목 옆 **?**에서 자세한 설명을 볼 수 있습니다.
- 작업은 브라우저(localStorage)에 저장됩니다. 보관하려면 **모델 내보내기 (JSON)**를 쓰세요.
- **링크 복사**: 현재 모델을 압축해 주소의 `#m=` 뒤에 담은 링크를 복사합니다. 링크를 열면 저장된 모델보다 먼저 적용됩니다.
- **내 프리셋 관리**: 현재 모델을 이름 붙여 저장하고(localStorage `ode-builder-presets-v1`), 상단 목록에서 불러오거나 JSON 으로 내보내고 가져옵니다.
- **코드 내보내기**: Python(SciPy) · R(deSolve) · Julia(DifferentialEquations.jl) 코드와 SBML(L3V2) 파일. 투약은 각 언어의 이벤트로 들어갑니다.
- **그래프 PNG · SVG**: 결과 카드에서 지금 보이는 그래프를 그림 파일로 저장합니다.
- **데이터에 맞추기**: 비교 카드의 실측 데이터에 상수 1~3개를 Nelder–Mead 로 맞춥니다(슬라이더 범위 안, 로그 스케일 옵션). 결과를 확인한 뒤 **적용**합니다.
- **적분기**: 시뮬레이션 설정에서 자동(강성 감지 시 Rodas3 로 전환) / 명시적(Dormand–Prince 5) / 강성(Rodas3)을 고릅니다.
- **단위 검사**: 변수·상태의 단위 칸(`mg`, `L/h`, `1/h`, `µM`, `-` 등)을 채우면 방정식 항의 차원이 좌변과 다를 때 경고합니다. 비워 둔 변수가 든 항은 검사하지 않습니다.

## 구성
- `index.html` 한 파일로 동작합니다 (HTML·CSS·JS 포함).
- 수식 렌더링은 MathJax 3 (cdnjs)를 불러옵니다. 오프라인에서는 LaTeX 원문으로 표시됩니다.
- 계산 코어(수식 파서, LaTeX 출력, 공유 링크 인코딩, 컴파일, Dormand–Prince·Rodas3 적분기와 자동 전환, Nelder–Mead·파라미터 추정, 단위 검사, 보간, 눈금, 그래프 SVG, 코드·SBML 내보내기)는 `/* @core-start */ … /* @core-end */` 주석으로 표시돼 있고 DOM을 건드리지 않습니다.
- 스윕과 파라미터 추정은 같은 `@core` 블록을 페이지의 `<script>` 텍스트에서 꺼내 Blob URL 로 만든 Web Worker 에서 돌립니다. Worker 를 만들 수 없는 환경(`file://`)에서는 메인 스레드에서 계산합니다.
- 저장 형식: `localStorage` 키 `ode-equation-builder-v1`(현재 모델), `ode-builder-presets-v1`(내 프리셋). 예전에 내보낸 JSON 도 `normalize()` 가 기본값을 채워 그대로 불러옵니다.

## 테스트
`test/core.test.js`가 `index.html`에서 `@core` 블록을 그대로 꺼내 Node 내장 러너로 돌립니다. 파서 우선순위, LaTeX 출력 형식, 적분기 정확도(해석해 대비), 반복 투약의 중첩 원리·질량 보존, 강성 적분기(y′ = −1000(y − cos t) 해석해, Robertson 문제, 3차 수렴)와 자동 전환, Nelder–Mead(2차 함수·Rosenbrock)와 파라미터 복원, 단위 파서·추론·방정식 검사, 공유 링크 왕복(압축·비압축), 그래프 SVG 와 SBML 의 XML 균형, R/Julia/Python 코드 내용을 검사합니다. 코어에 함수를 추가하면 테스트 파일의 `names` 배열에도 이름을 넣어야 합니다.
```
npm test        # Node 22+, 의존성 없음
```
푸시할 때마다 GitHub Actions가 같은 테스트를 돌립니다. 앞으로 할 일은 [ROADMAP.md](ROADMAP.md)에 있습니다.

## 챕터 2 · 장내 미생물 → PBPK (`chapter2/`)
챕터 1과 같은 편집기에서 단계를 따라갑니다. 로트카–볼테라로 장내 미생물을 먼저 보고, 대사산물·P-gp 발현을 거쳐 PBPK에 연결합니다.

| 단계 | 내용 |
|---|---|
| 2-1 | 로트카–볼테라 2군 경쟁 (공생균 x_c vs 기회균 x_o), 로지스틱 해석해 검증, 평형점 |
| 2-2 | 교란과 회복: 장염 · 항생제 · FIP (각각 켜고 끔) |
| 2-3 | 대사산물 S_m → P-gp 발현 P_gp (간접 반응, 기준 1) |
| 2-4 | P_gp → 출구 k_out, 장염 설사 → 통과 k_tr. 장 3구획(내강 → 장 세포 → 혈액) + 챕터 1 모델 1 몸, 28일 투약 |
| 2-5 | k_in·k_out·k_tr 배수 민감도와 분석 화면(`analysis.html`: 시나리오 겹쳐 그리기 · 분배 프리셋 비교 · 히트맵) |

- F는 입력이 아니라 결과값입니다. 고양이 장내 미생물·수송체 자료는 없어 미생물·교란·P-gp 값은 모두 가정이며, P-gp 변화의 방향만 문헌 확인(마우스·사람, 대장)입니다.
- `chapter2/index.html`(편집기)과 `chapter2/engine.gen.js`(분석 화면용 계산 코드)는 `index.html`에서 자동 생성한 파일입니다. 직접 고치지 말고 `index.html`이나 `chapter2/stages.js`를 고친 뒤 `node tools/build-engine.mjs`로 다시 만드세요.
- 단계 내용은 `chapter2/stages.js`(STAGE_PACK)에 있습니다. `index.html`은 STAGE_PACK이 있으면 진행 단계·설명·저장 키를 그것으로 바꾸고, 없으면 챕터 1 그대로 동작합니다.
- 페이지가 스크립트 파일을 불러오므로 로컬에서는 정적 서버로 여세요 (예: `python -m http.server`).
- 2-4·2-5의 적분기는 명시적(Dormand–Prince)으로 고정했습니다. 자동은 이 모델에서 Rodas3로 바뀌어 약 2.7배 느리고, 결과 차이는 1e-5 수준입니다.

## 검증
- `node tests/baseline.mjs` — 챕터 1 모든 단계의 지표가 `tests/baseline.json` 기록과 같은지 (회귀)
- `node tests/chapter2.mjs` — 챕터 2 단계별 검사(해석해·평형점·교란 끔·질량 보존)와 장 모델(F 닫힌 식·보정), 생성 파일 최신 여부
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
