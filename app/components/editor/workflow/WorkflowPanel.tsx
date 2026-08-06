"use client";

import {useMemo, useState} from 'react';
import toast from 'react-hot-toast';
import {getFile, useAppDispatch, useAppSelector} from '@/app/store';
import {rehydrate, setIncludeSubtitles, setMediaFiles, setWorkflow} from '@/app/store/slices/projectSlice';
import {assertVideoGenerationAllowed, invalidateApproval} from '@/app/lib/workflow/approval';
import {approvalSchema, storyboardSchema, type HiggsfieldAsset, type TransitionSpec} from '@/app/lib/workflow/schema';
import {assertSafeRemoteUrl} from '@/app/lib/security/remote-url';
import {downloadProjectDocument, importProjectIntoCurrentProject, parseProjectDocument} from '@/app/lib/workflow/project-file';
import {parseSrt} from '@/app/lib/captions/srt';
import {normalizeRenderDownloadUrl} from '@/app/lib/render/download-url';
import type {MediaFile} from '@/app/types';

const fieldClass = 'w-full rounded border border-white/15 bg-black/30 px-2 py-1 text-sm text-white';
const buttonClass = 'rounded bg-white px-3 py-2 text-sm font-semibold text-black hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40';

export default function WorkflowPanel() {
  const project = useAppSelector((state) => state.projectState);
  const dispatch = useAppDispatch();
  const [storyboardJson, setStoryboardJson] = useState('');
  const [url, setUrl] = useState('');
  const [model, setModel] = useState('seedance_2_0');
  const [cutId, setCutId] = useState('CUT01');
  const [shotId, setShotId] = useState('S1');
  const [duration, setDuration] = useState(5);
  const [role, setRole] = useState<HiggsfieldAsset['role']>('clip');
  const [srt, setSrt] = useState('');
  const [transitionType, setTransitionType] = useState<TransitionSpec['type']>('fade');
  const [fromMediaId, setFromMediaId] = useState('');
  const [toMediaId, setToMediaId] = useState('');
  const [transitionDuration, setTransitionDuration] = useState(0.35);
  const [apiToken, setApiToken] = useState('');
  const [approvalToken, setApprovalToken] = useState('');
  const [rendering, setRendering] = useState(false);
  const [renderDownloadUrl, setRenderDownloadUrl] = useState('');
  const approvalLabel = useMemo(() => project.workflow.approval.status.toUpperCase(), [project.workflow.approval.status]);

  const importStoryboard = () => {
    try {
      const storyboard = storyboardSchema.parse(JSON.parse(storyboardJson));
      dispatch(setWorkflow({...project.workflow, storyboard, approval: invalidateApproval(project.workflow.approval)}));
      toast.success('Storyboard imported. Previous approval was invalidated.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid storyboard JSON.');
    }
  };

  const approve = async () => {
    if (!project.workflow.storyboard) return toast.error('Import a storyboard first.');
    try {
      const response = await fetch('/api/approval/storyboard', {
        method: 'POST',
        headers: {'content-type': 'application/json', ...(approvalToken ? {'x-clipjs-approval-token': approvalToken} : {})},
        body: JSON.stringify({projectId: project.id, storyboard: project.workflow.storyboard}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Approval failed.');
      const approval = approvalSchema.parse(result);
      dispatch(setWorkflow({...project.workflow, approval}));
      setApprovalToken('');
      toast.success('The exact current storyboard is owner-approved and server-signed.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Approval failed.');
    }
  };

  const importHiggsfield = () => {
    try {
      const safeUrl = assertSafeRemoteUrl(url).toString();
      const cut = project.workflow.storyboard?.cuts.find((item) => item.id === cutId);
      const shot = cut?.shots.find((item) => item.id === shotId);
      if (!cut || !shot) {
        throw new Error('Cut/shot must exist in the imported storyboard.');
      }
      const id = crypto.randomUUID();
      const positionStart = role === 'clip'
        ? project.mediaFiles.reduce((max, item) => Math.max(max, item.positionEnd), 0)
        : cut.absoluteStartSeconds + shot.startSeconds;
      const type = role === 'audio' ? 'audio' : role === 'start' || role === 'end' || role === 'storyboard-sheet' ? 'image' : 'video';
      const extension = type === 'audio' ? 'mp3' : type === 'image' ? 'png' : 'mp4';
      const asset: HiggsfieldAsset = {id, provider: 'higgsfield', model, url: safeUrl, cutId, shotId, role, durationSeconds: duration};
      const media: MediaFile = {
        id,
        fileName: `${cutId}-${shotId}-${role}-${model}.${extension}`,
        fileId: id,
        type,
        startTime: 0,
        endTime: duration,
        positionStart,
        positionEnd: positionStart + duration,
        includeInMerge: true,
        playbackSpeed: 1,
        volume: 100,
        zIndex: 1,
        opacity: 100,
        src: safeUrl,
        remoteUrl: safeUrl,
        provider: 'higgsfield',
        model,
        cutId,
        shotId,
        storyboardRole: role,
      };
      dispatch(setMediaFiles([...project.mediaFiles, media]));
      dispatch(setWorkflow({...project.workflow, higgsfieldAssets: [...project.workflow.higgsfieldAssets, asset]}));
      setUrl('');
      toast.success(`${cutId}/${shotId} Higgsfield ${role} imported at ${positionStart.toFixed(2)}s.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not import Higgsfield media.');
    }
  };

  const importProject = async (file: File) => {
    try {
      const parsed = importProjectIntoCurrentProject(parseProjectDocument(JSON.parse(await file.text())), project.id);
      const mediaFiles = await Promise.all(parsed.mediaFiles.map(async (media) => {
        if (media.remoteUrl) return {...media, src: media.remoteUrl};
        const stored = await getFile(media.fileId);
        return stored ? {...media, src: URL.createObjectURL(stored)} : media;
      }));
      dispatch(rehydrate({...parsed, mediaFiles}));
      toast.success('Project JSON imported.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid project file.');
    }
  };

  const importSrt = () => {
    try {
      dispatch(setWorkflow({...project.workflow, captions: parseSrt(srt)}));
      dispatch(setIncludeSubtitles(true));
      toast.success('Korean captions imported.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid SRT.');
    }
  };

  const addTransition = () => {
    if (!fromMediaId || !toMediaId || fromMediaId === toMediaId) return toast.error('Choose two different media clips.');
    const transition: TransitionSpec = {
      id: crypto.randomUUID(),
      type: transitionType,
      fromMediaId,
      toMediaId,
      durationSeconds: transitionDuration,
    };
    dispatch(setWorkflow({...project.workflow, transitions: [...project.workflow.transitions, transition]}));
    toast.success(`${transitionType} transition added.`);
  };

  const renderProject = async () => {
    setRendering(true);
    setRenderDownloadUrl('');
    try {
      await assertVideoGenerationAllowed(project.workflow);
      const response = await fetch('/api/render', {
        method: 'POST',
        headers: {'content-type': 'application/json', ...(apiToken ? {authorization: `Bearer ${apiToken}`} : {})},
        body: JSON.stringify({project}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Render failed.');
      setRenderDownloadUrl(normalizeRenderDownloadUrl(result.downloadUrl, window.location.origin));
      setApiToken('');
      toast.success('Remotion render completed. Use the download link below.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Render failed.');
    } finally {
      setRendering(false);
    }
  };

  return (
    <div className="space-y-6 text-sm">
      <section className="space-y-2 rounded border border-white/10 p-3">
        <div className="flex items-center justify-between"><h3 className="font-semibold">Approval gate</h3><span className="rounded bg-white/10 px-2 py-1 text-xs">{approvalLabel}</span></div>
        <textarea className={`${fieldClass} min-h-32`} value={storyboardJson} onChange={(event) => setStoryboardJson(event.target.value)} placeholder="Paste storyboard-v2 JSON" />
        <div className="flex gap-2"><button className={buttonClass} onClick={importStoryboard}>Import storyboard</button><button className={buttonClass} onClick={approve} disabled={!project.workflow.storyboard}>Approve exact version</button></div>
        <input className={fieldClass} type="password" autoComplete="off" value={approvalToken} onChange={(event) => setApprovalToken(event.target.value)} placeholder="Owner approval token (production)" />
        <p className="text-xs text-gray-400">Any storyboard change invalidates approval. Video rendering is fail-closed.</p>
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <h3 className="font-semibold">Higgsfield importer</h3>
        <input className={fieldClass} value={url} onChange={(event) => setUrl(event.target.value)} placeholder="HTTPS Higgsfield result URL" />
        <div className="grid grid-cols-2 gap-2"><input className={fieldClass} value={cutId} onChange={(event) => setCutId(event.target.value)} /><input className={fieldClass} value={shotId} onChange={(event) => setShotId(event.target.value)} /></div>
        <div className="grid grid-cols-2 gap-2"><input className={fieldClass} value={model} onChange={(event) => setModel(event.target.value)} /><input className={fieldClass} type="number" min={0.1} step={0.1} value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></div>
        <select className={fieldClass} value={role} onChange={(event) => setRole(event.target.value as HiggsfieldAsset['role'])}>
          {['clip', 'audio', 'start', 'end', 'storyboard-sheet'].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <button className={buttonClass} onClick={importHiggsfield} disabled={!url}>Import storyboard-mapped {role}</button>
      </section>

      <section className="space-y-2 border-t border-white/10 pt-3">
        <h3 className="font-semibold">Korean captions (SRT)</h3>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={project.exportSettings.includeSubtitles} onChange={(event) => dispatch(setIncludeSubtitles(event.target.checked))} /> Include captions in preview and render</label>
        <textarea className={`${fieldClass} min-h-24`} value={srt} onChange={(event) => setSrt(event.target.value)} placeholder={'1\n00:00:00,000 --> 00:00:02,000\n한국어 자막'} />
        <button className={buttonClass} onClick={importSrt} disabled={!srt}>Import SRT</button>
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <h3 className="font-semibold">Frame-accurate transition</h3>
        <select className={fieldClass} value={transitionType} onChange={(event) => setTransitionType(event.target.value as TransitionSpec['type'])}>{['fade', 'wipe', 'slide', 'whip-pan', 'flash', 'blur', 'push', 'zoom'].map((type) => <option key={type}>{type}</option>)}</select>
        <div className="grid grid-cols-2 gap-2">
          <select className={fieldClass} value={fromMediaId} onChange={(event) => setFromMediaId(event.target.value)}><option value="">From clip</option>{project.mediaFiles.filter((media) => media.type === 'video' || media.type === 'image').map((media) => <option key={media.id} value={media.id}>{media.fileName}</option>)}</select>
          <select className={fieldClass} value={toMediaId} onChange={(event) => setToMediaId(event.target.value)}><option value="">To clip</option>{project.mediaFiles.filter((media) => media.type === 'video' || media.type === 'image').map((media) => <option key={media.id} value={media.id}>{media.fileName}</option>)}</select>
        </div>
        <input className={fieldClass} type="number" min={0.05} max={3} step={0.05} value={transitionDuration} onChange={(event) => setTransitionDuration(Number(event.target.value))} />
        <button className={buttonClass} onClick={addTransition} disabled={!fromMediaId || !toMediaId}>Add transition</button>
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <h3 className="font-semibold">Project JSON</h3>
        <button className={buttonClass} onClick={() => downloadProjectDocument(project)}>Export project</button>
        <label className={`${buttonClass} ml-2 inline-block cursor-pointer`}>Import project<input className="hidden" type="file" accept="application/json,.json" onChange={(event) => event.target.files?.[0] && importProject(event.target.files[0])} /></label>
      </section>

      <section className="space-y-2 rounded border border-white/10 p-3">
        <h3 className="font-semibold">Remotion final render</h3>
        <input className={fieldClass} type="password" value={apiToken} onChange={(event) => setApiToken(event.target.value)} placeholder="CLIPJS_AGENT_TOKEN (production)" />
        <button className={buttonClass} onClick={renderProject} disabled={rendering || project.workflow.approval.status !== 'approved'}>{rendering ? 'Rendering…' : 'Render approved project'}</button>
        {renderDownloadUrl && <a className={`${buttonClass} inline-block`} href={renderDownloadUrl} download>Download rendered MP4</a>}
      </section>
    </div>
  );
}
