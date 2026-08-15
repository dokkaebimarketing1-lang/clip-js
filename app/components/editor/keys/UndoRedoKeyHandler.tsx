'use client';

import {useEffect, useState} from 'react';
import {useDispatch} from 'react-redux';
import {redo, undo} from '@/app/store/slices/projectSlice';

const UndoRedoKeyHandler = () => {
    const dispatch = useDispatch();
    const [hasInteracted, setHasInteracted] = useState(false);

    useEffect(() => {
        const handleClick = () => setHasInteracted(true);
        window.addEventListener('click', handleClick, {once: true});
        return () => window.removeEventListener('click', handleClick);
    }, []);

    useEffect(() => {
        if (!hasInteracted) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target;
            const isTyping = target instanceof HTMLElement && (
                target.tagName === 'INPUT'
                || target.tagName === 'TEXTAREA'
                || target.isContentEditable
            );
            if (isTyping) return;

            const commandKey = event.ctrlKey || event.metaKey;
            if (commandKey && event.code === 'KeyZ') {
                event.preventDefault();
                dispatch(event.shiftKey ? redo() : undo());
                return;
            }
            if (commandKey && event.code === 'KeyY') {
                event.preventDefault();
                dispatch(redo());
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [dispatch, hasInteracted]);

    return null;
};

export default UndoRedoKeyHandler;
