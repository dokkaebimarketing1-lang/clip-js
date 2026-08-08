import {describe, expect, it} from 'vitest';
import {
  BROWSER_STARTUP_ALLOWANCE_MS,
  COMPOSITION_TIMEOUT_MS,
  RENDER_HARD_TIMEOUT_MS,
  RENDER_ROUTE_MAX_DURATION_MS,
  ROUTE_OVERHEAD_RESERVE_MS,
  STAGING_TIMEOUT_MS,
} from './render-budget';

describe('render route budget', () => {
  it('reserves route time beyond staging, browser startup, composition, and rendering', () => {
    const boundedWorkMs = STAGING_TIMEOUT_MS
      + BROWSER_STARTUP_ALLOWANCE_MS
      + COMPOSITION_TIMEOUT_MS
      + RENDER_HARD_TIMEOUT_MS;

    expect(boundedWorkMs).toBeLessThanOrEqual(
      RENDER_ROUTE_MAX_DURATION_MS - ROUTE_OVERHEAD_RESERVE_MS,
    );
  });
});
