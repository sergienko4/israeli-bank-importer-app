import { type OtaSignals, resolveOtaState, resolveUpdatePrompt } from './otaUpdate';

function signals(overrides: Partial<OtaSignals> = {}): OtaSignals {
  return {
    isEnabled: true,
    isDownloading: false,
    isUpdatePending: false,
    isRestarting: false,
    ...overrides,
  };
}

describe('resolveOtaState', () => {
  it('reports disabled in development builds and Expo Go', () => {
    expect(resolveOtaState(signals({ isEnabled: false, isUpdatePending: true }))).toBe('disabled');
  });

  it('reports restarting while the app reloads into the new bundle', () => {
    expect(resolveOtaState(signals({ isRestarting: true, isUpdatePending: true }))).toBe(
      'restarting',
    );
  });

  it('reports ready once a downloaded update waits for a restart', () => {
    expect(resolveOtaState(signals({ isUpdatePending: true }))).toBe('ready');
  });

  it('prefers ready over downloading when a later download already started', () => {
    expect(resolveOtaState(signals({ isUpdatePending: true, isDownloading: true }))).toBe('ready');
  });

  it('reports downloading while the bundle is still being fetched', () => {
    expect(resolveOtaState(signals({ isDownloading: true }))).toBe('downloading');
  });

  it('reports idle when there is nothing to apply', () => {
    expect(resolveOtaState(signals())).toBe('idle');
  });
});

describe('resolveUpdatePrompt', () => {
  it('asks for a restart when an update is ready', () => {
    expect(resolveUpdatePrompt('ready', false)).toBe('restart');
  });

  it('prefers the restart prompt over a newer downloadable build', () => {
    expect(resolveUpdatePrompt('ready', true)).toBe('restart');
  });

  it('offers the download when updates are idle and a newer build exists', () => {
    expect(resolveUpdatePrompt('idle', true)).toBe('download');
  });

  it('offers the download in development builds, where updates never arrive', () => {
    expect(resolveUpdatePrompt('disabled', true)).toBe('download');
  });

  it('stays quiet while an update is downloading', () => {
    expect(resolveUpdatePrompt('downloading', true)).toBe('none');
  });

  it('stays quiet while the app is restarting', () => {
    expect(resolveUpdatePrompt('restarting', true)).toBe('none');
  });

  it('stays quiet when nothing newer is published', () => {
    expect(resolveUpdatePrompt('idle', false)).toBe('none');
  });
});
