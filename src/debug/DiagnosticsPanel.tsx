import type { ControllerSnapshot } from '../engine/controller';
import type { DiagnosticsSnapshot } from '../engine/diagnostics';

interface Props {
  controller: ControllerSnapshot;
  diagnostics: DiagnosticsSnapshot;
  onDownload(): void;
}

export function DiagnosticsPanel({ controller, diagnostics, onDownload }: Props) {
  const faceCount = controller.face ? controller.face.landmarks.length / 3 : 0;
  return (
    <section className="diagnostics" aria-label="진단 정보">
      <div className="diagnostics-heading">
        <div>
          <span className="eyebrow">Local diagnostics</span>
          <h2>실제 모델 출력</h2>
        </div>
        <button className="secondary-button" type="button" onClick={onDownload}>측정 JSON</button>
      </div>
      <dl className="metric-grid">
        <Metric label="상태" value={controller.state} />
        <Metric label="입력" value={controller.sourceKind ?? '없음'} />
        <Metric label="얼굴 점" value={faceCount ? `${faceCount}` : '미검출'} />
        <Metric label="헤어 마스크" value={controller.hair ? `${controller.hair.width}×${controller.hair.height}` : '미검출'} />
        <Metric label="프레임 완료" value={`${diagnostics.counters['frames-completed'] ?? 0}`} />
        <Metric label="마스크 복사" value={formatMs(diagnostics.timings['hair-readback-copy']?.latestMs)} />
        <Metric label="렌더 draw" value={`${diagnostics.gauges['renderer-draw-calls'] ?? 0}`} />
        <Metric label="앱 texture" value={`${(diagnostics.gauges['renderer-texture-mib'] ?? 0).toFixed(1)}MiB`} />
      </dl>
      <p className="fine-print">
        좌표·이미지는 JSON에 넣지 않습니다. 메모리는 앱 소유 texture의 계산 장부이며 브라우저 전체 VRAM 측정값이 아닙니다.
      </p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function formatMs(value: number | undefined): string {
  return value === undefined ? 'N/A' : `${value.toFixed(1)}ms`;
}
