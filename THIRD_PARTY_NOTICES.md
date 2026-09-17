# Third-party notices

## MediaPipe Tasks Vision 1.0.1 and Hair Segmenter

`@mediapipe/tasks-vision` 1.0.1, `public/vendor/mediapipe/`의 WASM 파일과 `public/models/hair_segmenter.tflite`를 브라우저 로컬 실행용으로 포함한다. 모델 URL과 SHA-256은 `public/models/models.manifest.json`에 기록한다.

- License identifier: `Apache-2.0`
- Included license text: [`THIRD_PARTY_LICENSES/Apache-2.0.txt`](./THIRD_PARTY_LICENSES/Apache-2.0.txt)
- Upstream license URL: <https://www.apache.org/licenses/LICENSE-2.0>

배포 시 적용되는 Apache-2.0 라이선스와 고지 정보를 유지해야 한다.

## OpenMakeupSDK 0.1.0

파운데이션·립·아이섀도·아이라인·블러셔 렌더링에 사용한다. 얼굴 변형 기능은 사용하지 않는다.

- License identifier: `MIT`
- Included license text: [`THIRD_PARTY_LICENSES/OpenMakeupSDK-MIT.txt`](./THIRD_PARTY_LICENSES/OpenMakeupSDK-MIT.txt)
- Upstream: <https://github.com/ehsanwwe/OpenMakeupSDK>

OpenMakeupSDK의 peer dependency인 three.js 0.184.0, MediaPipe Face Mesh 0.4.1633559619와 Camera Utils 0.3.1675466862를 포함한다. 앱이 소유한 카메라 스트림을 재사용한다.
