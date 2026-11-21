/**
 * Uppercase section heading above a card group.
 *
 * A heading role is what lets a screen-reader user jump between sections
 * instead of swiping through every row to learn the structure. The same label
 * used to be copy-pasted into six screens with slightly different margins.
 */
import type { ReactElement } from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { StyleSheet, Text } from 'react-native';

import { useTheme } from '../../theme/ThemeContext';

interface SectionLabelProps {
  /** Heading text, shown uppercase by the JSX caller. */
  children: string;
  /** Extra spacing for the screen's layout. */
  style?: StyleProp<TextStyle>;
}

/**
 * Renders a section heading.
 * @param props - The heading text and optional layout style.
 * @returns The heading element.
 */
export function SectionLabel({ children, style }: Readonly<SectionLabelProps>): ReactElement {
  const theme = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[theme.typography.caption, styles.label, { color: theme.colors.textSubtle }, style]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: { letterSpacing: 0.6 },
});
