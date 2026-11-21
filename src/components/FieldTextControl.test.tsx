import { fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import type { FieldDef } from '../api/manifest';
import { ThemeProvider } from '../theme/ThemeContext';
import { FieldInput } from './FieldInput';

const NUMBER_FIELD: FieldDef = { key: 'rate', label: 'Rate', kind: 'number' };
const NUMBER_ERROR = 'Enter a number, like 42.5.';

/**
 * Renders one numeric field with spies for its two callbacks.
 * @param value - The committed value to show.
 * @returns The callbacks and the input element.
 */
async function setup(value: unknown = 42): Promise<{
  onChange: jest.Mock;
  onValidityChange: jest.Mock;
  input: ReturnType<typeof screen.getByLabelText>;
}> {
  const onChange = jest.fn();
  const onValidityChange = jest.fn();
  await render(
    <ThemeProvider>
      <FieldInput
        field={NUMBER_FIELD}
        value={value}
        onChange={onChange}
        onValidityChange={onValidityChange}
        validityKey="rate"
      />
    </ThemeProvider>,
  );
  const input = screen.getByLabelText('Rate');
  await fireEvent(input, 'focus');
  return { onChange, onValidityChange, input };
}

describe('numeric FieldInput', () => {
  beforeEach(() => {
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
    jest
      .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps a trailing decimal point while typing', async () => {
    const { onChange, input } = await setup();

    await fireEvent.changeText(input, '42.');

    expect(onChange).toHaveBeenLastCalledWith(42);
    expect(screen.getByDisplayValue('42.')).toBeTruthy();
  });

  it('keeps a sign without showing an error before the digits arrive', async () => {
    const { onChange, onValidityChange, input } = await setup();

    await fireEvent.changeText(input, '-');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText(NUMBER_ERROR)).toBeNull();
    expect(onValidityChange).toHaveBeenLastCalledWith('rate', false);

    await fireEvent.changeText(input, '-5');
    expect(onChange).toHaveBeenLastCalledWith(-5);
  });

  it('keeps invalid text visible after blur', async () => {
    const { input } = await setup();

    await fireEvent.changeText(input, 'abc');
    expect(screen.getByText(NUMBER_ERROR)).toBeTruthy();

    await fireEvent(input, 'blur');
    expect(screen.getByDisplayValue('abc')).toBeTruthy();
    expect(screen.getByText(NUMBER_ERROR)).toBeTruthy();
  });

  it('rejects grouped thousands instead of saving 1', async () => {
    const { onChange, input } = await setup();

    await fireEvent.changeText(input, '1,000');

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(NUMBER_ERROR)).toBeTruthy();
  });
});
