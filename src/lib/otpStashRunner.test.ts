/**
 * Covers the gate the drain runs behind.
 *
 * The drain reaches messages that were captured before anything asked for
 * them, so the switches have to be re-read at the moment of use rather than
 * trusted from whenever the capture happened.
 */
import { TASK_BUDGET_MS } from './otpDeadline';
import type { StashDrainOutcome } from './otpStashDrain';
import {
  createSerialDrain,
  type DrainLease,
  runStashDrain,
  type StashRunOutcome,
} from './otpStashRunner';

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
  const full = (): number => TASK_BUDGET_MS;

  it('runs the drain', async () => {
    const run = jest.fn<Promise<StashRunOutcome>, []>().mockResolvedValue('submitted');
    await expect(createSerialDrain(run)(full)).resolves.toBe('submitted');
  });

  it('never runs two drains at the same time', async () => {
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

    const first = drain(full);
    const second = drain(full);
    expect(run).toHaveBeenCalledTimes(1);

    release('submitted');
    await expect(first).resolves.toBe('submitted');
    await expect(second).resolves.toBe('submitted');
  });

  it('drains once more for a caller that arrived mid-run', async () => {
    // The running drain read the stash before that caller arrived, so a message
    // captured since is not in the list it is working from. On the headless
    // path there is no next poll tick to rescue it: the task runs once and the
    // app is not open.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const outcomes: StashRunOutcome[] = ['empty', 'submitted'];
    const run = jest.fn<Promise<StashRunOutcome>, []>().mockImplementation(async () => {
      if (run.mock.calls.length === 1) await held;
      return outcomes.shift() ?? 'empty';
    });
    const drain = createSerialDrain(run);

    const running = drain(full);
    const waiting = drain(full);
    release();

    await expect(running).resolves.toBe('empty');
    await expect(waiting).resolves.toBe('submitted');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('coalesces every caller that arrived mid-run into one follow-up', async () => {
    let release: (outcome: StashRunOutcome) => void = () => undefined;
    const run = jest.fn<Promise<StashRunOutcome>, []>().mockReturnValue(
      new Promise<StashRunOutcome>((resolve) => {
        release = resolve;
      }),
    );
    const drain = createSerialDrain(run);

    const calls = [drain(full), drain(full), drain(full), drain(full)];
    release('empty');

    await Promise.all(calls);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs again once the previous drain has finished', async () => {
    const run = jest.fn<Promise<StashRunOutcome>, []>().mockResolvedValue('empty');
    const drain = createSerialDrain(run);
    await drain(full);
    await drain(full);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('is not left jammed by a drain that threw', async () => {
    // Nothing above catches, so a throw here would otherwise pin the in-flight
    // slot forever and silently stop every later drain.
    const run = jest.fn<Promise<StashRunOutcome>, []>().mockRejectedValueOnce(new Error('boom'));
    const drain = createSerialDrain(run);
    await expect(drain(full)).rejects.toThrow('boom');
    run.mockResolvedValue('empty');
    await expect(drain(full)).resolves.toBe('empty');
  });

  it('is not left jammed by a drain that never answers', async () => {
    // Nothing underneath the drain has a deadline of its own, so an importer
    // that accepts the connection and then says nothing would otherwise pin the
    // slot for the life of the process — quietly stopping every later poll tick
    // and every later wake-up from draining anything at all.
    jest.useFakeTimers();
    try {
      const run = jest
        .fn<Promise<StashRunOutcome>, []>()
        .mockReturnValueOnce(new Promise<StashRunOutcome>(() => undefined))
        .mockResolvedValue('empty');
      const drain = createSerialDrain(run);

      void drain(full);
      await jest.advanceTimersByTimeAsync(TASK_BUDGET_MS);

      await expect(drain(full)).resolves.toBe('empty');
      expect(run).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('lets a caller that arrived mid-run stop waiting for one that hangs', async () => {
    // That caller is usually the wake-up itself, which has a budget to keep.
    jest.useFakeTimers();
    try {
      const run = jest
        .fn<Promise<StashRunOutcome>, []>()
        .mockReturnValueOnce(new Promise<StashRunOutcome>(() => undefined))
        .mockResolvedValue('submitted');
      const drain = createSerialDrain(run);

      void drain(full);
      const waiting = drain(full);
      await jest.advanceTimersByTimeAsync(TASK_BUDGET_MS);

      await expect(waiting).resolves.toBe('submitted');
    } finally {
      jest.useRealTimers();
    }
  });

  it('tells a hung run it no longer owns the drain once its replacement starts', async () => {
    // The hung run read the stash before its replacement existed, so its list
    // is stale. Without this it would resume and offer a code the newer run may
    // already have sent — trading a drain that dies for the life of the process
    // against the same code going to the bank twice.
    jest.useFakeTimers();
    try {
      const leases: DrainLease[] = [];
      const run = jest
        .fn<Promise<StashRunOutcome>, [DrainLease]>()
        .mockImplementationOnce((lease) => {
          leases.push(lease);
          return new Promise<StashRunOutcome>(() => undefined);
        })
        .mockImplementation((lease) => {
          leases.push(lease);
          return Promise.resolve('empty');
        });
      const drain = createSerialDrain(run);

      void drain(full);
      expect(leases[0]?.stillOwned()).toBe(true);
      expect(leases[0]?.remainingMs()).toBe(TASK_BUDGET_MS);
      await jest.advanceTimersByTimeAsync(TASK_BUDGET_MS);
      await drain(full);

      expect(leases[0]?.stillOwned()).toBe(false);
      expect(leases[0]?.remainingMs()).toBeLessThanOrEqual(0);
      expect(leases[1]?.stillOwned()).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('leases no longer than the caller has left', async () => {
    // The lease bounds the send, and the send has to finish recording what it
    // did while the caller is still alive to let it. A caller most of the way
    // through its own budget that handed out a full lease would be promising
    // time it does not have, and the acknowledgement would be the thing lost.
    const leases: DrainLease[] = [];
    const run = jest.fn<Promise<StashRunOutcome>, [DrainLease]>().mockImplementation((lease) => {
      leases.push(lease);
      return Promise.resolve('empty');
    });

    await createSerialDrain(run)(() => 4_000);

    expect(leases[0]?.remainingMs()).toBeLessThanOrEqual(4_000);
  });

  it('leases nothing to a caller with nothing left', async () => {
    const leases: DrainLease[] = [];
    const run = jest.fn<Promise<StashRunOutcome>, [DrainLease]>().mockImplementation((lease) => {
      leases.push(lease);
      return Promise.resolve('empty');
    });

    await createSerialDrain(run)(() => -1_000);

    expect(leases[0]?.remainingMs()).toBeLessThanOrEqual(0);
  });
});
