import {describe, expect, it, vi} from 'vitest';

vi.mock('server-only', () => ({}));

import {signStoryboardApproval, verifyStoryboardApprovalSignature} from './approval-signature';

const baseApproval = {
  status: 'approved' as const,
  storyboardHash: 'a'.repeat(64),
  productionHash: 'b'.repeat(64),
  approvedAt: '2026-01-01T00:00:00Z',
  approvedBy: 'owner',
};

describe('storyboard approval signature', () => {
  it('round-trips a server-signed approval for the exact project', () => {
    const signed = signStoryboardApproval('project-1', baseApproval);
    expect(signed.signature).toMatch(/^[a-f0-9]{64}$/);
    expect(() => verifyStoryboardApprovalSignature('project-1', signed)).not.toThrow();
  });

  it('rejects a signature verified against a different project', () => {
    const signed = signStoryboardApproval('project-1', baseApproval);
    expect(() => verifyStoryboardApprovalSignature('project-2', signed)).toThrow('invalid');
  });

  it('rejects tampered storyboard, production, or approval metadata', () => {
    const signed = signStoryboardApproval('project-1', baseApproval);
    expect(() => verifyStoryboardApprovalSignature('project-1', {...signed, storyboardHash: 'c'.repeat(64)})).toThrow('invalid');
    expect(() => verifyStoryboardApprovalSignature('project-1', {...signed, productionHash: 'd'.repeat(64)})).toThrow('invalid');
    expect(() => verifyStoryboardApprovalSignature('project-1', {...signed, approvedBy: 'attacker'})).toThrow('invalid');
    expect(() => verifyStoryboardApprovalSignature('project-1', {...signed, approvedAt: '2027-01-01T00:00:00Z'})).toThrow('invalid');
  });

  it('fails closed for unsigned or non-approved records', () => {
    expect(() => verifyStoryboardApprovalSignature('project-1', {...baseApproval, status: 'draft' as const})).toThrow('not server-signed');
    expect(() => verifyStoryboardApprovalSignature('project-1', {...baseApproval, signature: 'forged'})).toThrow('invalid');
  });
});
