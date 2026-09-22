# Make Up AR

전면 카메라에서 헤어 컬러와 메이크업을 실시간 합성하는 모바일 우선 웹 프로토타입이다. 얼굴 랜드마크와 헤어 분할은 MediaPipe Tasks Vision 워커가 독립적으로 처리하고, 화면 효과는 앱의 단일 WebGL2 렌더러가 매 프레임 합성한다.

OpenMakeupSDK 런타임은 사용하지 않는다. 파운데이션용 마스크 에셋 하나만 프로젝트에 포함하며, 원본 MIT 라이선스는 `public/makeup/LICENSE.OpenMakeupSDK`와 `THIRD_PARTY_LICENSES/OpenMakeupSDK-MIT.txt`에 보존한다.

```sh
npm ci
npm run assets:verify
npm run dev
```

Node.js `^20.19.0 || >=22.12.0`과 카메라 권한이 필요하다. 실제 휴대폰에서는 HTTPS로 접속해야 한다.
