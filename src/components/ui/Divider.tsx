/**
 * Hairline separator drawn in the theme border color.
 */
import { View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '../../theme/ThemeContext';

/**
 * Renders a 1px divider.
 * @param props - Optional style override.
 * @returns The divider element.
 */
export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return <View style={[{ height: 1, backgroundColor: theme.colors.border }, style]} />;
}
