import {describe, expect, it, vi} from 'vitest';
import {ProjectSaveCoordinator, ProjectSaveError} from './project-save-coordinator';

type Snapshot = {id: string; revision: number; value: string};

describe('ProjectSaveCoordinator', () => {
  it('serializes saves and acknowledges only durable revisions', async () => {
    const persisted: Snapshot[] = [];
    const coordinator = new ProjectSaveCoordinator<Snapshot>({
      initialRevision: 0,
      persist: async ({snapshot, expectedRevision, revision}) => {
        expect(expectedRevision).toBe(persisted.at(-1)?.revision ?? 0);
        await Promise.resolve();
        persisted.push({...snapshot, revision});
      },
    });

    const first = coordinator.saveNow({id: 'project-1', revision: 0, value: 'first'});
    const second = coordinator.saveNow({id: 'project-1', revision: 0, value: 'second'});

    await expect(first).resolves.toMatchObject({revision: 1});
    await expect(second).resolves.toMatchObject({revision: 2});
    expect(persisted.map((entry) => [entry.revision, entry.value])).toEqual([[1, 'first'], [2, 'second']]);
    expect(coordinator.getStatus()).toMatchObject({state: 'saved', savedRevision: 2, pendingRevision: 2});
  });

  it('keeps edit B dirty when save A acknowledges, then persists only the latest snapshot', async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const persisted: string[] = [];
    const coordinator = new ProjectSaveCoordinator<Snapshot>({
      initialRevision: 0,
      persist: async ({snapshot, revision}) => {
        if (revision === 1) await firstGate;
        persisted.push(snapshot.value);
      },
    });
    const first = coordinator.saveNow({id: 'project-1', revision: 0, value: 'A'});
    await Promise.resolve();
    coordinator.markDirty({id: 'project-1', revision: 0, value: 'B'});
    releaseFirst();
    await first;
    expect(coordinator.getStatus().state).toBe('dirty');
    await coordinator.saveLatest();
    expect(persisted).toEqual(['A', 'B']);
    expect(coordinator.getStatus().state).toBe('saved');
  });

  it('surfaces persistence failures and keeps the dirty revision retryable', async () => {
    const failure = new DOMException('Quota exceeded', 'QuotaExceededError');
    const persist = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    const statuses: string[] = [];
    const coordinator = new ProjectSaveCoordinator<Snapshot>({
      initialRevision: 4,
      persist,
      onStatus: (status) => statuses.push(status.state),
    });

    const snapshot = {id: 'project-1', revision: 4, value: 'edited'};
    await expect(coordinator.saveNow(snapshot)).rejects.toBeInstanceOf(ProjectSaveError);
    expect(coordinator.getStatus()).toMatchObject({state: 'error', savedRevision: 4, pendingRevision: 5});
    expect(coordinator.getStatus().error).toContain('Quota exceeded');

    await expect(coordinator.retry()).resolves.toMatchObject({revision: 5});
    expect(persist).toHaveBeenCalledTimes(2);
    expect(coordinator.getStatus()).toMatchObject({state: 'saved', savedRevision: 5});
    expect(statuses).toContain('error');
  });

  it('does not convert a failed save into a fulfilled queue entry', async () => {
    const coordinator = new ProjectSaveCoordinator<Snapshot>({
      initialRevision: 0,
      persist: async () => { throw new Error('disk write failed'); },
    });

    await expect(coordinator.saveNow({id: 'project-1', revision: 0, value: 'unsafe'}))
      .rejects.toThrow('disk write failed');
    await expect(coordinator.flush()).rejects.toThrow('disk write failed');
  });
});
