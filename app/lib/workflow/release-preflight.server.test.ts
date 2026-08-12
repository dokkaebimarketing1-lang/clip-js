import {beforeAll, describe, expect, it, vi} from 'vitest';
vi.mock('server-only', () => ({}));
import {initialState} from '@/app/store/slices/projectSlice';
import {signTakeApproval} from '@/app/lib/security/approval-signature';
import {postProductionSchema} from './schema';
import {assertReleasePreflight} from './release-preflight.server';

beforeAll(() => { process.env.CLIPJS_APPROVAL_TOKEN = 'release-preflight-test-secret'; process.env.CLIPJS_APPROVAL_SIGNING_SECRET = 'release-preflight-signing-secret'; });

const project = () => {
  const value = structuredClone(initialState);
  value.id = 'project-release';
  value.projectName = 'Release';
  value.duration = 30;
  const hash = 'a'.repeat(64);
  const assetId = 'ga_11111111111111111111111111111111';
  const takeId = 'take-release';
  const approval = signTakeApproval(value.id, {
    status: 'approved', takeId, assetId, contentSha256: hash,
    approvedAt: '2026-08-11T00:00:00.000Z', approvedBy: 'owner',
  });
  value.workflow.production.takes = [{
    id: takeId, scope: 'production', structuredSpecHash: '1'.repeat(64), compiledPromptHash: '2'.repeat(64),
    assetBundleHash: hash, continuityLockHash: '3'.repeat(64), provider: 'byteplus', model: 'dreamina-seedance-2-5-260628',
    requestKey: '4'.repeat(64), outputAssetId: assetId, contentSha256: hash, qcStatus: 'approved', takeApproval: approval,
    verdict: 'accepted', selected: true, createdAt: '2026-08-11T00:00:00.000Z',
  }];
  value.mediaFiles = [
    {id: 'media-generated', fileName: 'generated.mp4', source: {kind: 'generated', generatedAssetId: assetId}, generatedAssetId: assetId, contentSha256: hash, takeId, type: 'video', startTime: 0, endTime: 30, positionStart: 0, positionEnd: 30, includeInMerge: true, playbackSpeed: 1, volume: 20, zIndex: 1, opacity: 100, provider: 'byteplus'},
    {id: 'audio-dialogue', source: {kind: 'managed', assetId: `ga_${'d'.repeat(32)}`}, contentSha256: '1'.repeat(64), fileName: 'dialogue.wav', type: 'audio', startTime: 0, endTime: 3, positionStart: 0, positionEnd: 3, includeInMerge: true, playbackSpeed: 1, volume: 100, zIndex: 2, opacity: 100},
    {id: 'audio-room', source: {kind: 'managed', assetId: `ga_${'e'.repeat(32)}`}, contentSha256: '2'.repeat(64), fileName: 'room.wav', type: 'audio', startTime: 0, endTime: 30, positionStart: 0, positionEnd: 30, includeInMerge: true, playbackSpeed: 1, volume: 30, zIndex: 0, opacity: 100},
    {id: 'ui-screen', source: {kind: 'managed', assetId: `ga_${'f'.repeat(32)}`}, contentSha256: '3'.repeat(64), fileName: 'ui.png', type: 'image', startTime: 0, endTime: 5, positionStart: 10, positionEnd: 15, includeInMerge: true, playbackSpeed: 1, volume: 0, zIndex: 5, opacity: 100},
  ];
  value.textElements = [
    {id: 'brand-text', text: '브랜드', positionStart: 27, positionEnd: 30, x: 0, y: 0, zIndex: 10, opacity: 100, includeInMerge: true},
    {id: 'cta-text', text: '지금 상담하세요', positionStart: 27, positionEnd: 30, x: 0, y: 100, zIndex: 10, opacity: 100, includeInMerge: true},
  ];
  value.workflow.storyboard = {version: 'v1', title: 'Release', noBgm: true, cuts: [{id: 'CUT01', title: 'cut', absoluteStartSeconds: 0, absoluteEndSeconds: 30, shots: [{id: 'S1', startSeconds: 0, endSeconds: 30, startFrame: 'start', endFrame: 'end', camera: 'static', action: 'act', dialogue: '—', sfx: 'room'}]}]};
  value.workflow.captions = [{id: 'caption-1', text: '지금 바로 상담할 수 있어요.', startSeconds: 0, endSeconds: 3, kind: 'dialogue', preset: 'dialogue-clean', position: 'bottom', intensity: 0.5, accentColor: '#ffd43b', fontFamily: 'Noto Sans KR Variable', wordTimings: [], emphasis: [], safeArea: true}];
  value.workflow.postProduction = postProductionSchema.parse({
    sourceAudioPolicy: 'duck',
    dialogueCues: [{id: 'dialogue-1', text: '지금 바로 상담할 수 있어요.', language: 'ko-KR', speaker: '상담사', mediaId: 'audio-dialogue', startSeconds: 0, endSeconds: 3}],
    ambience: [{id: 'ambience-1', mediaId: 'audio-room', startSeconds: 0, endSeconds: 30, volume: 30}],
    sfx: [], bgm: [],
    appUiOverlays: [{id: 'ui-1', mediaId: 'ui-screen', screenName: '상담 화면', source: 'verified-app-capture', startSeconds: 10, endSeconds: 15, accessibilityLabel: '검증된 상담 화면'}],
    endingCard: {brandName: '브랜드', cta: '지금 상담하세요', brandTextElementId: 'brand-text', ctaTextElementId: 'cta-text', startSeconds: 27, endSeconds: 30},
    releaseChecklist: {koreanDialogueReviewed: true, captionsVerified: true, audioMixReviewed: true, appUiVerified: true, ctaVerified: true},
  });
  return value;
};

describe('generated release preflight', () => {
  it('accepts an actual rendered post-production recipe bound to a signed Take', () => {
    expect(() => assertReleasePreflight(project())).not.toThrow();
  });

  it('rejects source-audio keep, caption drift, missing UI media, and Take signature tampering', () => {
    const keep = project(); keep.workflow.postProduction.sourceAudioPolicy = 'keep';
    expect(() => assertReleasePreflight(keep)).toThrow(/muted or ducked/i);
    const caption = project(); caption.workflow.captions[0].text = '다른 자막';
    expect(() => assertReleasePreflight(caption)).toThrow(/exact matching Korean caption/i);
    const ui = project(); ui.mediaFiles = ui.mediaFiles.filter((media) => media.id !== 'ui-screen');
    expect(() => assertReleasePreflight(ui)).toThrow(/visible media/i);
    const hiddenUi = project(); hiddenUi.mediaFiles.find((media) => media.id === 'ui-screen')!.opacity = 0;
    expect(() => assertReleasePreflight(hiddenUi)).toThrow(/invisible or excluded/i);
    const subtitlesOff = project(); subtitlesOff.exportSettings.includeSubtitles = false;
    expect(() => assertReleasePreflight(subtitlesOff)).toThrow(/subtitle export/i);
    const excludedText = project(); excludedText.textElements.find((text) => text.id === 'brand-text')!.includeInMerge = false;
    expect(() => assertReleasePreflight(excludedText)).toThrow(/invisible or excluded/i);
    const tampered = project(); tampered.workflow.production.takes[0].takeApproval.signature = 'f'.repeat(64);
    expect(() => assertReleasePreflight(tampered)).toThrow(/signature is invalid/i);
  });
});
