'use client';

import {
  Archive,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  FileText,
  Film,
  Folder,
  Layers3,
  LayoutTemplate,
  Lock,
  MessageSquareText,
  Mic2,
  MoreHorizontal,
  Music2,
  Paperclip,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Split,
  Tag,
  Undo2,
  Upload,
  Video,
  WandSparkles,
  X,
} from 'lucide-react';
import {useState} from 'react';
import styles from './studio-concept.module.css';

type Stage = 'chat' | 'sheets' | 'storyboard' | 'generation' | 'timeline';

const stages: Array<{id: Stage; label: string; eyebrow: string}> = [
  {id: 'chat', label: 'AI 인터뷰', eyebrow: '01'},
  {id: 'sheets', label: '기준 시트', eyebrow: '02'},
  {id: 'storyboard', label: '스토리보드', eyebrow: '03'},
  {id: 'generation', label: '영상 생성', eyebrow: '04'},
  {id: 'timeline', label: '편집', eyebrow: '05'},
];

const templates = [
  {title: '제품의 첫인상', meta: '15–20초 · 16:9', className: styles.templateProduct},
  {title: '인물 중심 브랜드 필름', meta: '20–30초 · 16:9', className: styles.templatePortrait},
  {title: '리듬감 있는 숏폼', meta: '10–15초 · 9:16', className: styles.templateShort},
  {title: '감성적인 공간 이야기', meta: '20초 · 16:9', className: styles.templateSpace},
];

const sceneArt = [styles.sceneOne, styles.sceneTwo, styles.sceneThree, styles.sceneFour, styles.sceneFive];
const sceneNames = ['발견', '첫 만남', '몰입', '전환', '기억'];

export default function StudioConceptPage() {
  const [stage, setStage] = useState<Stage>('chat');
  const [selectedScene, setSelectedScene] = useState(2);
  const [selectedSheet, setSelectedSheet] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [templateOpen, setTemplateOpen] = useState(true);
  const [message, setMessage] = useState('');
  const [playing, setPlaying] = useState(false);
  const stageIndex = stages.findIndex((item) => item.id === stage);


  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <div className={styles.brandMark}><Sparkles size={15} strokeWidth={2.4}/></div>
          <span>ClipJS</span>
          <span className={styles.conceptPill}>STUDIO CONCEPT</span>
        </div>
        <nav className={styles.stageNav} aria-label="목업 화면 전환">
          {stages.map((item, index) => (
            <button key={item.id} className={`${styles.stageButton} ${stage === item.id ? styles.stageActive : ''}`} onClick={() => setStage(item.id)}>
              <span>{item.eyebrow}</span>{item.label}
              {index < stageIndex && <Check size={12}/>} 
            </button>
          ))}
        </nav>
        <div className={styles.topActions}>
          <span className={styles.saved}><Check size={12}/> 모든 변경사항 저장됨</span>
          <button className={styles.iconButton} aria-label="도움말"><CircleHelp size={17}/></button>
          <button className={styles.avatar}>HB</button>
        </div>
      </header>

      <div className={styles.workspace}>
        {sidebarOpen && <ProjectSidebar onClose={() => setSidebarOpen(false)}/>}
        {!sidebarOpen && <button className={styles.railOpen} onClick={() => setSidebarOpen(true)} aria-label="프로젝트 열기"><ChevronRight size={16}/></button>}

        <main className={styles.main}>
          {stage === 'chat' && <ChatStage message={message} setMessage={setMessage} onNext={() => setStage('sheets')}/>} 
          {stage === 'sheets' && <SheetStage selected={selectedSheet} setSelected={setSelectedSheet} onNext={() => setStage('storyboard')}/>} 
          {stage === 'storyboard' && <StoryboardStage selected={selectedScene} setSelected={setSelectedScene} playing={playing} setPlaying={setPlaying} onNext={() => setStage('generation')}/>} 
          {stage === 'generation' && <GenerationStage onNext={() => setStage('timeline')}/>} 
          {stage === 'timeline' && <TimelineStage playing={playing} setPlaying={setPlaying}/>} 
        </main>

        {stage === 'chat' && templateOpen && <TemplatePanel onClose={() => setTemplateOpen(false)}/>} 
        {stage === 'chat' && !templateOpen && <button className={styles.templateOpen} onClick={() => setTemplateOpen(true)}><LayoutTemplate size={15}/> 템플릿</button>}
      </div>

    </div>
  );
}

function ProjectSidebar({onClose}: {onClose: () => void}) {
  return <aside className={styles.sidebar}>
    <div className={styles.sidebarHead}><span>워크스페이스</span><button onClick={onClose}><ChevronLeft size={15}/></button></div>
    <button className={styles.newProject}><Plus size={16}/> 새 영상 만들기</button>
    <div className={styles.search}><Search size={14}/><span>프로젝트 검색</span><kbd>⌘K</kbd></div>
    <div className={styles.navGroup}>
      <button className={styles.navActive}><MessageSquareText size={15}/> 모든 프로젝트 <span>12</span></button>
      <button><Clock3 size={15}/> 최근 작업</button>
      <button><Archive size={15}/> 완료</button>
    </div>
    <div className={styles.sidebarLabel}><span>제작 단계</span><Plus size={13}/></div>
    <div className={styles.stageList}>
      <button><span className={styles.dotViolet}/> 기획 중 <b>3</b></button>
      <button><span className={styles.dotBlue}/> 스토리보드 <b>2</b></button>
      <button><span className={styles.dotAmber}/> 생성 중 <b>1</b></button>
      <button><span className={styles.dotGreen}/> 편집 중 <b>4</b></button>
    </div>
    <div className={styles.sidebarLabel}><span>폴더</span><Plus size={13}/></div>
    <div className={styles.navGroup}>
      <button><Folder size={15}/> 함께봄 브랜드</button>
      <button><Folder size={15}/> 제품 광고</button>
      <button><Tag size={15}/> 2026 캠페인</button>
    </div>
    <div className={styles.recentTitle}>최근 프로젝트</div>
    <button className={styles.recentCard}>
      <div className={styles.recentThumb}/>
      <div><strong>루이의 하루</strong><span>스토리보드 · 2분 전</span></div>
      <MoreHorizontal size={14}/>
    </button>
    <button className={styles.recentCard}>
      <div className={`${styles.recentThumb} ${styles.thumbTwo}`}/>
      <div><strong>함께봄 브랜드 필름</strong><span>편집 중 · 어제</span></div>
      <MoreHorizontal size={14}/>
    </button>
    <div className={styles.sidebarFooter}><Settings2 size={15}/> 설정 <span>v0.1</span></div>
  </aside>;
}

function ChatStage({message, setMessage, onNext}: {message: string; setMessage: (value: string) => void; onNext: () => void}) {
  return <section className={styles.chatStage}>
    <div className={styles.chatScroller}>
      <div className={styles.chatIntro}>
        <span className={styles.chatBadge}><WandSparkles size={14}/> AI 제작 매니저</span>
        <h1>어떤 영상을 만들고 싶으세요?</h1>
        <p>아이디어 한 문장부터 시작하세요. 필요한 내용은 제가 하나씩 여쭤볼게요.</p>
      </div>
      <div className={styles.conversation}>
        <div className={styles.userMessage}>
          <div className={styles.messageAvatar}>나</div>
          <div><div className={styles.messageMeta}>You <span>오후 2:32</span></div><p>고양이 루이가 카메라를 보며 인사하는 따뜻한 20초 브랜드 영상을 만들고 싶어.</p></div>
        </div>
        <div className={styles.aiMessage}>
          <div className={styles.aiAvatar}><Sparkles size={15}/></div>
          <div className={styles.messageBody}>
            <div className={styles.messageMeta}>ClipJS 제작 매니저 <span>DeepSeek V4 Flash</span></div>
            <p>좋아요. 루이가 등장하는 따뜻한 브랜드 영상으로 이해했어요.</p>
            <p className={styles.questionText}>이 영상을 본 사람들이 가장 먼저 기억했으면 하는 것은 무엇인가요?</p>
            <div className={styles.quickReplies}><button>루이의 사랑스러운 표정</button><button>함께봄의 따뜻한 이미지</button><button>직접 입력할게요</button></div>
          </div>
        </div>
        <div className={styles.briefCard}>
          <div className={styles.briefHeader}><span><FileText size={15}/> 현재 기획</span><span className={styles.briefStatus}>3개 항목 확정</span></div>
          <div className={styles.briefGrid}>
            <div><span>형식</span><strong>브랜드 필름</strong></div><div><span>주인공</span><strong>고양이 루이</strong></div><div><span>분위기</span><strong>따뜻하고 진솔하게</strong></div>
          </div>
          <button className={styles.whyButton}><ChevronDown size={13}/> 왜 이렇게 정했나요?</button>
        </div>
      </div>
    </div>
    <div className={styles.composerWrap}>
      <div className={styles.specRow}><button>20초 <ChevronDown size={12}/></button><button>16:9 <ChevronDown size={12}/></button><span>목표 규격은 언제든 바꿀 수 있어요</span><button className={styles.endInterview}>인터뷰 끝내기</button></div>
      <div className={styles.composer}>
        <textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="답변하거나 만들고 싶은 영상을 설명하세요"/>
        <div className={styles.composerActions}>
          <div><button aria-label="파일 첨부"><Paperclip size={18}/></button><button aria-label="음성 입력"><Mic2 size={18}/></button><span>이미지 · 영상 · 음원 · 문서</span></div>
          <button className={styles.sendButton} aria-label="전송"><ArrowUp size={17}/></button>
        </div>
      </div>
      <button className={styles.nextMock} onClick={onNext}>완성된 브리프로 다음 화면 보기 <ChevronRight size={15}/></button>
    </div>
  </section>;
}

function TemplatePanel({onClose}: {onClose: () => void}) {
  return <aside className={styles.templatePanel}>
    <div className={styles.templateHead}><div><span>스타일 탐색</span><strong>제작 템플릿</strong></div><button onClick={onClose}><X size={15}/></button></div>
    <p className={styles.templateDesc}>마음에 드는 완성 예시를 골라 연출 방향을 빠르게 시작하세요.</p>
    <div className={styles.templateFilters}><button className={styles.filterActive}>추천</button><button>광고</button><button>브랜드</button><button>숏폼</button></div>
    <div className={styles.templateList}>
      {templates.map((template, index) => <button className={styles.templateCard} key={template.title}>
        <div className={`${styles.templateVisual} ${template.className}`}><span className={styles.loopBadge}><Play size={10} fill="currentColor"/> LOOP</span><span className={styles.templateNumber}>0{index + 1}</span></div>
        <div><strong>{template.title}</strong><span>{template.meta}</span></div>
      </button>)}
    </div>
    <button className={styles.moreTemplates}>모든 템플릿 보기 <ChevronRight size={14}/></button>
  </aside>;
}

const sheetData = [
  {name: '루이', kind: '캐릭터', status: '승인됨', art: styles.sheetCat},
  {name: '거실 공간', kind: '공간', status: '검수 필요', art: styles.sheetRoom},
  {name: '목걸이', kind: '소품', status: '검수 필요', art: styles.sheetCollar},
];

function SheetStage({selected, setSelected, onNext}: {selected: number; setSelected: (value: number) => void; onNext: () => void}) {
  const sheet = sheetData[selected];
  return <section className={styles.editorStage}>
    <StageHeader title="기준 시트 검수" description="반복 등장하는 대상을 하나씩 확인하고 승인하세요." progress="1 / 3 승인"/>
    <div className={styles.sheetLayout}>
      <div className={styles.sheetGallery}>
        <div className={styles.sectionToolbar}><div><strong>핵심 대상</strong><span>AI가 브리프에서 3개 대상을 찾았어요</span></div><button><Plus size={14}/> 대상 추가</button></div>
        <div className={styles.sheetCards}>
          {sheetData.map((item, index) => <button key={item.name} onClick={() => setSelected(index)} className={`${styles.sheetCard} ${selected === index ? styles.sheetSelected : ''}`}>
            <div className={`${styles.sheetArt} ${item.art}`}><span>{item.kind}</span>{item.status === '승인됨' && <i><Check size={12}/></i>}</div>
            <div><strong>{item.name}</strong><span className={item.status === '승인됨' ? styles.statusApproved : styles.statusReview}>{item.status}</span></div>
          </button>)}
        </div>
        <div className={styles.sheetPreview}>
          <div className={`${styles.sheetHeroArt} ${sheet.art}`}>
            <span className={styles.sheetGridLabel}>REFERENCE SHEET · {sheet.kind.toUpperCase()}</span>
            <div className={styles.sheetSilhouettes}><i/><i/><i/></div>
            <div className={styles.palette}><i/><i/><i/><i/></div>
          </div>
        </div>
      </div>
      <aside className={styles.propertyPanel}>
        <div className={styles.propertyHead}><div><span>{sheet.kind}</span><strong>{sheet.name}</strong></div><button><MoreHorizontal size={16}/></button></div>
        <div className={styles.referenceNotice}><Lock size={13}/><span>이 시트는 이후 모든 장면의 공통 참조로 사용됩니다.</span></div>
        <Property label="변경되면 안 되는 특징" value={selected === 0 ? '연한 크림색 털, 짙은 호박색 눈, 남색 목걸이' : '따뜻한 오후 햇빛, 밝은 오크 가구, 크림색 패브릭'}/>
        <Property label="표현 스타일" value="광고 사진처럼 사실적이고 따뜻한 질감"/>
        <Property label="참조 강도" value="원본 기준 · 가벼운 보정 허용"/>
        <div className={styles.actionGrid}><button><WandSparkles size={14}/> 자연어 수정</button><button><Split size={14}/> 부분 수정</button><button><Upload size={14}/> 직접 교체</button></div>
        <div className={styles.aiEditBox}><Sparkles size={14}/><input placeholder={`${sheet.name} 시트에서 바꾸고 싶은 점을 입력하세요`}/><button><ArrowUp size={14}/></button></div>
        <div className={styles.panelFooter}><button className={styles.secondaryButton}>기준 참조 제외</button><button className={styles.primaryButton}><Check size={14}/> 이 시트 승인</button></div>
        <button className={styles.nextMockPanel} onClick={onNext}>전체 승인 상태로 콘티 화면 보기</button>
      </aside>
    </div>
  </section>;
}

function StoryboardStage({selected, setSelected, playing, setPlaying, onNext}: {selected: number; setSelected: (value: number) => void; playing: boolean; setPlaying: (value: boolean) => void; onNext: () => void}) {
  return <section className={styles.editorStage}>
    <StageHeader title="스토리보드" description="장면의 흐름과 대표 이미지를 직접 검수하세요." progress="20초 · 5개 장면" action="애니매틱 만들기"/>
    <div className={styles.storyLayout}>
      <div className={styles.storyMain}>
        <div className={styles.filmstripHead}><span>장면 필름스트립</span><div><button><Undo2 size={14}/></button><button><RotateCcw size={14}/></button><button><SlidersHorizontal size={14}/> 보기 설정</button></div></div>
        <div className={styles.filmstrip}>
          {sceneArt.map((art, index) => <button key={art} onClick={() => setSelected(index)} className={`${styles.sceneCard} ${selected === index ? styles.sceneSelected : ''}`}>
            <div className={`${styles.sceneArt} ${art}`}><span>0{index + 1}</span>{index === selected && <i>선택됨</i>}</div>
            <div><strong>{sceneNames[index]}</strong><span>{index * 4}:00–{(index + 1) * 4}:00</span></div>
          </button>)}
          <button className={styles.addScene}><Plus size={20}/><span>장면 추가</span></button>
        </div>
        <div className={styles.previewArea}>
          <div className={`${styles.storyPreview} ${sceneArt[selected]}`}>
            <div className={styles.safeFrame}/><span className={styles.previewTag}>SCENE 0{selected + 1} · {sceneNames[selected]}</span>
            <div className={styles.previewCaption}>“오늘도 함께여서 좋아.”</div>
          </div>
          <div className={styles.previewControls}><span>00:{String(selected * 4).padStart(2, '0')}:00</span><button onClick={() => setPlaying(!playing)}>{playing ? <Pause size={18} fill="currentColor"/> : <Play size={18} fill="currentColor"/>}</button><div className={styles.scrubber}><i style={{width: `${(selected + 1) * 20}%`}}/></div><span>00:20:00</span><button><Settings2 size={15}/></button></div>
        </div>
        <div className={styles.miniTimeline}><span className={styles.playhead}/>{sceneArt.map((_, index) => <div key={index} style={{width: '20%'}}><i>0{index + 1}</i></div>)}</div>
      </div>
      <aside className={styles.propertyPanel}>
        <div className={styles.propertyHead}><div><span>선택 장면</span><strong>0{selected + 1} · {sceneNames[selected]}</strong></div><button><MoreHorizontal size={16}/></button></div>
        <Property label="시간" value={`${selected * 4}.0초 – ${(selected + 1) * 4}.0초 · 4초`}/>
        <Property label="대사" value="오늘도 함께여서 좋아." editable/>
        <Property label="핵심 동작" value="루이가 창가에서 몸을 돌려 카메라를 바라본다." editable/>
        <Property label="카메라" value="아이레벨 미디엄 숏 · 천천히 돌리 인" editable/>
        <div className={styles.collapsedRow}><span>시작·종료 화면</span><ChevronDown size={14}/></div>
        <div className={styles.collapsedRow}><span>고급 연출 · 28축</span><ChevronDown size={14}/></div>
        <div className={styles.aiSceneEdit}><div><Sparkles size={14}/><strong>이 장면만 AI로 수정</strong></div><textarea placeholder="예: 조명을 조금 더 따뜻하게 하고 루이가 천천히 눈을 깜빡이게 해줘"/><div><span>비용 없는 설정 변경은 즉시 적용됩니다</span><button><ArrowUp size={14}/></button></div></div>
        <div className={styles.panelFooter}><button className={styles.secondaryButton}>이미지 재생성</button><button className={styles.primaryButton}>스토리보드 전체 승인</button></div>
        <button className={styles.nextMockPanel} onClick={onNext}>승인된 상태로 생성 화면 보기</button>
      </aside>
    </div>
  </section>;
}

function GenerationStage({onNext}: {onNext: () => void}) {
  return <section className={styles.generationStage}>
    <StageHeader title="영상 생성" description="승인된 스토리보드를 하나의 연속된 영상으로 만듭니다." progress="제출 전 최종 확인"/>
    <div className={styles.generationContent}>
      <div className={styles.generationPreview}><div className={`${styles.generationMovie} ${styles.sceneThree}`}><span className={styles.approvedPill}><Check size={12}/> 승인된 애니매틱</span><button><Play size={23} fill="currentColor"/></button></div><div className={styles.movieMeta}><span>함께여서 좋은 하루</span><span>00:20 · 16:9</span></div></div>
      <div className={styles.generationCard}>
        <div className={styles.genTitle}><div><span>최종 생성 설정</span><h2>Seedance 2.5 마스터 생성</h2></div><span className={styles.lockedBadge}><Lock size={12}/> 승인본 잠금 예정</span></div>
        <div className={styles.genSummary}>
          <div><span>모델</span><strong>Dreamina Seedance 2.5</strong></div><div><span>생성 단위</span><strong>전체 영상 · 1회</strong></div><div><span>길이</span><strong>20초</strong></div><div><span>화면비</span><strong>16:9</strong></div><div><span>해상도</span><strong>480p Canary</strong></div><div><span>참조</span><strong>기준 시트 3개</strong></div>
        </div>
        <div className={styles.promptSummary}><div><Sparkles size={14}/><strong>마스터 프롬프트 준비됨</strong><button>고급 내용 보기 <ChevronDown size={12}/></button></div><p>5개 장면의 카메라 흐름, 캐릭터 연속성, 조명 변화와 전환 리듬을 하나의 생성 지시로 통합했습니다.</p></div>
        <div className={styles.costBox}><div><span>예상 작업</span><strong>영상 1개 생성</strong></div><div><span>예상 비용</span><strong>활성화 후 표시</strong></div><p>현재 유료 제출은 안전을 위해 잠겨 있습니다. 리소스 팩 활성화 전에는 비용이 발생하지 않습니다.</p></div>
        <button className={styles.generateButton} disabled><Lock size={16}/> Seedance 활성화 후 영상 생성</button>
        <button className={styles.nextMockPanel} onClick={onNext}>완료된 결과로 편집 화면 보기</button>
      </div>
    </div>
  </section>;
}

function TimelineStage({playing, setPlaying}: {playing: boolean; setPlaying: (value: boolean) => void}) {
  return <section className={styles.timelineStage}>
    <div className={styles.timelineToolbar}><div><button><ChevronLeft size={15}/></button><span className={styles.projectCrumb}>함께여서 좋은 하루 <i>·</i> 편집</span></div><div><button><Undo2 size={14}/></button><button><RotateCcw size={14}/></button><span className={styles.timelineTime}>00:07:14 / 00:20:00</span></div><div><button className={styles.exportButton}>내보내기 <ChevronDown size={13}/></button></div></div>
    <div className={styles.timelineWorkspace}>
      <aside className={styles.assetRail}><button className={styles.assetActive}><Film size={18}/><span>미디어</span></button><button><Music2 size={18}/><span>오디오</span></button><button><FileText size={18}/><span>텍스트</span></button><button><Layers3 size={18}/><span>그래픽</span></button></aside>
      <aside className={styles.assetPanel}><div className={styles.assetHead}><strong>프로젝트 미디어</strong><button><Plus size={14}/></button></div><div className={styles.assetSearch}><Search size={13}/> 검색</div><div className={styles.assetGrid}>{sceneArt.slice(0,4).map((art,index)=><div key={art}><div className={`${styles.assetThumb} ${art}`}><Video size={12}/></div><span>scene_0{index+1}.mp4</span></div>)}</div></aside>
      <div className={styles.programArea}><div className={styles.programTabs}><button className={styles.programActive}>프로그램</button><button>소스</button><span>1/2</span></div><div className={`${styles.programMonitor} ${styles.sceneFour}`}><div className={styles.videoFrame}><span>함께여서 좋은 하루</span></div></div><div className={styles.transport}><button><ChevronLeft size={15}/></button><button onClick={() => setPlaying(!playing)}>{playing?<Pause size={17} fill="currentColor"/>:<Play size={17} fill="currentColor"/>}</button><button><ChevronRight size={15}/></button><span>00:07:14</span><button><Settings2 size={14}/></button></div></div>
      <aside className={styles.aiPanel}><div className={styles.aiPanelHead}><div><Sparkles size={15}/><strong>AI 수정</strong></div><button><MoreHorizontal size={15}/></button></div><div className={styles.selectionBox}><span>선택 구간</span><strong>00:07.2 – 00:10.5</strong><div className={`${styles.selectionThumb} ${styles.sceneThree}`}/></div><div className={styles.aiHistory}><div><span>나</span><p>여기서 제품이 너무 작게 보여. 카메라를 더 가까이 잡아줘.</p></div><div className={styles.aiSuggestion}><span><Sparkles size={12}/> 수정 제안</span><p>선택 구간을 미디엄 숏에서 클로즈업으로 바꾸고, 다음 장면 연결을 위해 종료 프레임은 유지할게요.</p><div><button>취소</button><button>적용</button></div></div></div><div className={styles.aiTimelineInput}><input placeholder="선택 구간을 어떻게 바꿀까요?"/><button><ArrowUp size={14}/></button></div></aside>
    </div>
    <TimelineDock/>
  </section>;
}

function TimelineDock() {
  const tracks = [
    {name:'V3', kind:'video', clips:[]},
    {name:'V2', kind:'video', clips:[{left:55,width:20,label:'Take B'}]},
    {name:'V1', kind:'video', clips:[{left:0,width:24,label:'Scene 01'},{left:25,width:20,label:'Scene 02'},{left:46,width:26,label:'Scene 03'},{left:73,width:27,label:'Scene 04–05'}]},
    {name:'A1', kind:'audio', clips:[{left:0,width:100,label:'Narration_mix.wav'}]},
    {name:'A2', kind:'audio', clips:[{left:0,width:100,label:'Warm_brand_theme.mp3'}]},
    {name:'T1', kind:'text', clips:[{left:10,width:28,label:'오늘도 함께여서 좋아'},{left:73,width:25,label:'함께봄'}]},
  ];
  return <div className={styles.timelineDock}><div className={styles.dockTools}><button><Split size={14}/></button><button><Undo2 size={14}/></button><span/><button>−</button><div className={styles.zoomLine}><i/></div><button>+</button></div><div className={styles.ruler}><span/><div>{[0,2,4,6,8,10,12,14,16,18,20].map(n=><i key={n}>{String(n).padStart(2,'0')}:00</i>)}</div></div><div className={styles.trackRows}><span className={styles.timelinePlayhead}/>{tracks.map(track=><div className={styles.trackRow} key={track.name}><div className={styles.trackLabel}><strong>{track.name}</strong><span>M</span><span>S</span><Lock size={10}/></div><div className={styles.trackLane}>{track.clips.map((clip,index)=><div key={index} className={`${styles.clip} ${styles[`clip_${track.kind}`]}`} style={{left:`${clip.left}%`,width:`${clip.width}%`}}><span>{clip.label}</span></div>)}</div></div>)}</div></div>;
}

function StageHeader({title, description, progress, action}: {title: string; description: string; progress: string; action?: string}) {
  return <div className={styles.stageHeader}><div><span>PROJECT · 함께여서 좋은 하루</span><h1>{title}</h1><p>{description}</p></div><div><span className={styles.progressPill}>{progress}</span>{action && <button className={styles.headerAction}><Play size={13}/>{action}</button>}</div></div>;
}

function Property({label, value, editable}: {label: string; value: string; editable?: boolean}) {
  return <div className={styles.property}><div><span>{label}</span>{editable && <button>수정</button>}</div><p>{value}</p></div>;
}
