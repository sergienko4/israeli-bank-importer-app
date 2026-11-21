import { renderHook } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { useAnnounceOnChange } from './useAnnounce';

let androidAnnounce: jest.SpyInstance;
let iosAnnounce: jest.SpyInstance;

/**
 * Returns the spy the current platform's announcement path uses.
 * @returns The announcement spy.
 */
function announceMock(): jest.SpyInstance {
  return Platform.OS === 'ios' ? iosAnnounce : androidAnnounce;
}

describe('useAnnounceOnChange', () => {
  beforeEach(() => {
    androidAnnounce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {
        /* no-op */
      });
    iosAnnounce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
      .mockImplementation(() => {
        /* no-op */
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('announces a new message once', async () => {
    const { rerender } = await renderHook<undefined, { message: string }>(
      ({ message }) => {
        useAnnounceOnChange(message);
      },
      { initialProps: { message: 'Could not save' } },
    );

    await rerender({ message: 'Could not save' });

    expect(announceMock()).toHaveBeenCalledTimes(1);
    if (Platform.OS === 'ios') {
      expect(announceMock()).toHaveBeenCalledWith('Could not save', { queue: true });
    } else {
      expect(announceMock()).toHaveBeenCalledWith('Could not save');
    }
  });

  it('announces the same message again after it clears', async () => {
    const { rerender } = await renderHook<undefined, { message: string | null }>(
      ({ message }) => {
        useAnnounceOnChange(message);
      },
      { initialProps: { message: 'Could not save' } },
    );
    const beforeClear: number = announceMock().mock.calls.length;

    await rerender({ message: null });
    await rerender({ message: 'Could not save' });

    expect(announceMock()).toHaveBeenCalledTimes(beforeClear + 1);
  });
});
