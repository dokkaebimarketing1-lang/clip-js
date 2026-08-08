'use client';
import { configureStore } from '@reduxjs/toolkit';
import { TypedUseSelectorHook, useDispatch, useSelector } from 'react-redux';
import { openDB } from 'idb';
import projectStateReducer from './slices/projectSlice';
import projectsReducer from './slices/projectsSlice';
import toast from 'react-hot-toast';
import type {ProjectState} from '../types';

// Create IndexedDB database for files and projects
const setupDB = async () => {
    if (typeof window === 'undefined') return null;
    const db = await openDB('clipjs-files', 1, {
        upgrade(db) {
            db.createObjectStore('files', { keyPath: 'id' });
            db.createObjectStore('projects', { keyPath: 'id' });
        },
    });
    return db;
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
export const storeProject = async (project: ProjectState) => {
    if (typeof window === 'undefined') throw new Error('Project storage is only available in the browser.');
    try {
        const db = await setupDB();

        if (!db) throw new Error('Project database is unavailable.');
        if (!project.id || !project.projectName) {
            throw new Error('Project id and name are required.');
        }

        await db.put('projects', project);

        return project.id;
    } catch (error) {
        toast.error('Error storing project');
        console.error('Error storing project:', error);
        throw error;
    }
};

export const getProject = async (projectId: string) => {
    if (typeof window === 'undefined') throw new Error('Project storage is only available in the browser.');
    try {
        const db = await setupDB();
        if (!db) throw new Error('Project database is unavailable.');
        return await db.get('projects', projectId);
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
        return await db.getAll('projects');
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