import 'fake-indexeddb/auto';
import '@testing-library/jest-dom';
import { beforeEach, vi } from 'vitest';
import { db } from '../database/db';

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: vi.fn(),
  }),
}));

beforeEach(async () => {
  await db.delete();
  await db.open();
});

