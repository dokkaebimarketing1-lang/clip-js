'use client';
import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import { openDB } from 'idb';
import projectStateReducer from './slices/projectSlice';
import projectsReducer from './slices/projectsSlice';
import toast from 'react-hot-toast';
import type {ProjectState} from '../types';
import {parseProjectState} from '@/app/lib/workflow/project-file';

// IndexedDB schema version is intentionally independent from projectSchemaVersion.
const CLIPJS_DB_VERSION = 3;

export type ProjectMigrationBackup = {
    id: string;
    projectId: string;
    sourceSchemaVersion: number;
    createdAt: string;
    snapshot: unknown;
};

export class ProjectRevisionConflictError extends Error {
    constructor(public readonly expectedRevision: number, public readonly actualRevision: number) {
        super(`Project revision conflict: expected ${expectedRevision}, found ${actualRevision}.`);
        this.name = 'ProjectRevisionConflictError';
    }
}

// Create IndexedDB database for files and projects
export const setupDB = async () => {
    if (typeof window === 'undefined') return null;
    const activeDb = await openDB('clipjs-files', CLIPJS_DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
            if (!db.objectStoreNames.contains('projectBackups')) db.createObjectStore('projectBackups', { keyPath: 'id' });
        },
        blocking() {
            activeDb?.close();
        },
    });
    return activeDb;
};

const projectVersion = (value: unknown): number => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
    const version = (value as Record<string, unknown>).projectSchemaVersion;
    return typeof version === 'number' && Number.isSafeInteger(version) ? version : 0;
};

const projectIdOf = (value: unknown): string => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown-project';
    const id = (value as Record<string, unknown>).id;
    return typeof id === 'string' && id.length > 0 ? id : 'unknown-project';
};

const backupLegacyProject = async (db: NonNullable<Awaited<ReturnType<typeof setupDB>>>, snapshot: unknown): Promise<void> => {
    if (projectVersion(snapshot) === 3) return;
    const projectId = projectIdOf(snapshot);
    const serialized = JSON.stringify(snapshot);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${projectId}\0${serialized}`));
    const snapshotHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const backupId = `${projectId}:${snapshotHash}`;
    if (await db.get('projectBackups', backupId)) return;
    const backup: ProjectMigrationBackup = {
        id: backupId,
        projectId,
        sourceSchemaVersion: projectVersion(snapshot),
        createdAt: new Date().toISOString(),
        snapshot: structuredClone(snapshot),
    };
    await db.put('projectBackups', backup);
};

export const listProjectMigrationBackups = async (projectId?: string): Promise<ProjectMigrationBackup[]> => {
    const db = await setupDB();
    if (!db) throw new Error('Project database is unavailable.');
    const backups = (await db.getAll('projectBackups')) as ProjectMigrationBackup[];
    return projectId ? backups.filter((backup) => backup.projectId === projectId) : backups;
};

// Load state from localStorage
export const loadState = () => {
    if (typeof window === 'undefined') return undefined;
    try {
        const serializedState = localStorage.getItem('clipjs-state');
        if (serializedState === null) return undefined;
        return JSON.parse(serializedState);
    } catch (error) {
        toast.error('Error loading state from localStorage');
        console.error('Error loading state from localStorage:', error);
        return undefined;
    }
};

// File storage functions
export const storeFile = async (file: File, fileId: string) => {
    if (typeof window === 'undefined') throw new Error('File storage is only available in the browser.');
    try {
        const db = await setupDB();
        if (!db) throw new Error('File database is unavailable.');

        const fileData = {
            id: fileId,
            file: file,
        };

        await db.put('files', fileData);
        return fileId;
    } catch (error) {
        toast.error('Error storing file');
        console.error('Error storing file:', error);
        throw error;
    }
};

export const getFile = async (fileId: string) => {
    if (typeof window === 'undefined') throw new Error('File storage is only available in the browser.');
    try {
        const db = await setupDB();
        if (!db) throw new Error('File database is unavailable.');

        const fileData = await db.get('files', fileId);
        if (!fileData) return null;

        return fileData.file;
    } catch (error) {
        toast.error('Error retrieving file');
        console.error('Error retrieving file:', error);
        throw error;
    }
};

export const deleteFile = async (fileId: string) => {
    if (typeof window === 'undefined') throw new Error('File storage is only available in the browser.');
    try {
        const db = await setupDB();
        if (!db) throw new Error('File database is unavailable.');
        await db.delete('files', fileId);
    } catch (error) {
        toast.error('Error deleting file');
        console.error('Error deleting file:', error);
        throw error;
    }
};

export const listFiles = async () => {
    if (typeof window === 'undefined') throw new Error('File storage is only available in the browser.');
    try {
        const db = await setupDB();
        if (!db) throw new Error('File database is unavailable.');
        return await db.getAll('files');
    } catch (error) {
        toast.error('Error listing files');
        console.error('Error listing files:', error);
        throw error;
    }
};

// Project storage functions
export const withProjectWriteLock = async <T>(projectId: string, task: () => Promise<T>): Promise<T> => {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    return locks ? locks.request(`clipjs-project:${projectId}`, {mode: 'exclusive'}, task) : task();
};

export const storeProject = async (project: ProjectState, options: {expectedRevision?: number} = {}) => {
    if (typeof window === 'undefined') throw new Error('Project storage is only available in the browser.');
    try {
        if (!project.id || !project.projectName) {
            throw new Error('Project id and name are required.');
        }
        return await withProjectWriteLock(project.id, async () => {
            const db = await setupDB();
            if (!db) throw new Error('Project database is unavailable.');
            const candidate = parseProjectState(project);
            const transaction = db.transaction('projects', 'readwrite');
            const existing = await transaction.store.get(candidate.id) as ProjectState | undefined;
            const actualRevision = existing?.revision ?? 0;
            const conflict = options.expectedRevision !== undefined && actualRevision !== options.expectedRevision
                ? new ProjectRevisionConflictError(options.expectedRevision, actualRevision)
                : existing && candidate.revision < actualRevision
                    ? new ProjectRevisionConflictError(candidate.revision, actualRevision)
                    : undefined;
            if (conflict) {
                transaction.abort();
                await transaction.done.catch(() => undefined);
                throw conflict;
            }
            await transaction.store.put(candidate);
            await transaction.done;
            return candidate.id;
        });
    } catch (error) {
        toast.error('Error storing project');
        console.error('Error storing project:', error);
        throw error;
    }
};

export const commitProjectMutation = async (
    projectId: string,
    expectedRevision: number,
    mutate: (current: ProjectState) => ProjectState | Promise<ProjectState>,
): Promise<ProjectState> => {
    if (typeof window === 'undefined') throw new Error('Project storage is only available in the browser.');
    return withProjectWriteLock(projectId, async () => {
        const db = await setupDB();
        if (!db) throw new Error('Project database is unavailable.');
        const transaction = db.transaction('projects', 'readwrite');
        const raw = await transaction.store.get(projectId);
        if (!raw) {
            transaction.abort();
            await transaction.done.catch(() => undefined);
            throw new Error('Project not found.');
        }
        const current = parseProjectState(raw);
        if (current.revision !== expectedRevision) {
            transaction.abort();
            await transaction.done.catch(() => undefined);
            throw new ProjectRevisionConflictError(expectedRevision, current.revision);
        }
        const mutated = await mutate(structuredClone(current));
        if (mutated.id !== projectId) {
            transaction.abort();
            await transaction.done.catch(() => undefined);
            throw new Error('Project mutation cannot change project identity.');
        }
        const candidate = parseProjectState({...mutated, revision: current.revision + 1, projectSchemaVersion: 3});
        await transaction.store.put(candidate);
        await transaction.done;
        return candidate;
    });
};

export const getProject = async (projectId: string) => {
    if (typeof window === 'undefined') throw new Error('Project storage is only available in the browser.');
    try {
        const db = await setupDB();
        if (!db) throw new Error('Project database is unavailable.');
        const project = await db.get('projects', projectId);
        if (!project) return undefined;
        await backupLegacyProject(db, project);
        return parseProjectState(project);
    } catch (error) {
        toast.error('Error retrieving project');
        console.error('Error retrieving project:', error);
        throw error;
    }
};

export const deleteProject = async (projectId: string) => {
    if (typeof window === 'undefined') throw new Error('Project storage is only available in the browser.');
    try {
        const db = await setupDB();
        if (!db) throw new Error('Project database is unavailable.');
        await db.delete('projects', projectId);
    } catch (error) {
        toast.error('Error deleting project');
        console.error('Error deleting project:', error);
        throw error;
    }
};

export const listProjects = async () => {
    if (typeof window === 'undefined') throw new Error('Project storage is only available in the browser.');
    try {
        const db = await setupDB();
        if (!db) throw new Error('Project database is unavailable.');
        const projects = await db.getAll('projects');
        return Promise.all(projects.map(async (project) => {
            await backupLegacyProject(db, project);
            return parseProjectState(project);
        }));
    } catch (error) {
        console.error('Error listing projects:', error);
        throw error;
    }
};

export const store = configureStore({
    reducer: {
        projectState: projectStateReducer,
        projects: projectsReducer,
    },
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: false,
        }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch = () => useDispatch<AppDispatch>();
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector; 