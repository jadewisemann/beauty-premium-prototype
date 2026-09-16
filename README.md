# BECON Beauty Mirror

전면 카메라를 계속 보면서 헤어 컬러와 메이크업을 바꾸는 모바일 우선 웹 프로토타입이다.

- 헤어 컬러: MediaPipe Hair Segmenter의 기본 confidence mask 위에 색상 레이어를 합성한다.
- 베이스·립·블러셔·아이: OpenMakeupSDK 0.1.0을 사용한다.
- 얼굴형 변경: 사용하지 않는다. morph·blur·wireframe과 face mesh 표시는 꺼 둔다.
- 카메라: 앱이 한 번만 열고 두 효과가 같은 video를 공유한다.

## 실행

Node.js `^20.19.0 || >=22.12.0`이 필요하다.

```sh
npm ci
npm run assets:verify
npm run dev
```

실제 휴대폰 카메라는 HTTPS와 사용자 권한이 필요하다. OpenMakeupSDK의 셰이더·모델·패턴은 고정된 jsDelivr 0.1.0 URL에서 로드한다.

## 검증

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

실제 iPhone/Android의 시각 품질·발열과 CDN 장애 동작은 아직 확인하지 않았다.
