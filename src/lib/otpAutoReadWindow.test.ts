import type { PendingOtpRequest } from '../api/otp';
import { autoReadWindowDeadline } from './otpAutoReadWindow';

const NOW = 1_700_000_000_000;

function request(id: string, msFromNow: number): PendingOtpRequest {
  return { id, deadline: NOW + msFromNow } as PendingOtpRequest;
}

describe('autoReadWindowDeadline', () => {
  it('is closed when nothing is pending', () => {
    expect(autoReadWindowDeadline([], NOW)).toBeNull();
  });

  it('is closed when every pending request has already expired', () => {
    expect(autoReadWindowDeadline([request('a', -1)], NOW)).toBeNull();
  });

  it('opens until the deadline of a live request', () => {
    expect(autoReadWindowDeadline([request('a', 60_000)], NOW)).toBe(NOW + 60_000);
  });

  it('follows the longest deadline, so no pending request is missed', () => {
    const deadline = autoReadWindowDeadline([request('a', 30_000), request('b', 90_000)], NOW);
    expect(deadline).toBe(NOW + 90_000);
  });

  it('ignores an expired request alongside a live one', () => {
    const deadline = autoReadWindowDeadline([request('a', -5_000), request('b', 30_000)], NOW);
    expect(deadline).toBe(NOW + 30_000);
  });

  it('caps a far-future deadline so a stuck request cannot hold it open', () => {
    const deadline = autoReadWindowDeadline([request('a', 48 * 60 * 60 * 1000)], NOW);
    expect(deadline).toBe(NOW + 10 * 60 * 1000);
  });
});
