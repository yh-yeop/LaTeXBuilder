# 로드맵 · 수식 빌더 (PBPK 투여 모델링)

우선순위는 P0(지금) → P1(다음) → P2(여유 있을 때). 완료한 항목은 체크.

## P0 — 기반
- [x] 계산 코어를 `@core` 주석 블록으로 표시하고 `node --test`로 검사: 파서, toText 왕복, LaTeX 출력, fmt, compile, 적분기(해석해 대비 1e-6), 반복 투약(중첩 원리·질량 보존), 투약 이벤트 경고, 보간, 눈금
- [x] GitHub Actions에서 푸시마다 테스트 실행
- [x] 버그 수정: `-ka*t` 같은 식이 `(-ka)*t`, `e^{\left(-ka\right) t}` 로 표시되던 것을 `-ka*t`, `e^{-ka \, t}` 로
- [x] 파비콘·메타 설명 (404 제거, 링크 미리보기)

## P1
- [x] 모델 공유 링크: 현재 모델을 deflate-raw 로 압축해 Base64URL 로 URL `#m=z.…` 에 담기 (압축을 못 쓰면 `#m=j.…`). 열 때 저장된 모델보다 우선 적용하고 해시를 지움. `encodeShare`/`decodeShare` 테스트
- [x] 파라미터 추정: 비교 카드 “데이터에 맞추기” — 상수 최대 3개를 슬라이더 범위 안에서(로그 스케일 옵션) Nelder–Mead 로 맞춤. 목적함수는 켜진 실측 데이터 비교의 로그 오차(양수 데이터) 또는 상대 제곱 오차. 전/후 지표를 보고 적용. `nelderMead`·`fitProblem` 테스트(Rosenbrock, 2차 함수, ka·CL 복원)
- [x] 강성(stiff) 문제 대비: Rodas3(Rosenbrock, L-안정, 수치 야코비안) 구현. 자동 모드는 Dormand–Prince 로 가다가 강성 감지(Hairer 기준)·스텝 수 초과·스텝 과소 시 그 지점부터 강성 적분기로 이어 가고 파란 배너로 알림. 시뮬레이션 설정에서 자동/명시적/강성 선택. 테스트(해석해 1e-4 이내, Robertson, 3차 수렴)
- [x] 스윕과 파라미터 추정을 Web Worker 로: 페이지 `<script>` 에서 `@core` 블록을 꺼내 Blob URL Worker 생성(테스트와 같은 추출 방식). `file://` 등 Worker 를 못 만들면 동기·setTimeout 청크로 폴백
- [x] 단위 검사: 단위 문자열 → 차원 벡터(질량·부피·시간·물질량) 파서와 식 단위 추론. 각 방정식에서 (좌변 계수 × 상태 ÷ 시간) 과 항의 단위가 다르면 “방정식 N 항 k: mg/h 이어야 하는데 mg/L/h 입니다” 경고. 단위를 모르는 변수가 든 항은 건너뜀. 숫자 리터럴은 단위 무관

## P2
- [x] ~~코어를 별도 파일(`core.js`)로 빼기~~ — 불필요해져 종료. 파일 하나 구조를 유지하기로 했고, 테스트와 Worker 가 이미 `@core` 블록 텍스트를 그대로 재사용하므로 분리의 이득이 없음
- [x] 내보내기 추가: R(deSolve, events) / Julia(DifferentialEquations.jl, PresetTimeCallback) / SBML L3V2(compartment 1개, species=상태(rateRule), parameter=상수, assignmentRule=식 변수, event=투약). “코드 내보내기” 대화상자 탭. 테스트(이름 포함, XML 균형)
- [x] 프리셋: 코드로 만든 단계 프리셋은 함수로 두고, 사용자 프리셋을 “내 프리셋으로 저장”(localStorage `ode-builder-presets-v1`) · 상단 목록에서 불러오기 · 관리 대화상자에서 삭제 · 목록 JSON 내보내기/가져오기
- [x] 그래프 PNG(배경 채운 canvas.toBlob) / SVG(`plotToSvg`, 캔버스와 같은 레이아웃 자료) 저장. 테스트(XML 균형, polyline 수 = 시리즈 수)

## 다음 후보
- [ ] 파라미터 추정 결과의 불확실성(부트스트랩 또는 야코비안 기반 표준오차)
- [ ] 단위 검사에서 배율(ng/mL ↔ mg/L)까지 보고 환산 계수 제안
- [ ] SBML 불러오기 (내보내기의 역방향)
