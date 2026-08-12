"use client";

import {useMemo} from 'react';
import toast from 'react-hot-toast';
import {useAppDispatch, useAppSelector} from '@/app/store';
import {setWorkflow} from '@/app/store/slices/projectSlice';
import {
  compileSeedanceMasterPrompt,
  seedanceMasterSettingsSchema,
  type SeedanceMasterSettings,
} from '@/app/lib/workflow/seedance-master';

const fieldClass = 'w-full rounded border border-white/15 bg-black/30 px-2 py-1 text-sm text-white';
const buttonClass = 'rounded bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40';
type AxisKey = keyof SeedanceMasterSettings['axes'];
type Option = {value: string; label: string};
type AxisControl = {key: AxisKey; label: string; options: Option[]};

const singleAxes: AxisControl[] = [
  {key: 'task', label: '① 작업 방식', options: [['t2v','글만으로 새 영상'],['r2v','참조 이미지·영상 사용'],['edit','기존 영상 수정'],['ext','기존 영상 연장'],['fl','시작·끝 프레임(현재 유료 경로 비활성)']].map(([value,label])=>({value,label}))},
  {key: 'extra', label: '①-2 추가 능력', options: [['none','사용 안 함'],['one_click','사진 묶어 완성'],['seamless','영상 자연 연결'],['combined','여러 기능 조합']].map(([value,label])=>({value,label}))},
  {key: 'genre', label: '② 장르', options: [['tvc','광고 TVC'],['drama','단편 드라마'],['brand','브랜드 스토리'],['education','교육'],['ecommerce','전자상거래'],['travel','여행 Vlog']].map(([value,label])=>({value,label}))},
  {key: 'durationStructure', label: '③ 길이·단계', options: [['20s-4stage','20초·4단계'],['30s-5stage','30초·5단계']].map(([value,label])=>({value,label}))},
  {key: 'shotSequence', label: '④ 장면 분할', options: [['timestamp','시간 구간'],['shot-number','장면 번호'],['time-point','시간점'],['relative-time','상대시간'],['mixed','혼합']].map(([value,label])=>({value,label}))},
  {key: 'dialogueLanguage', label: '⑤ 대사 언어', options: [['ko-seoul','한국어·서울 억양'],['en','영어'],['none','대사 없음']].map(([value,label])=>({value,label}))},
  {key: 'voice', label: '⑥ 말투', options: [['soft-slow','부드럽고 느리게'],['bright-fast','밝고 빠르게'],['calm-formal','차분하고 격식 있게'],['excited-fast','흥분되고 빠르게']].map(([value,label])=>({value,label}))},
  {key: 'emotionFlow', label: '⑧ 감정 전환', options: [['none','사용 안 함'],['four-stage','4단계 전환']].map(([value,label])=>({value,label}))},
  {key: 'shotSize', label: '⑨ 샷 크기', options: [['wide-medium-close-wide','전체→중간→근접→전체'],['close-medium-wide','근접→중간→전체'],['wide-medium-close','전체→중간→근접'],['face-to-full','얼굴→전신']].map(([value,label])=>({value,label}))},
  {key: 'timeWeather', label: '⑩ 시간·날씨', options: [['none','선택 안 함'],['morning','아침'],['noon','정오'],['sunset','노을'],['night','밤'],['rain','비'],['fog','안개']].map(([value,label])=>({value,label}))},
  {key: 'camera', label: '⑪ 카메라', options: [['vlog','일상 Vlog'],['cinematic','시네마틱'],['one-take','원테이크'],['fpv','1인칭'],['handheld-documentary','핸드헬드 다큐']].map(([value,label])=>({value,label}))},
  {key: 'angle', label: '⑫ 시점', options: [['eye','눈높이'],['low','낮은 위치'],['high','높은 위치'],['top','위에서 아래'],['fpv','1인칭'],['over-shoulder','어깨너머'],['three-quarter','45도']].map(([value,label])=>({value,label}))},
  {key: 'composition', label: '⑭ 구도', options: [['none','선택 안 함'],['thirds','3분할'],['center','중앙'],['diagonal','대각선'],['over-shoulder','어깨너머'],['high-angle','높은 앵글']].map(([value,label])=>({value,label}))},
  {key: 'transition', label: '⑮ 전환', options: [['hard-cut','하드컷'],['crossfade','크로스페이드'],['match-cut','매치컷'],['seamless','자연 연결'],['zoom','줌']].map(([value,label])=>({value,label}))},
  {key: 'musicGenre', label: '⑰ 음악', options: [['none','음악 없음'],['acoustic','어쿠스틱'],['orchestra','오케스트라'],['hiphop','힙합'],['lounge','라운지']].map(([value,label])=>({value,label}))},
  {key: 'visualStyle', label: '⑳ 시각 스타일', options: [['documentary','실사 다큐'],['anime-2d','2D 애니'],['cg-3d','3D CG'],['cyberpunk','사이버펑크'],['retro','레트로'],['vlog','Vlog']].map(([value,label])=>({value,label}))},
  {key: 'styleLock', label: '㉑ 스타일 고정', options: [['forward','스타일 지정'],['bidirectional','반대 스타일도 금지'],['reference-image','참조 이미지 기준']].map(([value,label])=>({value,label}))},
  {key: 'lighting', label: '㉒ 조명', options: [['golden-hour','골든아워'],['neon','네온'],['studio','스튜디오'],['natural','자연광'],['low-key','저조도'],['blue-hour','블루아워']].map(([value,label])=>({value,label}))},
  {key: 'textGeneration', label: '㉓ 화면 글자', options: [{value: 'none', label: '생성 금지 · 후편집 전용'}]},
  {key: 'subjectDefinition', label: '㉕ 주인공 정의', options: [['single','한 명'],['multi-material-single-subject','한 인물에 여러 참조'],['material-per-subject','인물별 참조']].map(([value,label])=>({value,label}))},
  {key: 'whiteModel', label: '㉖ 흰색 3D 모형', options: [['none','사용 안 함'],['coarse','동작 골격'],['detailed','세밀한 구조']].map(([value,label])=>({value,label}))},
  {key: 'keyframe', label: '㉗ 핵심 프레임', options: [['none','사용 안 함'],['ordered','순서대로 사용'],['first-last','시작·끝(현재 유료 경로 비활성)']].map(([value,label])=>({value,label}))},
];

const multiAxes: AxisControl[] = [
  {key:'emotions',label:'⑦ 감정',options:[['joy','기쁨'],['sadness','슬픔'],['anxiety','불안'],['anger','분노'],['relief','해소']].map(([value,label])=>({value,label}))},
  {key:'optics',label:'⑬ 렌즈',options:[['shallow-depth','배경 흐림'],['bokeh','보케'],['flare','플레어'],['slow-motion','느린 동작'],['wide','광각'],['fisheye','어안'],['macro','초접사']].map(([value,label])=>({value,label}))},
  {key:'audioLanes',label:'⑯ 소리',options:[['dialogue','대사'],['sfx','효과음'],['ambience','배경 소음'],['music','음악']].map(([value,label])=>({value,label}))},
  {key:'fxPresets',label:'⑱ 효과음',options:[['nature','자연'],['city','도시'],['daily','일상'],['machine','기계']].map(([value,label])=>({value,label}))},
  {key:'quality',label:'⑲ 화질',options:[['cinematic-hd','영화 느낌'],['natural-color','자연색'],['real-skin','실제 피부'],['warm','따뜻한 색감']].map(([value,label])=>({value,label}))},
  {key:'referenceMaterials',label:'㉔ 참조 재료',options:[['image-character','인물 이미지'],['image-scene','배경 이미지'],['image-multi-subject','다주체 이미지'],['video-action','동작 영상'],['video-effects','효과 영상'],['audio-voice','목소리 오디오']].map(([value,label])=>({value,label}))},
];

export default function SeedanceMasterPanel() {
  const project = useAppSelector((state) => state.projectState);
  const dispatch = useAppDispatch();
  const settings = project.workflow.seedanceMaster;

  const compiled = useMemo(() => {
    try {
      if (!project.workflow.storyboard) throw new Error('먼저 스토리보드를 가져오세요.');
      return {prompt: compileSeedanceMasterPrompt(project.workflow.storyboard, project.workflow.production, settings)};
    } catch (error) {
      return {error: error instanceof Error ? error.message : '요청을 만들 수 없습니다.'};
    }
  }, [project.workflow.storyboard, project.workflow.production, settings]);

  const save = (next: SeedanceMasterSettings) => {
    const parsed = seedanceMasterSettingsSchema.safeParse(next);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Seedance 설정값이 올바르지 않습니다.');
      return;
    }
    dispatch(setWorkflow({...project.workflow, seedanceMaster: parsed.data}));
  };
  const setAxis = (key: AxisKey, value: unknown) => save({...settings, axes: {...settings.axes, [key]: value}});
  const toggleMulti = (key: AxisKey, value: string) => {
    const raw = settings.axes[key];
    if (!Array.isArray(raw)) return;
    const current = raw as readonly string[];
    setAxis(key, current.includes(value) ? current.filter((entry: string) => entry !== value) : [...current, value]);
  };
  const copy = async () => {
    if (!compiled.prompt) return;
    try {
      await navigator.clipboard.writeText(compiled.prompt);
      toast.success('Seedance 감독 프롬프트를 복사했습니다.');
    } catch {
      toast.error('클립보드에 복사하지 못했습니다. 브라우저 권한을 확인하세요.');
    }
  };

  return <section className="space-y-3 rounded border border-blue-400/30 bg-blue-500/5 p-3">
    <div><h3 className="font-semibold">Seedance 2.5 Director → BytePlus ModelArk</h3><p className="text-xs text-gray-400">원본 28축 판단을 프로젝트에 저장하고, provider-independent 감독 프롬프트를 만듭니다. 유료 제출은 GenerationAuthorization 단계에서만 가능합니다.</p></div>
    <div className="grid grid-cols-2 gap-2">
      <label className="text-xs text-gray-400">영상 길이<select className={fieldClass} value={settings.duration} onChange={(e)=>{const duration=Number(e.target.value) as 20|30; save({...settings,duration,axes:{...settings.axes,durationStructure:duration===20?'20s-4stage':'30s-5stage'}});}}><option value={20}>20초</option><option value={30}>30초</option></select></label>
      <label className="text-xs text-gray-400">화면 비율<select className={fieldClass} value={settings.aspectRatio} onChange={(e)=>save({...settings,aspectRatio:e.target.value as SeedanceMasterSettings['aspectRatio']})}>{['auto','21:9','16:9','4:3','1:1','3:4','9:16'].map(v=><option key={v}>{v}</option>)}</select></label>
      <label className="text-xs text-gray-400">해상도<select className={fieldClass} value={settings.resolution} onChange={(e)=>save({...settings,resolution:e.target.value as SeedanceMasterSettings['resolution']})}><option>720p</option><option>480p</option></select></label>
      <label className="flex items-center gap-2 text-xs text-gray-300"><input type="checkbox" checked={settings.generateAudio} onChange={(e)=>save({...settings,generateAudio:e.target.checked})}/>Seedance에서 소리 만들기</label>
    </div>
    <details className="rounded border border-white/10 p-2" open><summary className="cursor-pointer font-semibold">28축 연출 설정</summary>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{singleAxes.map(axis=><label key={axis.key} className="text-xs text-gray-400">{axis.label}<select className={fieldClass} value={String(settings.axes[axis.key])} onChange={(e)=>setAxis(axis.key,e.target.value)}>{axis.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select></label>)}</div>
      <div className="mt-3 space-y-2">{multiAxes.map(axis=><div key={axis.key}><div className="text-xs text-gray-400">{axis.label}</div><div className="flex flex-wrap gap-1">{axis.options.map(o=>{const selected=(settings.axes[axis.key] as string[]).includes(o.value); return <button type="button" aria-pressed={selected} key={o.value} onClick={()=>toggleMulti(axis.key,o.value)} className={`rounded border px-2 py-1 text-xs ${selected?'border-blue-300 bg-blue-500/30':'border-white/15 bg-black/20'}`}>{o.label}</button>;})}</div></div>)}</div>
    </details>
    {settings.axes.task === 'ext' && <label className="text-xs text-gray-400">연장 방향<select className={fieldClass} value={settings.extensionMode ?? ''} onChange={(e)=>save({...settings,extensionMode:e.target.value ? e.target.value as 'forward'|'backward' : undefined})}><option value="">선택</option><option value="forward">뒤로 이어 만들기</option><option value="backward">앞으로 이어 만들기</option></select></label>}
    {compiled.error ? <div className="rounded border border-yellow-500/30 bg-yellow-500/10 p-2 text-xs text-yellow-200">아직 생성 준비가 안 됐습니다: {compiled.error}</div> : <>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-xs text-gray-200">{compiled.prompt}</pre>
      <button className={buttonClass} onClick={copy}>감독 프롬프트 복사</button>
      <p className="text-xs text-green-300">Provider model·endpoint·auth는 이 패널이 소유하지 않습니다.</p>
    </>}
  </section>;
}
