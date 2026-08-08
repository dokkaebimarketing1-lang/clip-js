/* initialState JSON 덤프 — clip-js 에이전트 API 시퀀스용 */
import {writeFileSync} from 'fs';
import {readFileSync} from 'fs';
import {initialState} from '../app/store/slices/projectSlice';

const p = structuredClone(initialState);
p.id = 'tiger-caption-project';
p.projectName = '호랑이 카페 CF — 캡션 테스트';
const storyboard = JSON.parse(readFileSync('D:/비디오자동화/사주카페-호랑이-30s.storyboard.json', 'utf-8'));
p.workflow = {...p.workflow, storyboard};
writeFileSync('D:/비디오자동화/clip-js/scripts/initial-project.json', JSON.stringify(p, null, 2));
console.log('initial project dumped:', Object.keys(p).join(','));
