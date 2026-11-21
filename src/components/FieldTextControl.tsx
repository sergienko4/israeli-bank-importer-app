/**
 * The free-text, numeric, and secret control used by {@link FieldInput}.
 *
 * Kept in its own file so the numeric draft state machine (which must preserve
 * intermediate text such as "42." and "-") stays separate from the field row's
 * layout and stays small enough to review on its own.
 */
import { type ReactElement, useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, TextInput, View } from 'react-native';

import type { FieldDef } from '../api/manifest';
import { useAnnounceOnChange } from '../lib/useAnnounce';
import type { Theme } from '../theme/ThemeContext';
import { useTheme } from '../theme/ThemeContext';

type ParsedNumberFieldText = { kind: 'valid'; value: number | undefined } | { kind: 'invalid' };

/**
 * Parses numeric config input without allowing NaN or infinite values.
 * @param text - Raw text from the numeric input.
 * @returns A valid parsed value, undefined for empty input, or invalid.
 */
export function parseNumberFieldText(text: string): ParsedNumberFieldText {
  if (text.trim() === '') {
    return { kind: 'valid', value: undefined };
  }

  // A comma-decimal keyboard produces "42,5"; treat it as the same number.
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) ? { kind: 'valid', value } : { kind: 'invalid' };
}

function stringifyTextInputValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'symbol') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => stringifyTextInputValue(item)).join(',');
  }

  if (value instanceof Date) {
    return value.toString();
  }

  return Object.prototype.toString.call(value);
}

/** The inline message for a numeric field that cannot be parsed. */
const NUMBER_ERROR = 'Enter a number, like 42.5.';

/**
 * Picks the input's border for its current state.
 * @param theme - The active theme.
 * @param invalid - Whether the draft cannot be parsed.
 * @param focused - Whether the input has focus.
 * @returns The border colour.
 */
function inputBorder(theme: Theme, invalid: boolean, focused: boolean): string {
  if (invalid) {
    return theme.colors.danger;
  }
  return focused ? theme.colors.primary : theme.colors.borderStrong;
}

interface TextControlProps {
  field: FieldDef;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Reports numeric validity to the editor that owns Save and Back. */
  onValidityChange?: (key: string, valid: boolean) => void;
  /** Stable key this field reports its validity under. */
  validityKey?: string;
}

/**
 * Renders a themed text/number/secret input with a focus ring.
 * @param props - The field, current value, change handler, and validity wiring.
 * @returns The input element.
 */
export function TextControl({
  field,
  value,
  onChange,
  onValidityChange,
  validityKey,
}: Readonly<TextControlProps>): ReactElement {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() => stringifyTextInputValue(value));
  const [invalid, setInvalid] = useState(false);
  const isNumber = field.kind === 'number';
  const label = field.required ? `${field.label}, required` : field.label;
  useAnnounceOnChange(invalid ? NUMBER_ERROR : null);
  // While blurred, the committed value wins, so a parent reset or a list
  // reorder cannot leave another field's text in the input.
  const text = focused || invalid ? draft : stringifyTextInputValue(value);

  const report = (valid: boolean): void => {
    if (validityKey !== undefined) {
      onValidityChange?.(validityKey, valid);
    }
  };

  useEffect(
    () => () => {
      // A removed field must not leave the editor blocked on its stale error.
      if (validityKey !== undefined) {
        onValidityChange?.(validityKey, true);
      }
    },
    [onValidityChange, validityKey],
  );

  const handleChange = (next: string): void => {
    setDraft(next);
    if (!isNumber) {
      onChange(next);
      return;
    }
    const parsed = parseNumberFieldText(next);
    setInvalid(parsed.kind === 'invalid');
    report(parsed.kind === 'valid');
    if (parsed.kind === 'valid') {
      onChange(parsed.value);
    }
  };

  return (
    <View>
      <TextInput
        style={[
          styles.input,
          {
            borderColor: inputBorder(theme, invalid, focused),
            borderWidth: focused ? 2 : 1,
            backgroundColor: theme.colors.surface,
            color: theme.colors.text,
            borderRadius: theme.radius.md,
          },
        ]}
        keyboardType={isNumber ? 'decimal-pad' : 'default'}
        secureTextEntry={field.kind === 'secret'}
        accessibilityLabel={label}
        accessibilityHint={field.help}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={theme.colors.textSubtle}
        value={text}
        onChangeText={handleChange}
        onFocus={() => {
          setFocused(true);
          setDraft(stringifyTextInputValue(value));
          setInvalid(false);
          report(true);
        }}
        onBlur={() => {
          setFocused(false);
          if (invalid) {
            // Invalid text never becomes a hidden draft: show the committed
            // value again and say so, so Back/Save cannot silently keep it.
            setDraft(stringifyTextInputValue(value));
            setInvalid(false);
            report(true);
            AccessibilityInfo.announceForAccessibility(
              'Invalid number. The previous value was kept.',
            );
          }
        }}
      />
      {invalid ? (
        <Text style={[styles.fieldError, { color: theme.colors.danger }]}>{NUMBER_ERROR}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fieldError: { fontSize: 12, marginTop: 6 },
  input: { minHeight: 44, padding: 12, fontSize: 16 },
});
