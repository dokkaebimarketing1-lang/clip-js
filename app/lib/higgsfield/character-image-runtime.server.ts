import {createRedisCharacterImageSubmissionRepository} from './character-image-submission-redis-repository.server';
import {createFilesystemCharacterImageSubmissionRepository} from './character-image-submission-repository.server';
import {resolve} from 'node:path';

export const getCharacterImageSubmissionRepository = () => process.env.NODE_ENV === 'production'
  ? createRedisCharacterImageSubmissionRepository()
  : createFilesystemCharacterImageSubmissionRepository({
    rootDirectory: resolve(/*turbopackIgnore: true*/ process.env.CLIPJS_CHARACTER_IMAGE_REPOSITORY_DIR || '.clipjs-runtime/character-image-submissions'),
  });

export const isCharacterImageWorkerMode = () => process.env.NODE_ENV === 'production'
  || process.env.CLIPJS_HIGGSFIELD_WORKER_MODE === 'true';
