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
- 계산 코어(수식 파서, LaTeX 출력, 컴파일, Dormand–Prince 적분기, 보간, 눈금)는 `/* @core-start */ … /* @core-end */` 주석으로 표시돼 있고 DOM을 건드리지 않습니다.

## 테스트
`test/core.test.js`가 `index.html`에서 `@core` 블록을 그대로 꺼내 Node 내장 러너로 돌립니다. 파서 우선순위, LaTeX 출력 형식, 적분기 정확도(해석해 대비), 반복 투약의 중첩 원리·질량 보존 등을 검사합니다.
```
npm test        # Node 22+, 의존성 없음
```
푸시할 때마다 GitHub Actions가 같은 테스트를 돌립니다. 앞으로 할 일은 [ROADMAP.md](ROADMAP.md)에 있습니다.

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
