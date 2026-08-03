/**
 * Covers the flag the native receiver reads before it holds anything.
 *
 * The receiver runs with no JavaScript alive, so it cannot ask whether the user
 * still wants messages held. It reads a flag instead, and this keeps that flag
 * honest.
 */
import { syncStashGate } from './otpStashGate';

function ports(allowed: boolean): {
  isAllowed: jest.Mock<Promise<boolean>, []>;
  setEnabled: jest.Mock<undefined, [boolean]>;
} {
  return {
    isAllowed: jest.fn<Promise<boolean>, []>().mockResolvedValue(allowed),
    setEnabled: jest.fn<undefined, [boolean]>(),
  };
}

describe('syncStashGate', () => {
  it('lets the receiver hold messages while both switches are on', async () => {
    const p = ports(true);
    await expect(syncStashGate(p)).resolves.toBe(true);
    expect(p.setEnabled).toHaveBeenCalledWith(true);
  });

  it('stops the receiver holding messages once a switch is off', async () => {
    const p = ports(false);
    await expect(syncStashGate(p)).resolves.toBe(false);
    expect(p.setEnabled).toHaveBeenCalledWith(false);
  });

  it('stops holding when the switches cannot be read', async () => {
    // A keystore that will not answer must not leave a receiver quietly
    // collecting messages the user may already have said no to.
    const p = ports(true);
    p.isAllowed.mockRejectedValue(new Error('keystore unavailable'));
    await expect(syncStashGate(p)).resolves.toBe(false);
    expect(p.setEnabled).toHaveBeenCalledWith(false);
  });

  it('survives a device with no receiver to tell', async () => {
    const p = ports(true);
    p.setEnabled.mockImplementation(() => {
      throw new Error('no native module');
    });
    await expect(syncStashGate(p)).resolves.toBe(false);
  });
});
