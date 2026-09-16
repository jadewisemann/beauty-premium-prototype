import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { DiagnosticsPanel } from '../debug/DiagnosticsPanel';
import { BeautyController } from '../engine/controller';
import type { BlushRecipe, EyeRecipe, HairRecipe, LipRecipe, LookRecipe, Region } from '../engine/contracts';
import { downloadBlob, exportCanvas } from '../engine/export';
import type { RenderView, RendererMetrics } from '../engine/renderer';
import { BLUSH_PALETTES, DRAFT_LOOKS, EYE_COLORS, HAIR_COLORS, LIP_COLORS } from '../looks/presets';
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
import { OpenMakeupViewport } from './OpenMakeupViewport';
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
  const [cameraConsentGiven, setCameraConsentGiven] = useState(false);
  const [cameraLaunchPending, setCameraLaunchPending] = useState(false);
  const [openMakeupReady, setOpenMakeupReady] = useState(false);
  const [debugEnabled] = useState(() => new URLSearchParams(window.location.search).get('debug') === '1');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recipe = history.present;
  const unavailableError = Boolean(snapshot.error && ['MODEL_INIT_FAILED', 'WORKER_FAILED', 'TIMEOUT', 'CONTEXT_LOST'].includes(snapshot.error.code));
  const ready = snapshot.state === 'READY' || snapshot.state === 'LIVE' || snapshot.state === 'PHOTO' || (snapshot.state === 'ERROR' && !unavailableError);
  const isLive = snapshot.state === 'LIVE' || snapshot.state === 'PAUSED';
  const cameraInputError = snapshot.error?.code === 'CAMERA_DENIED' || snapshot.error?.code === 'CAMERA_UNAVAILABLE';
  const showEntryOverlay = cameraLaunchPending || !snapshot.sourceKind || snapshot.state === 'REQUESTING_CAMERA' || cameraInputError;
  const entryStep = cameraConsentGiven || cameraLaunchPending || snapshot.sourceKind === 'camera' ? 2 : 1;

  useEffect(() => {
    void controller.initialize();
    const interval = debugEnabled ? window.setInterval(() => setDiagnostics(controller.diagnostics.snapshot()), 500) : null;
    const visibility = () => controller.setVisibility(!document.hidden);
    const releaseOriginal = () => setOriginalHeld(false);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', releaseOriginal);
    return () => {
      if (interval !== null) window.clearInterval(interval);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', releaseOriginal);
      controller.dispose();
    };
  }, [controller, debugEnabled]);

  useEffect(() => () => { if (savedUrl) URL.revokeObjectURL(savedUrl); }, [savedUrl]);

  useEffect(() => {
    if (!cameraLaunchPending || !ready || !videoRef.current) return;
    setCameraLaunchPending(false);
    void controller.startCamera(videoRef.current);
  }, [cameraLaunchPending, controller, ready]);

  const requestCamera = () => {
    setRendererError(null);
    setCameraConsentGiven(true);
    setCameraLaunchPending(true);
  };

  const choosePhoto = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setCameraLaunchPending(false);
      setCompare('none');
      void controller.selectPhoto(file);
    }
    event.target.value = '';
  };

  const chooseReplay = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && videoRef.current) {
      setCameraLaunchPending(false);
      setCompare('none');
      void controller.startReplay(videoRef.current, file);
    }
    event.target.value = '';
  };

  const selectPreset = (preset: LookRecipe) => setHistory((current) => commitRecipe(current, applyPreset(current.present, preset, locks)));
  const patch = (region: Region, values: Partial<HairRecipe> | Partial<EyeRecipe> | Partial<LipRecipe> | Partial<BlushRecipe>) => {
    setHistory((current) => commitRecipe(current, patchRecipe(current.present, region, values)));
  };
  const updateSlider = (region: Region, values: Partial<HairRecipe> | Partial<EyeRecipe> | Partial<LipRecipe> | Partial<BlushRecipe>) => {
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
  const openMakeupActive = isLive && (snapshot.sourceKind === 'camera' || snapshot.sourceKind === 'replay');

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><span className="eyebrow">BECON · PROTOTYPE</span><h1>Beauty Playground</h1></div>
        <span className={`state-pill state-${snapshot.state.toLowerCase()}`} role="status" aria-live="polite">{stateLabel(snapshot.state)}</span>
      </header>

      <section className={`stage-card ${compare === 'grid' && snapshot.state === 'PHOTO' ? 'stage-grid' : ''} ${openMakeupActive ? 'stage-open-makeup' : ''}`}>
        <video
          ref={videoRef}
          className={`source-video ${snapshot.sourceKind === 'camera' || snapshot.sourceKind === 'replay' ? 'source-video-visible' : ''} ${snapshot.sourceKind === 'camera' ? 'source-video-mirrored' : ''}`}
          muted
          playsInline
          aria-hidden="true"
        />
        {compare === 'grid' && snapshot.state === 'PHOTO' ? (
          DRAFT_LOOKS.slice(0, 4).map((look) => (
            <div className="grid-look" key={look.id}>
              <BeautyViewport controller={controller} videoRef={videoRef} recipe={look} view="final" resolutionScale={0.5} />
              <span>{shortLabel(look.label)}</span>
            </div>
          ))
        ) : <>
          {openMakeupActive && (
            <OpenMakeupViewport
              generation={snapshot.generation}
              videoRef={videoRef}
              recipe={recipe}
              mirrored={snapshot.sourceKind === 'camera'}
              visible={displayedView === 'final'}
              splitCompare={compare === 'split'}
              onReady={setOpenMakeupReady}
              onError={(message) => { setOpenMakeupReady(false); setRendererError(`OpenMakeupSDK: ${message}`); }}
            />
          )}
          <BeautyViewport ref={canvasRef} controller={controller} videoRef={videoRef} recipe={recipe} view={displayedView} splitCompare={compare === 'split'} makeupEnabled={!openMakeupReady} onRendererError={(message) => { setRendererError(message); controller.reportRendererError(message); }} onRendererRecovered={() => setRendererError(null)} onMetrics={updateMetrics} />
        </>}
        {showEntryOverlay && (
          <div className="entry-overlay">
            <section className="entry-panel" role="dialog" aria-modal="true" aria-labelledby="entry-title">
              <ol className="entry-steps" aria-label="체험 시작 단계">
                <li className={entryStep === 1 ? 'current' : 'done'}><span>1</span>안내</li>
                <li className={entryStep === 2 ? 'current' : ''}><span>2</span>권한</li>
                <li><span>3</span>체험</li>
              </ol>

              {cameraInputError ? (
                <div className="entry-copy">
                  <span className="entry-kicker">STEP 2 · 카메라 권한</span>
                  <h2 id="entry-title">{snapshot.error?.code === 'CAMERA_DENIED' ? '카메라 권한이 필요해요' : '카메라를 시작하지 못했어요'}</h2>
                  <p>{snapshot.error?.code === 'CAMERA_DENIED' ? '브라우저 설정에서 카메라를 허용한 뒤 다시 요청해 주세요.' : '사용 가능한 전면 카메라를 확인하거나 사진으로 체험해 주세요.'}</p>
                  <div className="entry-actions">
                    <button className="primary-button" type="button" onClick={requestCamera}>카메라 다시 요청</button>
                    <label className="secondary-button file-button">사진으로 체험<input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} disabled={!ready} /></label>
                  </div>
                </div>
              ) : snapshot.state === 'REQUESTING_CAMERA' ? (
                <div className="entry-loading" role="status" aria-live="polite">
                  <span className="entry-spinner" aria-hidden="true" />
                  <h2 id="entry-title">브라우저의 카메라 권한을 확인해 주세요</h2>
                  <p>허용을 누르면 실시간 미리보기가 바로 시작돼요.</p>
                </div>
              ) : cameraLaunchPending ? (
                unavailableError ? (
                  <div className="entry-copy">
                    <span className="entry-kicker">준비 오류</span>
                    <h2 id="entry-title">체험 엔진을 준비하지 못했어요</h2>
                    <p>엔진을 다시 불러온 뒤 카메라 권한 요청을 이어갈게요.</p>
                    <button className="primary-button" type="button" onClick={() => { setRendererError(null); void controller.retry(); }}>엔진 다시 불러오기</button>
                  </div>
                ) : (
                  <div className="entry-loading" role="status" aria-live="polite">
                    <span className="entry-spinner" aria-hidden="true" />
                    <h2 id="entry-title">체험 엔진을 준비하고 있어요</h2>
                    <p>준비가 끝나면 카메라 권한을 바로 요청할게요.</p>
                  </div>
                )
              ) : (
                <div className="entry-copy">
                  <span className="entry-kicker">STEP 1 · 카메라 사용 안내</span>
                  <h2 id="entry-title">전면 카메라로 얼굴을 비춰도 될까요?</h2>
                  <p>헤어 컬러·아이·립·블러셔 효과를 실시간으로 보여주기 위해 카메라를 사용합니다.</p>
                  <div className="privacy-note"><strong>기기 안에서만 처리해요</strong><span>얼굴 이미지와 분석 결과를 서버로 전송하거나 저장하지 않습니다.</span></div>
                  <div className="entry-actions">
                    <button className="primary-button" type="button" disabled={unavailableError} onClick={requestCamera}>동의하고 카메라 켜기</button>
                    <label className="secondary-button file-button">사진으로 대신 시작<input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} disabled={!ready} /></label>
                  </div>
                  <small className={`model-status ${ready ? 'ready' : ''}`}><span />{ready ? '체험 엔진 준비 완료' : '체험 엔진을 백그라운드에서 준비 중'}</small>
                </div>
              )}
            </section>
          </div>
        )}
        {snapshot.state === 'ANALYZING_PHOTO' && <div className="stage-message">사진 정밀 적용 중…</div>}
        {snapshot.state === 'LIVE' && !snapshot.face && !snapshot.hair && <div className="stage-message live-guide"><span className="entry-spinner" aria-hidden="true" />얼굴을 화면 중앙에 맞춰 주세요 · 분석 중</div>}
        {snapshot.state === 'PHOTO' && !snapshot.face && snapshot.hair && <div className="stage-message">얼굴 미검출 · 헤어만 적용됩니다.</div>}
        {snapshot.state === 'PHOTO' && snapshot.face && !snapshot.hair && <div className="stage-message">헤어 미검출 · 립과 블러셔만 적용됩니다.</div>}
        {snapshot.state === 'PHOTO' && !snapshot.face && !snapshot.hair && <div className="stage-message">적용 가능한 얼굴·헤어 결과를 찾지 못했습니다.</div>}
        {compare === 'split' && snapshot.sourceKind && <div className="split-labels"><span>원본</span><span>적용</span></div>}
      </section>

      {snapshot.sourceKind && <>
        <section className={`source-controls ${debugEnabled ? '' : 'source-controls-customer'}`} aria-label="입력 선택">
          <button className="primary-button" type="button" disabled={!ready || snapshot.state === 'LOADING_MODELS'} onClick={requestCamera}>카메라</button>
          <label className="secondary-button file-button">사진<input type="file" accept="image/jpeg,image/png,image/webp" onChange={choosePhoto} disabled={!ready} /></label>
          {debugEnabled && <label className="text-button file-button">반복 영상<input type="file" accept="video/*" onChange={chooseReplay} disabled={!ready} /></label>}
        </section>

        <section className="quick-actions" aria-label="비교 및 촬영">
          <button type="button" className={originalHeld ? 'active' : ''} disabled={!snapshot.sourceKind} onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setOriginalHeld(true); }} onPointerUp={() => setOriginalHeld(false)} onPointerCancel={() => setOriginalHeld(false)} onLostPointerCapture={() => setOriginalHeld(false)}>원본 홀드</button>
          <button type="button" disabled={!snapshot.sourceKind} className={compare === 'split' ? 'active' : ''} onClick={() => setCompare(compare === 'split' ? 'none' : 'split')}>2분할</button>
          <button type="button" disabled={snapshot.state !== 'PHOTO'} className={compare === 'grid' ? 'active' : ''} onClick={() => setCompare(compare === 'grid' ? 'none' : 'grid')}>4분할</button>
          <button type="button" disabled={!isLive} onClick={() => videoRef.current && void controller.captureFrame(videoRef.current, recipe.revision)}>촬영</button>
        </section>

        {debugEnabled && <nav className="view-switcher" aria-label="개발 보기">
          {viewOptions.map((option) => <button key={option.id} type="button" className={view === option.id ? 'active' : ''} onClick={() => setView(option.id)}>{option.label}</button>)}
        </nav>}

        <nav className="beauty-tabs" aria-label="효과 편집">
          {(['looks', 'hair', 'eye', 'lip', 'blush'] as const).map((item) => <button key={item} type="button" className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{tabLabel(item)}</button>)}
        </nav>

        <section className="editor-card">
          {tab === 'looks' && <LookEditor recipe={recipe} locks={locks} onLock={(region) => setLocks((current) => ({ ...current, [region]: !current[region] }))} onSelect={selectPreset} />}
          {tab === 'hair' && <RegionEditor region="hair" recipe={recipe} colors={HAIR_COLORS} onPatch={patch} onSliderStart={() => setHistory(beginSliderTransaction)} onSlider={updateSlider} onSliderEnd={() => setHistory(commitSliderTransaction)} />}
          {tab === 'eye' && <RegionEditor region="eye" recipe={recipe} colors={EYE_COLORS} onPatch={patch} onSliderStart={() => setHistory(beginSliderTransaction)} onSlider={updateSlider} onSliderEnd={() => setHistory(commitSliderTransaction)} />}
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
      </>}

      {(snapshot.error || rendererError) && (
        <section className="error-card" role="alert">
          <strong>{snapshot.error?.code ?? 'CONTEXT_LOST'}</strong><span>{snapshot.error?.message ?? rendererError}</span>
          {canRetryEngine(snapshot.error?.code) && <button type="button" onClick={() => { setRendererError(null); void controller.retry(); }}>엔진 다시 불러오기</button>}
          {snapshot.error?.code === 'CAMERA_DENIED' && <small>브라우저 권한을 허용한 뒤 카메라 버튼으로 다시 요청하거나 사진을 선택하세요.</small>}
          {snapshot.error?.code === 'CAMERA_UNAVAILABLE' && <small>다른 카메라를 확인하거나 사진 입력을 사용하세요.</small>}
        </section>
      )}

      {debugEnabled && snapshot.sourceKind && <DiagnosticsPanel controller={snapshot} diagnostics={diagnostics} onDownload={() => controller.diagnostics.download()} />}
    </main>
  );
}

function LookEditor({ recipe, locks, onLock, onSelect }: { recipe: LookRecipe; locks: RegionLocks; onLock(region: Region): void; onSelect(recipe: LookRecipe): void }) {
  return <>
    <div className="look-grid">{DRAFT_LOOKS.map((look) => <button key={look.id} type="button" className={recipe.id === look.id ? 'selected' : ''} onClick={() => onSelect(look)}><span style={{ background: look.hair.targetColor }} />{shortLabel(look.label)}<small>{look.mode === 'expressive' ? '표현' : '내추럴'}</small></button>)}</div>
    <p className="draft-note">초기 룩은 실험용이며 퍼스널컬러 진단이나 승인된 추천값이 아닙니다.</p>
    <div className="lock-row">{(['hair', 'eye', 'lip', 'blush'] as const).map((region) => <button key={region} type="button" className={locks[region] ? 'active' : ''} onClick={() => onLock(region)}>{locks[region] ? '🔒' : '🔓'} {tabLabel(region)}</button>)}</div>
  </>;
}

function RegionEditor({ region, recipe, colors, onPatch, onSliderStart, onSlider, onSliderEnd }: {
  region: Region;
  recipe: LookRecipe;
  colors: readonly string[];
  onPatch(region: Region, values: Partial<HairRecipe> | Partial<EyeRecipe> | Partial<LipRecipe> | Partial<BlushRecipe>): void;
  onSliderStart(): void;
  onSlider(region: Region, values: Partial<HairRecipe> | Partial<EyeRecipe> | Partial<LipRecipe> | Partial<BlushRecipe>): void;
  onSliderEnd(): void;
}) {
  const value = recipe[region];
  const strength = region === 'eye' ? 0 : recipe[region].strength;
  return <>
    <div className="region-heading"><strong>{tabLabel(region)}</strong><label className="toggle"><input type="checkbox" checked={value.enabled} onChange={(event) => onPatch(region, { enabled: event.target.checked })} /><span /></label></div>
    <div className="swatches">{colors.map((color) => <button key={color} type="button" aria-label={`${tabLabel(region)} ${color}`} className={value.targetColor === color ? 'selected' : ''} style={{ background: color }} onClick={() => onPatch(region, { targetColor: color })} />)}</div>
    {region === 'eye' ? <>
      <Slider label="아이섀도" value={recipe.eye.shadowStrength} min={0} max={0.65} step={0.01} onStart={onSliderStart} onChange={(next) => onSlider('eye', { shadowStrength: next })} onEnd={onSliderEnd} />
      <Slider label="아이라인" value={recipe.eye.linerStrength} min={0} max={0.8} step={0.01} onStart={onSliderStart} onChange={(next) => onSlider('eye', { linerStrength: next })} onEnd={onSliderEnd} />
    </> : <Slider label="강도" value={strength} min={0} max={1} step={0.01} onStart={onSliderStart} onChange={(next) => onSlider(region, { strength: next })} onEnd={onSliderEnd} />}
    {region === 'hair' && <><Slider label="밝기" value={recipe.hair.liftStops} min={-0.3} max={recipe.mode === 'expressive' ? 1.5 : 0.8} step={0.05} onStart={onSliderStart} onChange={(next) => onSlider('hair', { liftStops: next })} onEnd={onSliderEnd} /><Slider label="색감" value={recipe.hair.chromaMix} min={0} max={1} step={0.01} onStart={onSliderStart} onChange={(next) => onSlider('hair', { chromaMix: next })} onEnd={onSliderEnd} /></>}
    {region === 'hair' && <><div className="material-row">{([
      ['natural', '내추럴', { detailKeep: 0.7, highlightProtect: 0.55, edgeStrength: 0.45 }],
      ['soft', '소프트', { detailKeep: 0.5, highlightProtect: 0.72, edgeStrength: 0.34 }],
      ['shine', '샤인', { detailKeep: 0.84, highlightProtect: 0.36, edgeStrength: 0.52 }],
    ] as const).map(([finish, label, values]) => <button key={finish} className={hairFinish(recipe.hair) === finish ? 'active' : ''} onClick={() => onPatch('hair', values)}>{label}</button>)}</div><p className="draft-note">현재는 헤어 컬러·톤 체험입니다. 컷·웨이브 변경은 전용 스타일 자산이 필요합니다.</p></>}
    {region === 'lip' && <div className="material-row">{(['tint', 'satin', 'matte', 'gloss'] as const).map((material) => <button key={material} className={recipe.lip.material === material ? 'active' : ''} onClick={() => onPatch('lip', { material })}>{({ tint: '틴트', satin: '새틴', matte: '매트', gloss: '글로스' })[material]}</button>)}</div>}
    {region === 'blush' && <><Slider label="크기" value={recipe.blush.size} min={0.2} max={1} step={0.01} onStart={onSliderStart} onChange={(next) => onSlider('blush', { size: next })} onEnd={onSliderEnd} /><div className="material-row"><button className={recipe.blush.placement === 'apple' ? 'active' : ''} onClick={() => onPatch('blush', { placement: 'apple' })}>애플존</button><button className={recipe.blush.placement === 'lifted' ? 'active' : ''} onClick={() => onPatch('blush', { placement: 'lifted' })}>리프팅</button></div></>}
  </>;
}

function Slider({ label, value, min, max, step, onStart, onChange, onEnd }: { label: string; value: number; min: number; max: number; step: number; onStart(): void; onChange(value: number): void; onEnd(): void }) {
  return <label className="slider-row"><span>{label}<output>{value.toFixed(2)}</output></span><input type="range" value={value} min={min} max={max} step={step} onFocus={onStart} onPointerDown={onStart} onKeyDown={onStart} onChange={(event) => onChange(Number(event.target.value))} onKeyUp={onEnd} onPointerUp={onEnd} onPointerCancel={onEnd} onBlur={onEnd} /></label>;
}

function patchRecipe(recipe: LookRecipe, region: Region, values: Partial<HairRecipe> | Partial<EyeRecipe> | Partial<LipRecipe> | Partial<BlushRecipe>): LookRecipe {
  if (region === 'hair') return patchRegion(recipe, 'hair', values as Partial<HairRecipe>);
  if (region === 'eye') return patchRegion(recipe, 'eye', values as Partial<EyeRecipe>);
  if (region === 'lip') return patchRegion(recipe, 'lip', values as Partial<LipRecipe>);
  return patchRegion(recipe, 'blush', values as Partial<BlushRecipe>);
}

function tabLabel(tab: Tab): string { return { looks: '완성 룩', hair: '헤어 컬러', eye: '아이', lip: '립', blush: '블러셔' }[tab]; }
function shortLabel(label: string): string { return label.replace('[Experimental · Unapproved] ', ''); }
function hairFinish(hair: HairRecipe): 'natural' | 'soft' | 'shine' {
  if (hair.detailKeep < 0.6) return 'soft';
  if (hair.detailKeep > 0.78) return 'shine';
  return 'natural';
}
function nextPaint(): Promise<void> { return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
function stateLabel(state: string): string {
  const labels: Record<string, string> = { IDLE: '대기', LOADING_MODELS: '모델 로딩', READY: '준비됨', REQUESTING_CAMERA: '카메라 요청', DECODING_PHOTO: '입력 해독', ANALYZING_PHOTO: '사진 분석', LIVE: '라이브', PHOTO: '사진', FREEZING: '촬영 중', EXPORTING: '저장 중', ERROR: '오류', PAUSED: '일시 정지', DISPOSING: '정리 중', SWITCHING_SOURCE: '입력 전환' };
  return labels[state] ?? state;
}

function canRetryEngine(code: string | undefined): boolean {
  return code === 'MODEL_INIT_FAILED' || code === 'MODEL_MODE_FAILED' || code === 'WORKER_FAILED' || code === 'TIMEOUT' || code === 'CONTEXT_LOST';
}
