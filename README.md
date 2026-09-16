# BECON Beauty Mirror

전면 카메라를 계속 보면서 헤어 컬러와 메이크업을 바꾸는 모바일 우선 웹 프로토타입이다. MediaPipe Hair Segmenter는 confidence mask를 최대 15fps, 긴 변 320px로 처리하고, OpenMakeupSDK는 같은 카메라 영상에 베이스·립·블러셔·아이를 합성한다. 얼굴형 변경은 사용하지 않는다.

```sh
npm ci
npm run assets:verify
npm run dev
```

Node.js `^20.19.0 || >=22.12.0`과 카메라 권한이 필요하다. 실제 휴대폰에서는 HTTPS로 접속해야 한다.
