/* initialState JSON 덤프 — clip-js 에이전트 API 시퀀스용 */
import {writeFileSync} from 'fs';
import {readFileSync} from 'fs';
import {resolve} from 'path';
import {initialState} from '../app/store/slices/projectSlice';

const p = structuredClone(initialState);
p.id = 'tiger-caption-project';
p.projectName = '호랑이 카페 CF — 캡션 테스트';
// Keep the generated fixture deterministic unless an operator intentionally overrides it.
p.createdAt = process.env.CLIPJS_FIXTURE_CREATED_AT || '2026-08-08T10:54:51.215Z';
p.lastModified = process.env.CLIPJS_FIXTURE_LAST_MODIFIED || '2026-08-08T10:54:51.216Z';
const storyboardPath = resolve(process.env.CLIPJS_STORYBOARD_PATH || resolve(process.cwd(), '..', '사주카페-호랑이-30s.storyboard.json'));
const outputPath = resolve(process.env.CLIPJS_INITIAL_PROJECT_PATH || resolve(process.cwd(), 'scripts', 'initial-project.json'));
const storyboard = JSON.parse(readFileSync(storyboardPath, 'utf-8'));
p.workflow = {...p.workflow, storyboard};
writeFileSync(outputPath, JSON.stringify(p, null, 2));
console.log('initial project dumped:', Object.keys(p).join(','));
