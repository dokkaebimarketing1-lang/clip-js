import {afterEach, describe, expect, it} from 'vitest';
import {NextRequest} from 'next/server';
import {authorizeAgentRequest, authorizeApprovalRequest} from './api-auth';

const savedAgent = process.env.CLIPJS_AGENT_TOKEN;
const savedApproval = process.env.CLIPJS_APPROVAL_TOKEN;
const savedInsecure = process.env.CLIPJS_ALLOW_INSECURE_LOCALHOST;

const restore = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

afterEach(() => {
  restore('CLIPJS_AGENT_TOKEN', savedAgent);
  restore('CLIPJS_APPROVAL_TOKEN', savedApproval);
  restore('CLIPJS_ALLOW_INSECURE_LOCALHOST', savedInsecure);
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

  it('allows an explicit insecure opt-in only on loopback', () => {
    delete process.env.CLIPJS_AGENT_TOKEN;
    delete process.env.CLIPJS_APPROVAL_TOKEN;
    process.env.CLIPJS_ALLOW_INSECURE_LOCALHOST = 'true';
    const local = new NextRequest('http://127.0.0.1:3000/api/render');
    expect(() => authorizeAgentRequest(local)).not.toThrow();
    expect(() => authorizeApprovalRequest(local)).not.toThrow();
    const remote = new NextRequest('http://clipjs.example/api/render');
    expect(() => authorizeAgentRequest(remote)).toThrow('CLIPJS_AGENT_TOKEN');
  });
});
