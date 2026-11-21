import { runConfigSave } from './configSave';
import { RequestTimeoutError } from './requestTimeout';

/**
 * Builds ports whose every side effect is a spy.
 * @param save - The save request to run.
 * @returns The ports and their spies.
 */
function portsOf(save: () => Promise<{ ok: boolean; error?: string; errors?: string[] }>) {
  const setSaving = jest.fn();
  const setErrors = jest.fn();
  const onSuccess = jest.fn();
  const onFailure = jest.fn();
  return {
    ports: { save, setSaving, setErrors, onSuccess, onFailure },
    setSaving,
    setErrors,
    onSuccess,
    onFailure,
  };
}

describe('runConfigSave', () => {
  it('clears the busy state after a successful save', async () => {
    const spies = portsOf(() => Promise.resolve({ ok: true }));

    await runConfigSave(spies.ports);

    expect(spies.setSaving.mock.calls).toEqual([[true], [false]]);
    expect(spies.setErrors.mock.calls).toEqual([[null]]);
    expect(spies.onSuccess).toHaveBeenCalledTimes(1);
    expect(spies.onFailure).not.toHaveBeenCalled();
  });

  it('shows the importer validation errors and clears the busy state', async () => {
    const spies = portsOf(() => Promise.resolve({ ok: false, errors: ['bad field'] }));

    await runConfigSave(spies.ports);

    expect(spies.setSaving.mock.calls).toEqual([[true], [false]]);
    expect(spies.setErrors.mock.calls).toEqual([[null], [['bad field']]]);
    expect(spies.onSuccess).not.toHaveBeenCalled();
    expect(spies.onFailure).toHaveBeenCalledTimes(1);
  });

  it('shows the timeout and clears the busy state when the request never answers', async () => {
    const spies = portsOf(() => Promise.reject(new RequestTimeoutError()));

    await runConfigSave(spies.ports);

    expect(spies.setSaving.mock.calls).toEqual([[true], [false]]);
    expect(spies.setErrors.mock.calls).toEqual([
      [null],
      [['The importer took too long to answer. Try again.']],
    ]);
    expect(spies.onSuccess).not.toHaveBeenCalled();
    expect(spies.onFailure).toHaveBeenCalledTimes(1);
  });

  it('falls back to the unreachable message for a failure without wording', async () => {
    const spies = portsOf(() => Promise.reject(new Error('')));

    await runConfigSave(spies.ports);

    expect(spies.setSaving.mock.calls).toEqual([[true], [false]]);
    expect(spies.setErrors).toHaveBeenLastCalledWith([
      'Could not reach the importer. Check that it is running and try again.',
    ]);
  });
});
