/**
 * Covers the gate the drain runs behind.
 *
 * The drain reaches messages that were captured before anything asked for
 * them, so the switches have to be re-read at the moment of use rather than
 * trusted from whenever the capture happened.
 */
import type { StashDrainOutcome } from './otpStashDrain';
import { createSerialDrain, runStashDrain, type StashRunOutcome } from './otpStashRunner';

function ports(
  allowed: boolean,
  outcome: StashDrainOutcome = 'submitted',
): {
  isAllowed: jest.Mock<Promise<boolean>, []>;
  drain: jest.Mock<Promise<StashDrainOutcome>, []>;
} {
  return {
    isAllowed: jest.fn<Promise<boolean>, []>().mockResolvedValue(allowed),
    drain: jest.fn<Promise<StashDrainOutcome>, []>().mockResolvedValue(outcome),
  };
}

describe('runStashDrain', () => {
  it('drains when both switches are on', async () => {
    const p = ports(true);
    await expect(runStashDrain(p)).resolves.toBe('submitted');
    expect(p.drain).toHaveBeenCalledTimes(1);
  });

  it('reports what the drain decided', async () => {
    await expect(runStashDrain(ports(true, 'ambiguous'))).resolves.toBe('ambiguous');
  });

  it('does not look at held messages once a switch is off', async () => {
    const p = ports(false);
    await expect(runStashDrain(p)).resolves.toBe('not-allowed');
    expect(p.drain).not.toHaveBeenCalled();
  });

  it('checks the switches before every drain, not once', async () => {
    // The window is a deadline on disk that outlives the process. Caching this
    // would let a run started before the user changed their mind still submit.
    const p = ports(true);
    await runStashDrain(p);
    await runStashDrain(p);
    expect(p.isAllowed).toHaveBeenCalledTimes(2);
  });

  it('stays quiet when reading the switches fails', async () => {
    // This runs on a poll tick with no screen attached, so there is nowhere to
    // report to and refusing is the safe answer.
    const p = ports(true);
    p.isAllowed.mockRejectedValue(new Error('storage unavailable'));
    await expect(runStashDrain(p)).resolves.toBe('not-allowed');
    expect(p.drain).not.toHaveBeenCalled();
  });
});

describe('createSerialDrain', () => {
  it('runs the drain', async () => {
    const run = jest.fn<Promise<StashRunOutcome>, []>().mockResolvedValue('submitted');
    await expect(createSerialDrain(run)()).resolves.toBe('submitted');
  });

  it('joins a drain already running instead of starting a second', async () => {
    // The poll fires every five seconds and a submit can outlast that. Two
    // drains at once would pick the same held message and spend one of the
    // bank's few attempts on a code it has already been sent.
    let release: (outcome: StashRunOutcome) => void = () => undefined;
    const run = jest.fn<Promise<StashRunOutcome>, []>().mockReturnValue(
      new Promise<StashRunOutcome>((resolve) => {
        release = resolve;
      }),
    );
    const drain = createSerialDrain(run);

    const first = drain();
    const second = drain();
    release('submitted');

    await expect(Promise.all([first, second])).resolves.toEqual(['submitted', 'submitted']);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs again once the previous drain has finished', async () => {
    const run = jest.fn<Promise<StashRunOutcome>, []>().mockResolvedValue('empty');
    const drain = createSerialDrain(run);
    await drain();
    await drain();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('is not left jammed by a drain that threw', async () => {
    // Nothing above catches, so a throw here would otherwise pin the in-flight
    // slot forever and silently stop every later drain.
    const run = jest.fn<Promise<StashRunOutcome>, []>().mockRejectedValueOnce(new Error('boom'));
    const drain = createSerialDrain(run);
    await expect(drain()).rejects.toThrow('boom');
    run.mockResolvedValue('empty');
    await expect(drain()).resolves.toBe('empty');
  });
});
