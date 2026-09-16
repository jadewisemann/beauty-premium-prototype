import { useEffect, useRef, useState } from 'react';
import type { Finish } from 'open-makeup-sdk';
import { HairColorOverlay } from './HairColorOverlay';
import { OpenMakeupViewport } from './OpenMakeupViewport';
import type { MakeupState } from './open-makeup';
import './styles.css';

type Tab = 'hair' | 'foundation' | 'lipstick' | 'blush' | 'eye';
type MakeupLayer = Exclude<keyof MakeupState, 'eyeline'>;

const COLORS = {
  hair: ['#2b1712', '#5b3026', '#8a4a32', '#a66a43', '#5a3d52', '#292833'],
  foundation: ['#f0c7a8', '#d9a57f', '#bd8060', '#8e573f'],
  lipstick: ['#b4002e', '#ce4b62', '#8f2949', '#a85d52', '#67213a'],
  blush: ['#e26d7a', '#d88984', '#b75b70', '#cf8067'],
  eye: ['#5c382e', '#7a3b9d', '#90644f', '#49405f', '#252126'],
} as const;

const initialMakeup: MakeupState = {
  foundation: { enabled: false, color: COLORS.foundation[1], finish: 'matte' },
  lipstick: { enabled: true, color: COLORS.lipstick[1], finish: 'glossy' },
  blush: { enabled: true, color: COLORS.blush[0], finish: 'matte' },
  eyeshadow: { enabled: true, color: COLORS.eye[0], finish: 'matte' },
  eyeline: { enabled: true, color: '#1a1110' },
};

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [tab, setTab] = useState<Tab>('hair');
  const [hair, setHair] = useState<{ enabled: boolean; color: string; strength: number }>({ enabled: true, color: COLORS.hair[2], strength: 0.65 });
  const [makeup, setMakeup] = useState(initialMakeup);
  const [makeupReady, setMakeupReady] = useState(false);
  const [hairReady, setHairReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  const startCamera = async () => {
    const video = videoRef.current;
    if (!video || starting) return;
    setStarting(true);
    setError(null);
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      video.srcObject = stream;
      await video.play();
      setLive(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  const updateLayer = <K extends MakeupLayer>(layer: K, patch: Partial<MakeupState[K]>) => {
    setMakeup((current) => ({ ...current, [layer]: { ...current[layer], ...patch } }));
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><span>BECON · LIVE</span><h1>Beauty Mirror</h1></div>
        <strong>{live ? (makeupReady && hairReady ? 'LIVE' : '준비 중') : '대기'}</strong>
      </header>

      <section className="stage-card">
        <video ref={videoRef} className={`source-video mirrored ${live ? 'visible' : ''}`} muted playsInline aria-hidden="true" />
        {live && <>
          <OpenMakeupViewport videoRef={videoRef} makeup={makeup} onReady={setMakeupReady} onError={(message) => setError(`OpenMakeupSDK: ${message}`)} />
          <HairColorOverlay videoRef={videoRef} {...hair} onReady={setHairReady} onError={(message) => setError(`MediaPipe: ${message}`)} />
        </>}
        {!live && (
          <div className="camera-entry">
            <span>기기 안에서만 처리합니다</span>
            <h2>내 얼굴을 보면서 바로 바꿔보세요</h2>
            <p>헤어 컬러는 MediaPipe, 베이스·립·블러셔·아이는 OpenMakeupSDK로 적용합니다.</p>
            <button type="button" onClick={() => void startCamera()} disabled={starting}>{starting ? '카메라 여는 중…' : '카메라 시작'}</button>
          </div>
        )}
        {live && (!makeupReady || !hairReady) && <div className="loading-pill">효과 준비 중…</div>}
      </section>

      {live && (
        <section className="controls" aria-label="뷰티 효과 편집">
          <nav className="tabs">
            {(['hair', 'foundation', 'lipstick', 'blush', 'eye'] as const).map((item) => (
              <button key={item} type="button" className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{tabLabel(item)}</button>
            ))}
          </nav>

          {tab === 'hair' && <>
            <Heading label="헤어 컬러" enabled={hair.enabled} onChange={(enabled) => setHair((current) => ({ ...current, enabled }))} />
            <Swatches colors={COLORS.hair} selected={hair.color} onSelect={(color) => setHair((current) => ({ ...current, color }))} />
            <label className="slider"><span>강도 <output>{hair.strength.toFixed(2)}</output></span><input type="range" min="0" max="1" step="0.05" value={hair.strength} onChange={(event) => setHair((current) => ({ ...current, strength: Number(event.target.value) }))} /></label>
          </>}

          {tab === 'foundation' && <LayerEditor label="베이스" layer="foundation" state={makeup.foundation} colors={COLORS.foundation} onChange={updateLayer} />}
          {tab === 'lipstick' && <LayerEditor label="립" layer="lipstick" state={makeup.lipstick} colors={COLORS.lipstick} finishes onChange={updateLayer} />}
          {tab === 'blush' && <LayerEditor label="블러셔" layer="blush" state={makeup.blush} colors={COLORS.blush} onChange={updateLayer} />}
          {tab === 'eye' && <>
            <Heading label="아이섀도" enabled={makeup.eyeshadow.enabled} onChange={(enabled) => updateLayer('eyeshadow', { enabled })} />
            <Swatches colors={COLORS.eye} selected={makeup.eyeshadow.color} onSelect={(color) => setMakeup((current) => ({
              ...current,
              eyeshadow: { ...current.eyeshadow, color },
              eyeline: { ...current.eyeline, color },
            }))} />
            <Heading label="아이라인" enabled={makeup.eyeline.enabled} onChange={(enabled) => setMakeup((current) => ({ ...current, eyeline: { ...current.eyeline, enabled } }))} />
          </>}
        </section>
      )}

      {error && <section className="error-card" role="alert"><span>{error}</span><button type="button" onClick={() => void startCamera()}>다시 시작</button></section>}
    </main>
  );
}

function LayerEditor<K extends MakeupLayer>({ label, layer, state, colors, finishes = false, onChange }: {
  label: string;
  layer: K;
  state: MakeupState[K];
  colors: readonly string[];
  finishes?: boolean;
  onChange(layer: K, patch: Partial<MakeupState[K]>): void;
}) {
  return <>
    <Heading label={label} enabled={state.enabled} onChange={(enabled) => onChange(layer, { enabled } as Partial<MakeupState[K]>)} />
    <Swatches colors={colors} selected={state.color} onSelect={(color) => onChange(layer, { color } as Partial<MakeupState[K]>)} />
    {finishes && <div className="finish-row">{(['matte', 'shimmer', 'glossy'] as Finish[]).map((finish) => <button key={finish} className={state.finish === finish ? 'active' : ''} onClick={() => onChange(layer, { finish } as Partial<MakeupState[K]>)}>{finishLabel(finish)}</button>)}</div>}
  </>;
}

function Heading({ label, enabled, onChange }: { label: string; enabled: boolean; onChange(enabled: boolean): void }) {
  return <div className="control-heading"><strong>{label}</strong><label className="toggle"><input type="checkbox" checked={enabled} onChange={(event) => onChange(event.target.checked)} /><span /></label></div>;
}

function Swatches({ colors, selected, onSelect }: { colors: readonly string[]; selected: string; onSelect(color: string): void }) {
  return <div className="swatches">{colors.map((color) => <button key={color} type="button" aria-label={color} className={selected === color ? 'selected' : ''} style={{ background: color }} onClick={() => onSelect(color)} />)}</div>;
}

function tabLabel(tab: Tab): string { return { hair: '헤어', foundation: '베이스', lipstick: '립', blush: '블러셔', eye: '아이' }[tab]; }
function finishLabel(finish: Finish): string { return { matte: '매트', shimmer: '쉬머', glossy: '글로스', glitter: '글리터' }[finish]; }
