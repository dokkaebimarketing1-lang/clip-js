export type ProjectSaveState = 'saved' | 'dirty' | 'saving' | 'error';

export type ProjectSaveStatus = {
  state: ProjectSaveState;
  savedRevision: number;
  pendingRevision: number;
  error?: string;
};

export type ProjectSaveRequest<T> = {
  snapshot: T;
  expectedRevision: number;
  revision: number;
};

export type ProjectSaveAcknowledgement = {
  revision: number;
};

export class ProjectSaveError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ProjectSaveError';
    this.cause = cause;
  }
}

type ProjectSaveCoordinatorOptions<T> = {
  initialRevision: number;
  persist: (request: ProjectSaveRequest<T>) => Promise<void>;
  onStatus?: (status: ProjectSaveStatus) => void;
  clone?: (snapshot: T) => T;
};

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : 'Project save failed.';

export class ProjectSaveCoordinator<T> {
  private readonly persist: ProjectSaveCoordinatorOptions<T>['persist'];
  private readonly onStatus?: ProjectSaveCoordinatorOptions<T>['onStatus'];
  private readonly clone: (snapshot: T) => T;
  private savedRevision: number;
  private pendingRevision: number;
  private latestSnapshot?: T;
  private status: ProjectSaveStatus;
  private tail: Promise<ProjectSaveAcknowledgement>;
  private failed = false;
  private dirtyVersion = 0;

  constructor(options: ProjectSaveCoordinatorOptions<T>) {
    if (!Number.isSafeInteger(options.initialRevision) || options.initialRevision < 0) {
      throw new Error('initialRevision must be a non-negative safe integer.');
    }
    this.persist = options.persist;
    this.onStatus = options.onStatus;
    this.clone = options.clone ?? ((snapshot) => structuredClone(snapshot));
    this.savedRevision = options.initialRevision;
    this.pendingRevision = options.initialRevision;
    this.status = {state: 'saved', savedRevision: this.savedRevision, pendingRevision: this.pendingRevision};
    this.tail = Promise.resolve({revision: this.savedRevision});
  }

  getStatus(): ProjectSaveStatus {
    return {...this.status};
  }

  markDirty(snapshot: T): void {
    this.latestSnapshot = this.clone(snapshot);
    this.dirtyVersion += 1;
    if (this.failed) this.publish({state: 'error', error: this.status.error});
    else this.publish({state: 'dirty', error: undefined});
  }

  saveNow(snapshot: T): Promise<ProjectSaveAcknowledgement> {
    this.markDirty(snapshot);
    return this.saveLatest();
  }

  saveLatest(): Promise<ProjectSaveAcknowledgement> {
    if (!this.latestSnapshot) return this.tail;
    if (this.failed) {
      this.pendingRevision = this.savedRevision + 1;
      this.publish({state: 'error', error: this.status.error});
      return Promise.reject(new ProjectSaveError(this.status.error ?? 'Project save failed. Retry is required.'));
    }

    const revision = this.pendingRevision + 1;
    this.pendingRevision = revision;
    const queuedSnapshot = this.clone(this.latestSnapshot);
    const queuedDirtyVersion = this.dirtyVersion;
    const run = this.tail.then(() => this.persistRevision(queuedSnapshot, revision, queuedDirtyVersion));
    this.tail = run;
    return run;
  }

  retry(): Promise<ProjectSaveAcknowledgement> {
    if (!this.latestSnapshot) {
      return Promise.reject(new ProjectSaveError('There is no failed project snapshot to retry.'));
    }
    const revision = this.savedRevision + 1;
    this.pendingRevision = revision;
    const snapshot = this.clone(this.latestSnapshot);
    this.failed = false;
    this.publish({state: 'dirty', error: undefined});
    const queuedDirtyVersion = this.dirtyVersion;
    const run = this.persistRevision(snapshot, revision, queuedDirtyVersion);
    this.tail = run;
    return run;
  }

  flush(): Promise<ProjectSaveAcknowledgement> {
    return this.tail;
  }

  private async persistRevision(snapshot: T, revision: number, queuedDirtyVersion: number): Promise<ProjectSaveAcknowledgement> {
    this.publish({state: 'saving', error: undefined});
    try {
      await this.persist({snapshot, expectedRevision: revision - 1, revision});
      this.savedRevision = revision;
      this.failed = false;
      this.publish({state: this.savedRevision === this.pendingRevision && this.dirtyVersion === queuedDirtyVersion ? 'saved' : 'dirty', error: undefined});
      return {revision};
    } catch (error) {
      this.failed = true;
      const message = errorMessage(error);
      this.publish({state: 'error', error: message});
      throw new ProjectSaveError(`Project save failed: ${message}`, error);
    }
  }

  private publish(update: Pick<ProjectSaveStatus, 'state'> & {error?: string}): void {
    this.status = {
      state: update.state,
      savedRevision: this.savedRevision,
      pendingRevision: this.pendingRevision,
      ...(update.error ? {error: update.error} : {}),
    };
    this.onStatus?.({...this.status});
  }
}
