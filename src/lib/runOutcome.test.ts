import { runTone } from './runOutcome';

describe('runTone', () => {
  it('treats a run with no banks as neither success nor failure', () => {
    expect(runTone(0, 0)).toBe('neutral');
  });

  it('treats a negative count as empty rather than successful', () => {
    expect(runTone(-1, 0)).toBe('neutral');
  });

  it('reports a clean run as success', () => {
    expect(runTone(3, 3)).toBe('success');
  });

  it('reports a partial run as a warning', () => {
    expect(runTone(3, 1)).toBe('warning');
  });

  it('reports a run where nothing succeeded as danger', () => {
    expect(runTone(3, 0)).toBe('danger');
  });
});
