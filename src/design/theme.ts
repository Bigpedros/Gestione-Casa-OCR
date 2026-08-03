import { colors } from './colors';
import { spacing, layoutSpacing } from './spacing';
import { typography } from './typography';
import { radius } from './radius';
import { shadows } from './shadows';
import { breakpoints } from './breakpoints';
import { componentStyles } from './components';

export const theme = {
  colors,
  spacing,
  layoutSpacing,
  typography,
  radius,
  shadows,
  breakpoints,
  components: componentStyles,
} as const;

export type Theme = typeof theme;
