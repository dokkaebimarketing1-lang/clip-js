import {beforeAll, describe, expect, it} from 'vitest';
import {createAssetCapability, verifyAssetCapability} from './asset-capability.server';

beforeAll(() => { process.env.CLIPJS_ASSET_CAPABILITY_SECRET = 'asset-capability-test-secret'; });

describe('generated asset preview capability', () => {
  it('binds project, asset, and expiry', () => {
    const now = new Date('2026-08-11T00:00:00Z');
    const assetId = `ga_${'a'.repeat(32)}`;
    const token = createAssetCapability('project-1', assetId, 60, now);
    expect(() => verifyAssetCapability('project-1', assetId, token, new Date('2026-08-11T00:00:30Z'))).not.toThrow();
    expect(() => verifyAssetCapability('project-2', assetId, token, now)).toThrow(/invalid/i);
    expect(() => verifyAssetCapability('project-1', `ga_${'b'.repeat(32)}`, token, now)).toThrow(/invalid/i);
    expect(() => verifyAssetCapability('project-1', assetId, token, new Date('2026-08-11T00:01:01Z'))).toThrow(/expired/i);
  });
});
