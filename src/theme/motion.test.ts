import { durations, motionDuration, staggerDelay } from './motion';

describe('motionDuration', () => {
  it('returns the intended duration when motion is allowed', () => {
    expect(motionDuration(durations.slow, false)).toBe(durations.slow);
  });

  it('collapses to zero when reduced motion is enabled', () => {
    expect(motionDuration(durations.slow, true)).toBe(0);
    expect(motionDuration(durations.base, true)).toBe(durations.instant);
  });
});

describe('staggerDelay', () => {
  it('scales the delay by the item index when motion is allowed', () => {
    expect(staggerDelay(0, false)).toBe(0);
    expect(staggerDelay(3, false)).toBeGreaterThan(staggerDelay(1, false));
  });

  it('caps the stagger so long lists do not delay indefinitely', () => {
    expect(staggerDelay(50, false)).toBe(staggerDelay(10, false));
  });

  it('collapses to zero when reduced motion is enabled', () => {
    expect(staggerDelay(5, true)).toBe(0);
  });
});
