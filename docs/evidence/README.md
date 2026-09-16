# 검증 증거 기록

이 폴더는 실제 기준 기기 영상·측정 JSON·결함표를 보관한다. 파일이 없으면 통과하지 않은 것이다. 자동화, 사람의 시각 평가, 실제 모바일 검증은 서로 대체하지 않는다.

## 자동화 기준선 — 2026-09-16

| 경로 | 환경 | 결과 | 한계 |
|---|---|---|---|
| 모델/WASM 초기화 | Playwright Chromium, production preview | PASS | 실제 모바일 아님 |
| 권한 거절 | `NotAllowedError` 주입 | PASS | 브라우저 실제 권한 UI 아님 |
| 라이브 | Chromium fixed fake camera + 상하 색 띠 canvas capture | PASS | 방향 회귀·bounded path 검증, 실제 얼굴·모바일 카메라 아님 |
| 사진 인식 | 공식 MediaPipe `face_model.png` 고정 fixture | PASS, face 478 / hair 640×640 | 한 인물·한 조건 |
| 룩 변경 캐시 | 사진 편집 중 completed-frame 불변 | PASS | 장기 100회 수동 검증 아님 |
| 비교·저장 | 2분할, 4분할, JPEG download | PASS | 실제 Safari/Chrome 다운로드 UI 아님 |
| context loss | `WEBGL_lose_context` 강제 손실/복구 | PASS | 반복 손실·기기 드라이버 결함 아님 |

재현 명령:

```sh
npm run assets:verify
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## 모바일 수동 증거 매트릭스

기준 기기와 브라우저 버전을 먼저 채운다. 각 셀에는 `PASS`, `FAIL`, `BLOCKED`, `NOT RUN` 중 하나와 증거 경로를 함께 적는다.

| 시나리오 | iPhone Safari (모델/OS/버전) | Android Chrome (모델/OS/버전) | 필요한 증거 |
|---|---|---|---|
| HTTPS 접속·모델 초기화 | NOT RUN | NOT RUN | 영상, 콘솔/진단 JSON |
| 카메라 허용·거절·재시도 | NOT RUN | NOT RUN | 권한 UI 포함 영상 |
| 헤어·립·볼 동시 라이브 5분 | NOT RUN | NOT RUN | 전체 영상, FPS/지연/발열 |
| 정지·천천히 좌우 회전 | NOT RUN | NOT RUN | raw/refined/final 동시 비교 |
| 웃기·입 벌리기·말하기 | NOT RUN | NOT RUN | 치아·입 안 오염 기록 |
| 흑발·갈색·앞머리·귀 | NOT RUN | NOT RUN | 누락·번짐 동일 crop 비교 |
| 밝은/어두운 배경·역광 | NOT RUN | NOT RUN | 배경 착색·경계 기록 |
| 손/안경 가림과 복귀 | NOT RUN | NOT RUN | 남는 착색 결함 기록 |
| 원본 홀드 cancel·동일 frame 2분할 | NOT RUN | NOT RUN | 포인터 취소 포함 영상 |
| 라이브 촬영→IMAGE 재분석 | NOT RUN | NOT RUN | 촬영 전후 동일 색감 비교 |
| 사진 4분할·100회 룩 변경 | NOT RUN | NOT RUN | 추론 카운터/메모리 JSON |
| JPEG/PNG 방향·색·crop·해상도 | NOT RUN | NOT RUN | 저장 파일과 화면 비교 |
| background/복귀·입력 20회 | NOT RUN | NOT RUN | track 종료·잔류 mask 검사 |
| context loss·timeout 복구 | NOT RUN | NOT RUN | 오류 코드·복구 영상 |

## 시각 평가

동의받은 8~12명 자료를 사용하고 최소 3명은 튜닝에 쓰지 않는다. 자연스러움·경계·머리결·움직임·비교 유용성을 각각 1~5점으로 기록한다. 원본/개선판은 동일 frame·crop·recipe를 사용한다. 핵심 룩 4점 이상 80%와 effects-active 95%는 목표일 뿐, 실제 표본 수와 결과 없이 PASS로 적지 않는다.

지원 조건에서 반복되는 치아 착색, 다른 입력의 mask 잔류, 명확한 배경 오염은 평균 점수와 관계없이 차단 결함이다.

## 기록 형식

각 실행에는 커밋, 날짜/시간, 기기·OS·브라우저, 화면 방향, 권한, 입력 식별자/해시, recipe revision, 결과, 오류 코드, 영상/스크린샷/진단 JSON 경로를 남긴다. 사용자 이미지와 영상은 동의·보관 정책이 확인된 것만 넣는다.

제품 담당자는 룩·브랜드·시각 합격선을, 기술 담당자는 기준 기기·HTTPS 호스트·지원 범위를, 법무/보안 담당자는 모델/WASM/fixture 재배포와 개인정보 문구를 최종 승인해야 한다.
