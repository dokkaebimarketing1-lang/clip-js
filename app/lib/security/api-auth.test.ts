import {afterEach, describe, expect, it} from 'vitest';
import {NextRequest} from 'next/server';
import {authorizeAgentRequest, authorizeApprovalRequest, createRenderDownloadToken} from './api-auth';

const savedAgent = process.env.CLIPJS_AGENT_TOKEN;
const savedApproval = process.env.CLIPJS_APPROVAL_TOKEN;
const savedInsecure = process.env.CLIPJS_ALLOW_INSECURE_LOCALHOST;
const savedDownload = process.env.CLIPJS_RENDER_DOWNLOAD_SECRET;

const restore = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

afterEach(() => {
  restore('CLIPJS_AGENT_TOKEN', savedAgent);
  restore('CLIPJS_APPROVAL_TOKEN', savedApproval);
  restore('CLIPJS_ALLOW_INSECURE_LOCALHOST', savedInsecure);
  restore('CLIPJS_RENDER_DOWNLOAD_SECRET', savedDownload);
});

describe('API authentication defaults', () => {
  it('fails closed when tokens are missing', () => {
    delete process.env.CLIPJS_AGENT_TOKEN;
    delete process.env.CLIPJS_APPROVAL_TOKEN;
    delete process.env.CLIPJS_ALLOW_INSECURE_LOCALHOST;
    const request = new NextRequest('http://localhost:3000/api/render');
    expect(() => authorizeAgentRequest(request)).toThrow('CLIPJS_AGENT_TOKEN');
    expect(() => authorizeApprovalRequest(request)).toThrow('CLIPJS_APPROVAL_TOKEN');
  });

  it('never trusts a spoofable localhost request URL when tokens are missing', () => {
    delete process.env.CLIPJS_AGENT_TOKEN;
    delete process.env.CLIPJS_APPROVAL_TOKEN;
    process.env.CLIPJS_ALLOW_INSECURE_LOCALHOST = 'true';
    const local = new NextRequest('http://127.0.0.1:3000/api/render');
    expect(() => authorizeAgentRequest(local)).toThrow('CLIPJS_AGENT_TOKEN');
    expect(() => authorizeApprovalRequest(local)).toThrow('CLIPJS_APPROVAL_TOKEN');
    const remote = new NextRequest('http://clipjs.example/api/render');
    expect(() => authorizeAgentRequest(remote)).toThrow('CLIPJS_AGENT_TOKEN');
  });

  it('requires a download-signing secret distinct from the agent credential', () => {
    process.env.CLIPJS_AGENT_TOKEN = 'agent-only';
    delete process.env.CLIPJS_RENDER_DOWNLOAD_SECRET;
    expect(() => createRenderDownloadToken('render-id')).toThrow('CLIPJS_RENDER_DOWNLOAD_SECRET');
  });
});
