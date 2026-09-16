# Third-party notices

## MediaPipe Tasks Vision 1.0.1 and bundled model assets

`@mediapipe/tasks-vision` 1.0.1, the copied WASM loaders/binaries under `public/vendor/mediapipe/`, and the two model assets under `public/models/` are bundled for local browser execution. Exact model URLs and hashes are recorded in `public/models/models.manifest.json`.

- License identifier: `Apache-2.0`
- Included license text: [`THIRD_PARTY_LICENSES/Apache-2.0.txt`](./THIRD_PARTY_LICENSES/Apache-2.0.txt)
- Upstream license URL: <https://www.apache.org/licenses/LICENSE-2.0>

The FaceLandmarker bundle is documented as containing BlazeFace short-range, FaceMesh V2, and Blendshape V2 component models. The Hair Segmenter is documented separately. The manifest records the official model-card URL for every component used as licensing evidence.

Distributors of these assets must retain applicable Apache-2.0 license and notice information, including any relevant `NOTICE` material supplied with the distributed asset. This file records provenance and distribution hygiene; it is not legal advice or a legal approval.

## OpenMakeupSDK 0.1.0

라이브 립·아이섀도·아이라인·블러셔 렌더링에 OpenMakeupSDK 0.1.0을 사용한다. 얼굴 변형 기능은 사용하지 않는다. 메이크업 셰이더·모델·패턴은 고정된 jsDelivr 0.1.0 경로에서 로드한다.

- License identifier: `MIT`
- Included license text: [`THIRD_PARTY_LICENSES/OpenMakeupSDK-MIT.txt`](./THIRD_PARTY_LICENSES/OpenMakeupSDK-MIT.txt)
- Upstream: <https://github.com/ehsanwwe/OpenMakeupSDK>

## three.js 0.184.0

OpenMakeupSDK의 WebGL 렌더링 peer dependency로 three.js 0.184.0을 포함한다.

- License identifier: `MIT`
- Included license text: [`THIRD_PARTY_LICENSES/three-MIT.txt`](./THIRD_PARTY_LICENSES/three-MIT.txt)

## MediaPipe Face Mesh 0.4.1633559619 and Camera Utils 0.3.1675466862

OpenMakeupSDK의 얼굴 위치 추적 peer dependency다. 앱이 이미 소유한 카메라 스트림을 재사용하며 Camera Utils가 별도 카메라를 요청하지 않는다.

- License identifier: `Apache-2.0`
- Included license text: [`THIRD_PARTY_LICENSES/Apache-2.0.txt`](./THIRD_PARTY_LICENSES/Apache-2.0.txt)
