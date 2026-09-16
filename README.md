# BECON Beauty Playground

사진과 전면 카메라에서 헤어 컬러·아이·립·블러셔를 로컬 합성하는 모바일 웹 프로토타입이다. React + TypeScript + Vite, MediaPipe Tasks Vision, OpenMakeupSDK와 자체 WebGL2 헤어 렌더러로 구성되며 이미지·랜드마크·마스크는 기본 경로에서 서버로 보내지 않는다.

## 실행

Node.js `^20.19.0 || >=22.12.0`이 필요하다.

```sh
cd /Users/yujin/Downloads/_becon/beauty-premium-prototype/repo
npm ci
npm run assets:verify
npm run dev
```

실제 휴대폰 카메라는 HTTPS secure context와 사용자의 권한 허용이 필요하다. Vite가 표시하는 일반 HTTP LAN 주소는 휴대폰 카메라 검증 주소로 충분하지 않다.

고객 화면에서는 개발용 raw/refined mask, 반복 영상, 진단 패널을 숨긴다. 필요할 때 URL에 `?debug=1`을 붙여 연다.

전체 자동 검증 명령은 다음과 같다.

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## 구현 범위

- JPEG/PNG/WebP 사진, 전면 카메라, 반복 영상 입력
- 로컬 고정 모델을 사용하는 FaceLandmarker + Hair Segmenter 단일 worker
- 한 프레임 처리 중 최신 대기 프레임 하나만 유지하는 bounded scheduler
- 실제 raw hair confidence, 5×5 joint bilateral refined mask, 포즈 정렬 시간축 결합
- 브라우저 video 원본과 투명 WebGL 효과 레이어 분리, 최신 얼굴 포즈 기반 hair mask 재투영
- 선형 sRGB/OKLab 기반 헤어 재질, even-odd 립 마스크, 얼굴 영역 제한 블러셔
- 라이브 립·아이·블러셔는 OpenMakeupSDK를 사용하며 face warp·morph·blur·wireframe은 비활성화
- 모바일 편집 중 얼굴이 계속 보이는 sticky 미리보기
- 6개 실험용 룩, 부위 잠금, 20단계 Undo/Redo, 헤어 질감 3종·아이섀도/아이라인·립 4재질·블러셔 2배치 조절
- 원본 홀드, 동일 프레임 라이브 2분할, 사진 4분할
- 라이브 프레임+recipe revision 동결 후 IMAGE 모드 재분석
- JPEG/PNG 저장과 다운로드 차단 시 새 이미지 열기
- 원본/raw/refined/final 보기, 반복 영상, 좌표·이미지를 제외한 진단 JSON
- visibility pause/resume, task timeout worker 교체, WebGL context loss 후 generation reset·재분석

사진의 색·강도·룩 변경은 저장된 분석 결과를 재사용하며 모델을 다시 실행하지 않는다. 저장 해상도는 화면 캔버스 기준 긴 변 `min(2048, sourceLongEdge)`이고, 작은 원본을 2048로 확대하지 않는다.

## 렌더링 구조

`src/engine/renderer.ts`가 모든 WebGL 자원을 소유한다. 라이브 원본 video 위에 투명 효과 canvas를 올리고, source 업로드, hair 경계 보정, 이전 mask 정렬/혼합, 큰 명암 신호, 부위 coverage, 최종 효과 합성 순서로 실행한다. texture는 크기가 같으면 재사용하고 앱 소유 texture만 계산 장부에 기록한다. 진단의 메모리 값은 브라우저 전체 VRAM 사용량이 아니다.

`src/engine/perception.worker.ts`는 두 MediaPipe task를 직렬 실행한다. ES module worker에서 MediaPipe WASM loader가 task별로 다시 실행되도록 고유 loader URL을 만들며, callback mask는 앱 소유 `Uint8Array`로 복사한 뒤 SDK 결과를 닫는다. `generation`이 다른 결과는 표시하지 않고 버퍼를 반환한다.

## 현재 자동 검증

2026-09-16 로컬 Chromium에서 다음을 확인했다.

- 로컬 모델/WASM 초기화와 READY 전환
- 카메라 권한 거절 오류 코드와 사진 경로 유지
- Chromium 고정 가상 카메라의 라이브 worker/scheduler 및 촬영→사진 전환
- 공식 MediaPipe 고정 fixture에서 얼굴 478점과 640×640 hair confidence
- 룩 변경 중 추론 횟수 불변, 2/4분할, JPEG 다운로드
- WebGL context 강제 손실 후 사진 generation 재분석·복구

단위 테스트는 좌표 round-trip, 입력 해제, bounded queue, 색공간 수학, lip loop, blush geometry, preset 잠금, Undo/Redo, temporal freshness, lifecycle timeout, export cleanup을 검사한다. fixture 출처와 해시는 `tests/fixtures/README.md`에 기록되어 있다.

## 검증하지 않은 것

아래 항목은 코드가 있거나 데스크톱 자동화가 성공했더라도 통과로 주장하지 않는다.

- 실제 iPhone Safari와 Android Chrome의 카메라/GPU/발열/5분 안정성
- 동의받은 8~12명 자료와 미튜닝 인물 3명을 사용한 사람 평가
- 흑발·앞머리·역광·큰 회전·손/안경 가림 전반의 시각 품질
- 핵심 룩 평가 4점 이상 80%, effects-active 95% 같은 제품 품질 목표
- HDR/광색역 보존, 완전한 피부/손/가림 segmentation
- 제품 룩 값·브랜드 문구·지원 기기 승인과 법무/보안 최종 승인

수동 증거를 기록할 때는 [`docs/evidence/README.md`](./docs/evidence/README.md)의 매트릭스를 사용한다.

## 자산과 권리 기록

모델과 WASM은 배포 파일에 포함된다. 정확한 버전·고정 URL·크기·SHA-256은 `public/models/models.manifest.json`과 `scripts/verify-assets.mjs`가 확인한다. MediaPipe Tasks Vision과 모델 카드의 Apache-2.0 고지는 [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md), 라이선스 전문은 [`THIRD_PARTY_LICENSES/Apache-2.0.txt`](./THIRD_PARTY_LICENSES/Apache-2.0.txt)에 있다.

이 기록은 재배포 조건을 이행하기 위한 기술 자료이며 법률 자문이나 회사의 출시 승인을 대신하지 않는다.

## 제외 범위

모델 학습, 서버 추론, 헤어스타일 생성, 피부/퍼스널컬러 진단·추천, 계정·DB·장기 사진 보관, 분석 SDK, PWA/서비스워커는 만들지 않았다. 원문 구현 기준은 저장소 밖의 `BECON_Prototype_Development_Spec_v1.0.md`이며 아이 메이크업 확장은 후속 사용자 지시다.
