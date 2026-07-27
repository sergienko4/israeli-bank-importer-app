/**
 * Design tokens for the app: a single source of truth for color, spacing,
 * radius, and typography. Emerald / fintech-green brand. Screens and UI
 * primitives read these through {@link useTheme} so light/dark and future
 * palette tweaks change in one place.
 */
import type { TextStyle } from 'react-native';

/** The semantic color roles every screen and primitive consumes. */
export interface ThemeColors {
  /** App background (behind cards). */
  bg: string;
  /** Card / elevated surface. */
  surface: string;
  /** Subtle secondary surface (inputs, selected chips background). */
  surfaceAlt: string;
  /** Hairline borders. */
  border: string;
  /** Stronger border (focused inputs, dividers that need weight). */
  borderStrong: string;
  /** Primary body text. */
  text: string;
  /** Secondary text (labels, help). */
  textMuted: string;
  /** Tertiary text (placeholders, captions). */
  textSubtle: string;
  /** Brand color (primary buttons, active states, accents). */
  primary: string;
  /** Brand color when pressed. */
  primaryPressed: string;
  /** Tinted brand background (badges, selected chips, icon bubbles). */
  primarySoft: string;
  /** Text/icon on a primary-filled surface. */
  onPrimary: string;
  /** Positive / success. */
  success: string;
  /** Tinted success background. */
  successSoft: string;
  /** Destructive / error. */
  danger: string;
  /** Tinted danger background. */
  dangerSoft: string;
  /** Text/icon on a danger-filled surface. */
  onDanger: string;
  /** Caution / warning. */
  warning: string;
  /** Scrim behind modals / sticky bars. */
  overlay: string;
}

/** Light theme palette. */
export const lightColors: ThemeColors = {
  bg: '#F3F6F5',
  surface: '#FFFFFF',
  surfaceAlt: '#EDF2F0',
  border: '#E2E8E5',
  borderStrong: '#C9D4CF',
  text: '#0F1F18',
  textMuted: '#566B62',
  textSubtle: '#8A988F',
  primary: '#0E9F6E',
  primaryPressed: '#0B7C57',
  primarySoft: '#E3F5EC',
  onPrimary: '#FFFFFF',
  success: '#0E9F6E',
  successSoft: '#E3F5EC',
  danger: '#DC2626',
  dangerSoft: '#FCEBEB',
  onDanger: '#FFFFFF',
  warning: '#D97706',
  overlay: 'rgba(15, 31, 24, 0.45)',
};

/** Dark theme palette. */
export const darkColors: ThemeColors = {
  bg: '#0A130F',
  surface: '#13201A',
  surfaceAlt: '#1A2A22',
  border: '#25352C',
  borderStrong: '#33473C',
  text: '#ECF3EF',
  textMuted: '#9FB2A8',
  textSubtle: '#6E827A',
  primary: '#2BC48A',
  primaryPressed: '#23A876',
  primarySoft: '#123528',
  onPrimary: '#04130C',
  success: '#2BC48A',
  successSoft: '#123528',
  danger: '#F87171',
  dangerSoft: '#3A1D1D',
  onDanger: '#1A0B0B',
  warning: '#FBBF24',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

/** 4px-based spacing scale. Use these, never raw pixel values. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Corner radii. */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

/** Typographic scale (size + weight + line height per role). */
export const typography = {
  display: { fontSize: 30, fontWeight: '700', lineHeight: 36 },
  h1: { fontSize: 24, fontWeight: '700', lineHeight: 30 },
  h2: { fontSize: 19, fontWeight: '600', lineHeight: 25 },
  h3: { fontSize: 16, fontWeight: '600', lineHeight: 22 },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 23 },
  bodyMedium: { fontSize: 16, fontWeight: '500', lineHeight: 23 },
  small: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
} as const satisfies Record<string, TextStyle>;

/** Spacing scale type. */
export type Spacing = typeof spacing;
/** Radius scale type. */
export type Radius = typeof radius;
/** Typography scale type. */
export type Typography = typeof typography;
