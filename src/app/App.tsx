import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DiagnosticsPanel } from '../debug/DiagnosticsPanel';
import { BeautyController } from '../engine/controller';
import type { BlushRecipe, HairRecipe, LipRecipe, LookRecipe, Region } from '../engine/contracts';
import { downloadBlob, exportCanvas } from '../engine/export';
import type { RenderView, RendererMetrics } from '../engine/renderer';
import { BLUSH_PALETTES, DRAFT_LOOKS, HAIR_COLORS, LIP_COLORS } from '../looks/presets';
import {
  applyPreset,
  beginSliderTransaction,
  commitRecipe,
  commitSliderTransaction,
  createRecipeHistory,
  patchRegion,
  redoRecipe,
  type RegionLocks,
  undoRecipe,
  updateSliderTransaction,
} from './recipe-state';
import { BeautyViewport } from './BeautyViewport';
import './styles.css';

const viewOptions: Array<{ id: RenderView; label: string }> = [
  { id: 'original', label: '원본' },
  { id: 'raw-mask', label: 'Raw mask' },
  { id: 'refined-mask', label: 'Refined' },
  { id: 'final', label: '최종' },
];

type Tab = Region | 'looks';
type CompareMode = 'none' | 'split' | 'grid';

export function App() {
  const [controller] = useState(() => new BeautyController());
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [history, setHistory] = useState(() => createRecipeHistory(DRAFT_LOOKS[0]));
  const [locks, setLocks] = useState<RegionLocks>({});
  const [tab, setTab] = useState<Tab>('looks');
  const [view, setView] = useState<RenderView>('final');
  const [compare, setCompare] = useState<CompareMode>('none');
  const [originalHeld, setOriginalHeld] = useState(false);
  const [diagnostics, setDiagnostics] = useState(() => controller.diagnostics.snapshot());
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [format, setFormat] = useState<'png' | 'jpg'>('jpg');
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recipe = history.present;
  const unavailableError = snapshot.error && ['MODEL_INIT_FAILED', 'WORKER_FAILED', 'TIMEOUT', 'CONTEXT_LOST'].includes(snapshot.error.code);
  const ready = snapshot.state === 'READY' || snapshot.state === 'LIVE' || snapshot.state === 'PHOTO' || (snapshot.state === 'ERROR' && !unavailableError);
  const isLive = snapshot.state === 'LIVE' || snapshot.state === 'PAUSED';

  useEffect(() => {
    void controller.initialize();
    const interval = window.setInterval(() => setDiagnostics(controller.diagnostics.snapshot()), 500);
    const visibility = () => controller.setVisibility(!document.hidden);
    const releaseOriginal = () => setOriginalHeld(false);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', releaseOriginal);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', releaseOriginal);
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => () => { if (savedUrl) URL.revokeObjectURL(savedUrl); }, [savedUrl]);

  const choosePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setCompare('none');
      void controller.selectPhoto(file);
    }
    event.target.value = '';
  };

  const chooseReplay = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && videoRef.current) {
      setCompare('none');
      void controller.startReplay(videoRef.current, file);
    }
    event.target.value = '';
  };

  const selectPreset = (preset: LookRecipe) => setHistory((current) => commitRecipe(current, applyPreset(current.present, preset, locks)));
  const patch = (region: Region, values: Partial<HairRecipe> | Partial<LipRecipe> | Partial<BlushRecipe>) => {
    setHistory((current) => commitRecipe(current, patchRecipe(current.present, region, values)));
  };
  const updateSlider = (region: Region, values: Partial<HairRecipe> | Partial<LipRecipe> | Partial<BlushRecipe>) => {
    setHistory((current) => updateSliderTransaction(current, patchRecipe(current.present, region, values)));
  };

  const updateMetrics = (metrics: RendererMetrics) => {
    controller.diagnostics.setGauge('renderer-draw-calls', metrics.drawCalls);
    controller.diagnostics.setGauge('renderer-texture-mib', metrics.textureBytes / 1024 / 1024);
    controller.diagnostics.setGauge('renderer-context-losses', metrics.contextLosses);
    controller.diagnostics.setGauge('hair-freshness', metrics.hairFreshness);
    controller.diagnostics.setGauge('face-freshness', metrics.faceFreshness);
  };

  const save = async () => {
    setView('final');
    setCompare('none');
    setOriginalHeld(false);
    await nextPaint();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { blob, filename } = await exportCanvas(canvas, format, format === 'jpg' ? 0.92 : undefined);
    downloadBlob(blob, filename);
    if (savedUrl) URL.revokeObjectURL(savedUrl);
    setSavedUrl(URL.createObjectURL(blob));
  };

  const displayedView: RenderView = originalHeld ? 'original' : view;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><span className="eyebrow">BECON · PROTOTYPE</span><h1>Beauty Playground</h1></div>
        <span className={`state-pill state-${snapshot.state.toLowerCase()}`}>{stateLabel(snapshot.state)}</span>
      </header>

      <section className={`stage-card ${compare === 'grid' && snapshot.state === 'PHOTO' ? 'stage-grid' : ''}`}>
        <video ref={videoRef} className="source-video" muted playsInline aria-hidden="true" />
        {compare === 'grid' && snapshot.state === 'PHOTO' ? (
          DRAFT_LOOKS.slice(0, 4).map((look) => (
            <div className="grid-look" key={look.id}>
              <BeautyViewport controller={controller} videoRef={videoRef} recipe={look} view="final" resolutionScale={0.5} />
              <span>{shortLabel(look.label)}</span>
            </div>
          ))
        ) : (
          <BeautyViewport ref={canvasRef} controller={controller} videoRef={videoRef} recipe={recipe} view={displayedView} splitCompare={compare === 'split'} onRendererError={(message) => { setRendererError(message); controller.reportRendererError(message); }} onRendererRecovered={() => setRendererError(null)} onMetrics={updateMetrics} />
        )}
        {!snapshot.sourceKind && <div className="empty-state"><span>사진 또는 카메라를 선택하세요</span><small>이미지와 분석 결과는 서버로 전송하지 않습니다.</small></div>}
        {snapshot.state === 'ANALYZING_PHOTO' && <div className="stage-message">사진 정밀 적용 중…</div>}
        {snapshot.state === 'PHOTO' && !snapshot.face && snapshot.hair && <div className="stage-message">얼굴 미검출 · 헤어만 적용됩니다.</div>}
        {snapshot.state === 'PHOTO' && snapshot.face && !snapshot.hair && <div className="stage-message">헤어 미검출 · 립과 블러셔만 적용됩니다.</div>}
        {snapshot.state === 'PHOTO' && !snapshot.face && !snapshot.hair && <div className="stage-message">적용 가능한 얼굴·헤어 결과를 찾지 못했습니다.</div>}
        {compare === 'split' && snapshot.sourceKind && <div className="split-labels"><span>원본</span><span>적용</span></div>}
      </section>

      <section className="source-controls" aria-label="입력 선택">
        <button className="primary-button" type="button" disabled={!ready || snapshot.state === 'LOADING_MODELS'} onClick={() => videoRef.current && void controller.startCamera(videoRef.current)}>카메라</button>
        <label className="secondary-button file-button">사진<input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} disabled={!ready} /></label>
        <label className="text-button file-button">반복 영상<input type="file" accept="video/*" onChange={chooseReplay} disabled={!ready} /></label>
      </section>

      <section className="quick-actions" aria-label="비교 및 촬영">
        <button type="button" className={originalHeld ? 'active' : ''} disabled={!snapshot.sourceKind} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setOriginalHeld(true); }} onPointerUp={() => setOriginalHeld(false)} onPointerCancel={() => setOriginalHeld(false)} onLostPointerCapture={() => setOriginalHeld(false)}>원본 홀드</button>
        <button type="button" disabled={!snapshot.sourceKind} className={compare === 'split' ? 'active' : ''} onClick={() => setCompare(compare === 'split' ? 'none' : 'split')}>2분할</button>
        <button type="button" disabled={snapshot.state !== 'PHOTO'} className={compare === 'grid' ? 'active' : ''} onClick={() => setCompare(compare === 'grid' ? 'none' : 'grid')}>4분할</button>
        <button type="button" disabled={!isLive} onClick={() => videoRef.current && void controller.captureFrame(videoRef.current, recipe.revision)}>촬영</button>
      </section>

      <nav className="view-switcher" aria-label="개발 보기">
        {viewOptions.map((option) => <button key={option.id} type="button" className={view === option.id ? 'active' : ''} onClick={() => setView(option.id)}>{option.label}</button>)}
      </nav>

      <nav className="beauty-tabs" aria-label="효과 편집">
        {(['looks', 'hair', 'lip', 'blush'] as const).map((item) => <button key={item} type="button" className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{tabLabel(item)}</button>)}
      </nav>

      <section className="editor-card">
        {tab === 'looks' && <LookEditor recipe={recipe} locks={locks} onLock={(region) => setLocks((current) => ({ ...current, [region]: !current[region] }))} onSelect={selectPreset} />}
        {tab === 'hair' && <RegionEditor region="hair" recipe={recipe} colors={HAIR_COLORS} onPatch={patch} onSliderStart={() => setHistory(beginSliderTransaction)} onSlider={updateSlider} onSliderEnd={() => setHistory(commitSliderTransaction)} />}
        {tab === 'lip' && <RegionEditor region="lip" recipe={recipe} colors={LIP_COLORS} onPatch={patch} onSliderStart={() => setHistory(beginSliderTransaction)} onSlider={updateSlider} onSliderEnd={() => setHistory(commitSliderTransaction)} />}
        {tab === 'blush' && <RegionEditor region="blush" recipe={recipe} colors={BLUSH_PALETTES.flat()} onPatch={patch} onSliderStart={() => setHistory(beginSliderTransaction)} onSlider={updateSlider} onSliderEnd={() => setHistory(commitSliderTransaction)} />}
        <div className="history-actions"><button type="button" disabled={!history.past.length} onClick={() => setHistory(undoRecipe)}>실행 취소</button><button type="button" disabled={!history.future.length} onClick={() => setHistory(redoRecipe)}>다시 실행</button></div>
      </section>

      {snapshot.state === 'PHOTO' && (
        <section className="save-card">
          <div className="format-switch"><button className={format === 'jpg' ? 'active' : ''} onClick={() => setFormat('jpg')}>JPEG</button><button className={format === 'png' ? 'active' : ''} onClick={() => setFormat('png')}>PNG</button></div>
          <button className="primary-button" type="button" disabled={compare === 'grid'} onClick={() => void save()}>결과 저장</button>
          {savedUrl && <a href={savedUrl} target="_blank" rel="noreferrer">다운로드가 막히면 새 이미지로 열기</a>}
        </section>
      )}

      {(snapshot.error || rendererError) && (
        <section className="error-card" role="alert">
          <strong>{snapshot.error?.code ?? 'CONTEXT_LOST'}</strong><span>{snapshot.error?.message ?? rendererError}</span>
          {canRetryEngine(snapshot.error?.code) && <button type="button" onClick={() => { setRendererError(null); void controller.retry(); }}>엔진 다시 불러오기</button>}
          {snapshot.error?.code === 'CAMERA_DENIED' && <small>브라우저 권한을 허용한 뒤 카메라 버튼으로 다시 요청하거나 사진을 선택하세요.</small>}
          {snapshot.error?.code === 'CAMERA_UNAVAILABLE' && <small>다른 카메라를 확인하거나 사진 입력을 사용하세요.</small>}
        </section>
      )}

      <DiagnosticsPanel controller={snapshot} diagnostics={diagnostics} onDownload={() => controller.diagnostics.download()} />
    </main>
  );
}

function LookEditor({ recipe, locks, onLock, onSelect }: { recipe: LookRecipe; locks: RegionLocks; onLock(region: Region): void; onSelect(recipe: LookRecipe): void }) {
  return <>
    <div className="look-grid">{DRAFT_LOOKS.map((look) => <button key={look.id} type="button" className={recipe.id === look.id ? 'selected' : ''} onClick={() => onSelect(look)}><span style={{ background: look.hair.targetColor }} />{shortLabel(look.label)}<small>{look.mode === 'expressive' ? '표현' : '내추럴'}</small></button>)}</div>
    <p className="draft-note">초기 룩은 실험용이며 퍼스널컬러 진단이나 승인된 추천값이 아닙니다.</p>
    <div className="lock-row">{(['hair', 'lip', 'blush'] as const).map((region) => <button key={region} type="button" className={locks[region] ? 'active' : ''} onClick={() => onLock(region)}>{locks[region] ? '🔒' : '🔓'} {tabLabel(region)}</button>)}</div>
  </>;
}

function RegionEditor({ region, recipe, colors, onPatch, onSliderStart, onSlider, onSliderEnd }: {
  region: Region;
  recipe: LookRecipe;
  colors: readonly string[];
  onPatch(region: Region, values: Partial<HairRecipe> | Partial<LipRecipe> | Partial<BlushRecipe>): void;
  onSliderStart(): void;
  onSlider(region: Region, values: Partial<HairRecipe> | Partial<LipRecipe> | Partial<BlushRecipe>): void;
  onSliderEnd(): void;
}) {
  const value = recipe[region];
  return <>
    <div className="region-heading"><strong>{tabLabel(region)}</strong><label className="toggle"><input type="checkbox" checked={value.enabled} onChange={(event) => onPatch(region, { enabled: event.target.checked })} /><span /></label></div>
    <div className="swatches">{colors.map((color) => <button key={color} type="button" aria-label={`${tabLabel(region)} ${color}`} className={value.targetColor === color ? 'selected' : ''} style={{ background: color }} onClick={() => onPatch(region, { targetColor: color })} />)}</div>
    <Slider label="강도" value={value.strength} min={0} max={1} step={0.01} onStart={onSliderStart} onChange={(next) => onSlider(region, { strength: next })} onEnd={onSliderEnd} />
    {region === 'hair' && <><Slider label="밝기" value={recipe.hair.liftStops} min={-0.3} max={recipe.mode === 'expressive' ? 1.5 : 0.8} step={0.05} onStart={onSliderStart} onChange={(next) => onSlider('hair', { liftStops: next })} onEnd={onSliderEnd} /><Slider label="색감" value={recipe.hair.chromaMix} min={0} max={1} step={0.01} onStart={onSliderStart} onChange={(next) => onSlider('hair', { chromaMix: next })} onEnd={onSliderEnd} /></>}
    {region === 'lip' && <div className="material-row"><button className={recipe.lip.material === 'tint' ? 'active' : ''} onClick={() => onPatch('lip', { material: 'tint' })}>틴트</button><button className={recipe.lip.material === 'satin' ? 'active' : ''} onClick={() => onPatch('lip', { material: 'satin' })}>새틴</button></div>}
    {region === 'blush' && <Slider label="크기" value={recipe.blush.size} min={0.2} max={1} step={0.01} onStart={onSliderStart} onChange={(next) => onSlider('blush', { size: next })} onEnd={onSliderEnd} />}
  </>;
}

function Slider({ label, value, min, max, step, onStart, onChange, onEnd }: { label: string; value: number; min: number; max: number; step: number; onStart(): void; onChange(value: number): void; onEnd(): void }) {
  return <label className="slider-row"><span>{label}<output>{value.toFixed(2)}</output></span><input type="range" value={value} min={min} max={max} step={step} onFocus={onStart} onPointerDown={onStart} onKeyDown={onStart} onChange={(event) => onChange(Number(event.target.value))} onKeyUp={onEnd} onPointerUp={onEnd} onPointerCancel={onEnd} onBlur={onEnd} /></label>;
}

function patchRecipe(recipe: LookRecipe, region: Region, values: Partial<HairRecipe> | Partial<LipRecipe> | Partial<BlushRecipe>): LookRecipe {
  if (region === 'hair') return patchRegion(recipe, 'hair', values as Partial<HairRecipe>);
  if (region === 'lip') return patchRegion(recipe, 'lip', values as Partial<LipRecipe>);
  return patchRegion(recipe, 'blush', values as Partial<BlushRecipe>);
}

function tabLabel(tab: Tab): string { return { looks: '완성 룩', hair: '헤어', lip: '립', blush: '블러셔' }[tab]; }
function shortLabel(label: string): string { return label.replace('[Experimental · Unapproved] ', ''); }
function nextPaint(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
function stateLabel(state: string): string {
  const labels: Record<string, string> = { IDLE: '대기', LOADING_MODELS: '모델 로딩', READY: '준비됨', REQUESTING_CAMERA: '카메라 요청', DECODING_PHOTO: '입력 해독', ANALYZING_PHOTO: '사진 분석', LIVE: '라이브', PHOTO: '사진', FREEZING: '촬영 중', EXPORTING: '저장 중', ERROR: '오류', PAUSED: '일시 정지', DISPOSING: '정리 중', SWITCHING_SOURCE: '입력 전환' };
  return labels[state] ?? state;
}

function canRetryEngine(code: string | undefined): boolean {
  return code === 'MODEL_INIT_FAILED' || code === 'MODEL_MODE_FAILED' || code === 'WORKER_FAILED' || code === 'TIMEOUT' || code === 'CONTEXT_LOST';
}
