import { colors } from './colors';
import { radius } from './radius';
import { shadows } from './shadows';

export const componentStyles = {
  card: {
    bg: colors.neutral.surface,
    border: `1px solid ${colors.neutral.border}`,
    radius: radius['2xl'],
    shadow: shadows.md,
  },
  actionCard: {
    radius: radius.xl,
    borderWidth: '1px',
    padding: '16px',
  },
  buttonPrimary: {
    bg: colors.brand.primary,
    text: colors.neutral.textWhite,
    radius: radius.md,
    height: '44px',
  },
  badge: {
    radius: radius.full,
    padding: '4px 12px',
    fontSize: '12px',
    fontWeight: '600',
  },
} as const;
