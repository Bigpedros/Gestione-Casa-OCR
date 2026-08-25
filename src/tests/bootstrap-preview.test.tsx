import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import App from '../App';
import { db } from '../database/db';

describe('App Bootstrap & Full Render Diagnostic Test', () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-palette');
  });

  it('mounts App completely with Real Providers and renders without white screen', async () => {
    const errorLogs: any[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: any[]) => {
      errorLogs.push(args);
      originalConsoleError(...args);
    };

    try {
      render(<App />);

      // Verify header logo and text are rendered
      await waitFor(() => {
        expect(screen.getByText('Gestione Casa')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Verify Home page or initialization loader finishes
      await waitFor(() => {
        expect(screen.getByText(/Riepilogo mensile/i)).toBeInTheDocument();
      }, { timeout: 5000 });

      // Verify theme classes applied to documentElement
      expect(document.documentElement.getAttribute('data-theme')).toBeTruthy();
      expect(document.documentElement.getAttribute('data-palette')).toBeTruthy();
    } finally {
      console.error = originalConsoleError;
    }
  });

  it('mounts App even when localStorage throws (e.g. Incognito private mode)', async () => {
    const originalGetItem = localStorage.getItem;
    const originalSetItem = localStorage.setItem;

    // Simulate restricted private browsing where localStorage throws SecurityError
    Storage.prototype.getItem = vi.fn().mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });
    Storage.prototype.setItem = vi.fn().mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    try {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Gestione Casa')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Fallback to pearl palette must work even in restricted private browsing
      expect(document.documentElement.getAttribute('data-theme')).toBe('pearl');
      expect(document.documentElement.getAttribute('data-palette')).toBe('pearl');
    } finally {
      Storage.prototype.getItem = originalGetItem;
      Storage.prototype.setItem = originalSetItem;
    }
  });

  it('mounts App even when IndexedDB / Dexie fails to load initial settings', async () => {
    // Force db.settings.get to reject or fail
    const originalGet = db.settings.get;
    db.settings.get = vi.fn().mockRejectedValue(new Error('IndexedDB blocked'));

    try {
      render(<App />);

      await waitFor(() => {
        expect(screen.getByText('Gestione Casa')).toBeInTheDocument();
      }, { timeout: 3000 });
    } finally {
      db.settings.get = originalGet;
    }
  });
});
