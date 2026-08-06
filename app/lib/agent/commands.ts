import {z} from 'zod';
import {sha256} from '../workflow/hash';
import {type ProjectState} from '@/app/types';
import {assertSafeRemoteUrl} from '../security/remote-url';

export const agentCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('import_clip'),
    url: z.string().url(),
    model: z.string().min(1),
    cutId: z.string().min(1),
    shotId: z.string().min(1),
    role: z.enum(['clip', 'audio']).default('clip'),
    durationSeconds: z.number().positive(),
    positionStart: z.number().nonnegative().optional(),
    jobId: z.string().optional(),
  }),
  z.object({type: z.literal('trim_clip'), mediaId: z.string().min(1), startTime: z.number().nonnegative(), endTime: z.number().positive()}),
  z.object({type: z.literal('add_transition'), fromMediaId: z.string().min(1), toMediaId: z.string().min(1), transition: z.enum(['fade', 'wipe', 'slide', 'whip-pan', 'flash', 'blur', 'push', 'zoom']), durationSeconds: z.number().min(0).max(3)}),
  z.object({type: z.literal('add_caption'), text: z.string().min(1).max(500), startSeconds: z.number().nonnegative(), endSeconds: z.number().positive(), preset: z.enum(['clean', 'bold-highlight', 'cinematic', 'shorts']).default('clean')}),
  z.object({type: z.literal('set_playback_speed'), mediaId: z.string().min(1), playbackSpeed: z.number().min(0.1).max(4)}),
]);

export type AgentCommand = z.infer<typeof agentCommandSchema>;
export type AgentChangeSet = {token: string; baseProjectHash: string; summary: string; command: AgentCommand; proposedProject: ProjectState};

const cloneProject = (project: ProjectState): ProjectState => structuredClone(project);

const editableProjectFingerprint = (project: ProjectState) => ({
  id: project.id,
  projectName: project.projectName,
  mediaFiles: project.mediaFiles.map(({src: _src, ...media}) => media),
  textElements: project.textElements,
  duration: project.duration,
  resolution: project.resolution,
  fps: project.fps,
  aspectRatio: project.aspectRatio,
  exportSettings: project.exportSettings,
  workflow: project.workflow,
});

const finalizeAgentChange = (project: ProjectState, summary: string): {project: ProjectState; summary: string} => {
  const mediaEnd = project.mediaFiles.reduce((maximum, item) => Math.max(maximum, item.positionEnd), 0);
  const textEnd = project.textElements.reduce((maximum, item) => Math.max(maximum, item.positionEnd), 0);
  const captionEnd = project.workflow.captions.reduce((maximum, item) => Math.max(maximum, item.endSeconds), 0);
  project.duration = Math.max(mediaEnd, textEnd, captionEnd);
  return {project, summary};
};

export const applyAgentCommand = (project: ProjectState, input: unknown): {project: ProjectState; summary: string} => {
  const command = agentCommandSchema.parse(input);
  const next = cloneProject(project);
  if (command.type === 'import_clip') {
    const url = assertSafeRemoteUrl(command.url).toString();
    const cut = next.workflow.storyboard?.cuts.find((item) => item.id === command.cutId);
    const shot = cut?.shots.find((item) => item.id === command.shotId);
    if (!cut || !shot) throw new Error('Import target cut/shot does not exist in the storyboard.');
    const id = crypto.randomUUID();
    const positionStart = command.positionStart ?? (command.role === 'audio'
      ? cut.absoluteStartSeconds + shot.startSeconds
      : next.mediaFiles.reduce((max, item) => Math.max(max, item.positionEnd), 0));
    next.mediaFiles.push({
      id,
      fileId: id,
      fileName: `${command.cutId}-${command.shotId}-${command.role}.${command.role === 'audio' ? 'mp3' : 'mp4'}`,
      type: command.role === 'audio' ? 'audio' : 'video',
      startTime: 0,
      endTime: command.durationSeconds,
      positionStart,
      positionEnd: positionStart + command.durationSeconds,
      includeInMerge: true,
      playbackSpeed: 1,
      volume: 100,
      zIndex: command.role === 'audio' ? 0 : 1,
      opacity: 100,
      src: url,
      remoteUrl: url,
      provider: 'higgsfield',
      model: command.model,
      jobId: command.jobId,
      cutId: command.cutId,
      shotId: command.shotId,
      storyboardRole: command.role,
    });
    next.workflow.higgsfieldAssets.push({
      id,
      provider: 'higgsfield',
      model: command.model,
      jobId: command.jobId,
      url,
      cutId: command.cutId,
      shotId: command.shotId,
      role: command.role,
      durationSeconds: command.durationSeconds,
    });
    next.duration = Math.max(next.duration, positionStart + command.durationSeconds);
    return finalizeAgentChange(next, `Import ${command.cutId}/${command.shotId} ${command.role} at ${positionStart}s`);
  }
  if (command.type === 'trim_clip') {
    if (command.endTime <= command.startTime) throw new Error('Trim end must be after start.');
    const media = next.mediaFiles.find((item) => item.id === command.mediaId);
    if (!media) throw new Error('Media clip not found.');
    media.startTime = command.startTime;
    media.endTime = command.endTime;
    media.positionEnd = media.positionStart + (command.endTime - command.startTime) / (media.playbackSpeed || 1);
    return finalizeAgentChange(next, `Trim ${media.fileName} to ${command.startTime}s–${command.endTime}s`);
  }
  if (command.type === 'set_playback_speed') {
    const media = next.mediaFiles.find((item) => item.id === command.mediaId);
    if (!media) throw new Error('Media clip not found.');
    media.playbackSpeed = command.playbackSpeed;
    media.positionEnd = media.positionStart + (media.endTime - media.startTime) / command.playbackSpeed;
    return finalizeAgentChange(next, `Set ${media.fileName} speed to ${command.playbackSpeed}×`);
  }
  if (command.type === 'add_transition') {
    const from = next.mediaFiles.find((item) => item.id === command.fromMediaId);
    const to = next.mediaFiles.find((item) => item.id === command.toMediaId);
    if (!from || !to) throw new Error('Transition media clip not found.');
    if (!['video', 'image'].includes(from.type) || !['video', 'image'].includes(to.type)) throw new Error('Transitions require visual media clips.');
    next.workflow.transitions.push({id: crypto.randomUUID(), fromMediaId: from.id, toMediaId: to.id, type: command.transition, durationSeconds: command.durationSeconds});
    return finalizeAgentChange(next, `Add ${command.transition} transition (${command.durationSeconds}s)`);
  }
  next.workflow.captions.push({id: crypto.randomUUID(), text: command.text, startSeconds: command.startSeconds, endSeconds: command.endSeconds, preset: command.preset, emphasis: [], safeArea: true});
  return finalizeAgentChange(next, `Add caption “${command.text}”`);
};

export const previewAgentCommand = async (project: ProjectState, input: unknown): Promise<AgentChangeSet> => {
  const command = agentCommandSchema.parse(input);
  const {project: proposedProject, summary} = applyAgentCommand(project, command);
  const baseProjectHash = await sha256(editableProjectFingerprint(project));
  const token = await sha256({projectId: project.id, baseProjectHash, command, proposedProject});
  return {token, baseProjectHash, summary, command, proposedProject};
};

export const approveAgentChange = async (currentProject: ProjectState, changeSet: AgentChangeSet, token: string): Promise<ProjectState> => {
  const currentHash = await sha256(editableProjectFingerprint(currentProject));
  if (currentHash !== changeSet.baseProjectHash) throw new Error('Agent change preview is stale; preview the current project again.');
  const expected = await sha256({projectId: currentProject.id, baseProjectHash: changeSet.baseProjectHash, command: changeSet.command, proposedProject: changeSet.proposedProject});
  if (token !== expected || token !== changeSet.token) throw new Error('Agent change approval token is invalid or stale.');
  if (currentProject.id !== changeSet.proposedProject.id) throw new Error('Agent change targets another project.');
  return {
    ...changeSet.proposedProject,
    currentTime: currentProject.currentTime,
    isPlaying: currentProject.isPlaying,
    isMuted: currentProject.isMuted,
    zoomLevel: currentProject.zoomLevel,
    timelineZoom: currentProject.timelineZoom,
    enableMarkerTracking: currentProject.enableMarkerTracking,
    activeSection: currentProject.activeSection,
    activeElement: currentProject.activeElement,
    activeElementIndex: currentProject.activeElementIndex,
    history: currentProject.history,
    future: currentProject.future,
  };
};
