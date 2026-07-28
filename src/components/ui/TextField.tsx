/**
 * Labeled text input with a focus ring, optional leading icon, help text,
 * inline error state, and a show/hide toggle for secure entry. Themed to match
 * the rest of the app.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import {
  Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { KeyboardTypeOptions, TextInputProps } from 'react-native';

import { useTheme } from '../../theme/ThemeContext';

interface TextFieldProps {
  /** Field label. */
  label?: string;
  /** Current value. */
  value: string;
  /** Change handler. */
  onChangeText: (text: string) => void;
  /** Placeholder text. */
  placeholder?: string;
  /** Render as a password field with a reveal toggle. */
  secure?: boolean;
  /** Inline error message; also turns the border red. */
  error?: string | null;
  /** Help text shown under the field. */
  help?: string;
  /** Optional leading Ionicons glyph. */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Keyboard type. */
  keyboardType?: KeyboardTypeOptions;
  /** Auto-capitalization. Default `none`. */
  autoCapitalize?: TextInputProps['autoCapitalize'];
  /** Autofill hint for the OS/password manager. */
  autoComplete?: TextInputProps['autoComplete'];
  /** iOS content type for autofill (e.g. `password`, `URL`). */
  textContentType?: TextInputProps['textContentType'];
}

/**
 * Renders a labeled, themed text input.
 * @param props - Field configuration.
 * @returns The field element.
 */
export function TextField({
  label, value, onChangeText, placeholder, secure = false,
  error, help, icon, keyboardType, autoCapitalize = 'none', autoComplete, textContentType,
}: TextFieldProps) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const borderColor = error ? theme.colors.danger : focused ? theme.colors.primary : theme.colors.border;

  return (
    <View style={styles.root}>
      {label ? (
        <Text style={[theme.typography.caption, styles.label, { color: theme.colors.textMuted }]}>{label}</Text>
      ) : null}
      <View
        style={[
          styles.field,
          {
            borderColor,
            borderWidth: focused ? 2 : 1,
            backgroundColor: theme.colors.surface,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.spacing.md,
            paddingVertical: focused ? theme.spacing.md - 1 : theme.spacing.md,
          },
        ]}
      >
        {icon ? <Ionicons name={icon} size={18} color={theme.colors.textSubtle} style={styles.leading} /> : null}
        <TextInput
          style={[styles.input, { color: theme.colors.text }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textSubtle}
          secureTextEntry={secure && !revealed}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          textContentType={textContentType}
          autoCorrect={false}
          onFocus={() => { setFocused(true); }}
          onBlur={() => { setFocused(false); }}
        />
        {secure ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
            onPress={() => { setRevealed((prev) => !prev); }}
            style={styles.reveal}
          >
            <Ionicons name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.colors.textSubtle} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={[theme.typography.small, { color: theme.colors.danger, marginTop: 6 }]}>{error}</Text>
      ) : help ? (
        <Text style={[theme.typography.small, { color: theme.colors.textSubtle, marginTop: 6 }]}>{help}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginBottom: 4 },
  label: { marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  leading: { marginRight: 2 },
  input: { flex: 1, fontSize: 16, padding: 0 },
  reveal: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
});
