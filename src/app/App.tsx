import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BeautyController } from '../engine/controller';
import { MakeupViewport } from './MakeupViewport';
import type { Finish, MakeupState } from './open-makeup';
import './styles.css';

type Tab = 'hair' | 'foundation' | 'lipstick' | 'blush' | 'eye';
type MakeupLayer = Exclude<keyof MakeupState, 'eyeline'>;

const COLORS = {
  hair: ['#2b1712', '#5b3026', '#8a4a32', '#a66a43', '#6f4b67', '#292833'],
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
  const [controller] = useState(() => new BeautyController());
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [starting, setStarting] = useState(false);
  const [tab, setTab] = useState<Tab>('hair');
  const [hair, setHair] = useState({ color: COLORS.hair[2] as string, strength: 0.65 });
  const [makeup, setMakeup] = useState(initialMakeup);
  const [hairReady, setHairReady] = useState(false);
  const [makeupReady, setMakeupReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = snapshot.state === 'LIVE';
  const engineReady = snapshot.state === 'READY' || live;

  useEffect(() => {
    void controller.initialize();
    const onVisibility = () => controller.setVisibility(!document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      controller.dispose();
    };
  }, [controller]);

  useEffect(() => {
    if (snapshot.error) setError(snapshot.error.message);
  }, [snapshot.error]);

  const startCamera = async () => {
    if (!videoRef.current || starting) return;
    setStarting(true);
    setError(null);
    try {
      if (snapshot.state === 'ERROR' && ['MODEL_INIT_FAILED', 'WORKER_FAILED', 'TIMEOUT'].includes(snapshot.error?.code ?? '')) {
        await controller.retry();
      }
      if (controller.getSnapshot().state === 'READY' || controller.getSnapshot().state === 'ERROR') {
        await controller.startCamera(videoRef.current);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setStarting(false);
    }
  };

  const updateLayer = <K extends MakeupLayer>(layer: K, patch: Partial<MakeupState[K]>) => {
    setMakeup((current) => ({ ...current, [layer]: { ...current[layer], ...patch } }));
  };

  return <main>
    <header className="glass-surface"><div><small>BECON BEAUTY LAB</small><h1>Beauty Mirror</h1></div><strong data-makeup-ready={makeupReady} data-hair-ready={hairReady}>{live ? (hairReady && makeupReady ? 'LIVE' : '준비 중') : '대기'}</strong></header>

    <section className="stage">
      <video ref={videoRef} className="visible" muted playsInline />
      {live && <>
        <MakeupViewport controller={controller} videoRef={videoRef} makeup={makeup} hair={hair} onReady={setMakeupReady} onHairReady={setHairReady} onError={setError} />
      </>}
      {!live && <div className="entry glass-surface"><small>VIRTUAL BEAUTY STUDIO</small><h2>내 얼굴을 보면서<br />바로 바꿔보세요</h2><p>헤어와 메이크업을 실시간으로 자연스럽게 확인해 보세요.</p><button onClick={() => void startCamera()} disabled={starting || !engineReady}>{starting ? '카메라 여는 중…' : '카메라 시작'}</button></div>}
      {live && (!hairReady || !makeupReady) && <span className="loading">효과 준비 중…</span>}
    </section>

    {live && <section className="controls">
      <nav aria-label="효과 선택">{(['hair', 'foundation', 'lipstick', 'blush', 'eye'] as const).map((item) => <button key={item} aria-pressed={tab === item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{tabLabel(item)}</button>)}</nav>
      {tab === 'hair' && <><Swatches colors={COLORS.hair} selected={hair.color} onSelect={(color) => setHair((current) => ({ ...current, color }))} /><Strength value={hair.strength} onChange={(strength) => setHair((current) => ({ ...current, strength }))} /></>}
      {tab === 'foundation' && <LayerEditor label="베이스" layer="foundation" state={makeup.foundation} colors={COLORS.foundation} onChange={updateLayer} />}
      {tab === 'lipstick' && <LayerEditor label="립" layer="lipstick" state={makeup.lipstick} colors={COLORS.lipstick} finishes onChange={updateLayer} />}
      {tab === 'blush' && <LayerEditor label="블러셔" layer="blush" state={makeup.blush} colors={COLORS.blush} onChange={updateLayer} />}
      {tab === 'eye' && <><Toggle label="아이섀도" enabled={makeup.eyeshadow.enabled} onChange={(enabled) => updateLayer('eyeshadow', { enabled })} /><Swatches colors={COLORS.eye} selected={makeup.eyeshadow.color} onSelect={(color) => setMakeup((current) => ({ ...current, eyeshadow: { ...current.eyeshadow, color }, eyeline: { ...current.eyeline, color } }))} /><Toggle label="아이라인" enabled={makeup.eyeline.enabled} onChange={(enabled) => setMakeup((current) => ({ ...current, eyeline: { ...current.eyeline, enabled } }))} /></>}
    </section>}

    {error && <aside role="alert"><span>{error}</span><button onClick={() => void startCamera()}>다시 시작</button></aside>}
  </main>;
}

function LayerEditor<K extends MakeupLayer>({ label, layer, state, colors, finishes = false, onChange }: { label: string; layer: K; state: MakeupState[K]; colors: readonly string[]; finishes?: boolean; onChange(layer: K, patch: Partial<MakeupState[K]>): void }) {
  return <><Toggle label={label} enabled={state.enabled} onChange={(enabled) => onChange(layer, { enabled } as Partial<MakeupState[K]>)} /><Swatches colors={colors} selected={state.color} onSelect={(color) => onChange(layer, { color } as Partial<MakeupState[K]>)} />{finishes && <div className="finishes">{(['matte', 'shimmer', 'glossy'] as Finish[]).map((finish) => <button key={finish} aria-pressed={state.finish === finish} className={state.finish === finish ? 'active' : ''} onClick={() => onChange(layer, { finish } as Partial<MakeupState[K]>)}>{finish}</button>)}</div>}</>;
}

function Toggle({ label, enabled, onChange }: { label: string; enabled: boolean; onChange(enabled: boolean): void }) {
  return <label className="toggle"><strong>{label}</strong><input type="checkbox" checked={enabled} onChange={(event) => onChange(event.target.checked)} /></label>;
}

function Swatches({ colors, selected, onSelect }: { colors: readonly string[]; selected: string; onSelect(color: string): void }) {
  return <div className="swatches" role="group" aria-label="색상 선택">{colors.map((color) => <button key={color} aria-label={color} aria-pressed={selected === color} className={selected === color ? 'selected' : ''} style={{ background: color }} onClick={() => onSelect(color)} />)}</div>;
}

function Strength({ value, onChange }: { value: number; onChange(value: number): void }) {
  return <label className="strength"><span>색상 강도 <output>{Math.round(value * 100)}%</output></span><input type="range" min="0" max="1" step="0.05" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function tabLabel(tab: Tab): string { return { hair: '헤어', foundation: '베이스', lipstick: '립', blush: '블러셔', eye: '아이' }[tab]; }
