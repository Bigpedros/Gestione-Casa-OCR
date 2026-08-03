import { describe, it, expect } from 'vitest';
import { ROUTES } from '../app/routes';

describe('P-24: Impostazioni quick link in Home Page', () => {
  it('1. Should share the exact route /settings with sidebar navigation', () => {
    expect(ROUTES.SETTINGS).toBe('/settings');
  });
});
