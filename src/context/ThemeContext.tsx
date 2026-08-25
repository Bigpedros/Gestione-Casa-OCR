import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import type { ThemeMode } from '../types';
import { settingsRepository } from '../repositories';

const THEME_STORAGE_KEY = 'gestione_casa_theme';

export interface ThemeContextValue {
  themeMode: ThemeMode; // 'light' | 'pearl' | 'dark'
  setThemeMode: (mode: ThemeMode) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 1. Synchronous initial state from localStorage with 'pearl' as default and automatic migration from 'system'
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'light' || saved === 'pearl' || saved === 'dark') {
        return saved;
      }
      if (saved === 'system') {
        // Automatic migration from legacy 'system' to 'pearl'
        try {
          localStorage.setItem(THEME_STORAGE_KEY, 'pearl');
        } catch {
          // Ignora errori di storage
        }
        return 'pearl';
      }
    } catch {
      // Fallback a 'pearl' in caso di errori di accesso (es. navigazione privata)
    }
    return 'pearl';
  });

  // 2. Sync with Dexie settings repository on mount with automatic migration from 'system'
  useEffect(() => {
    let isMounted = true;
    try {
      settingsRepository.get().then((settings) => {
        if (!isMounted || !settings) return;

        if ((settings.theme as string) === 'system') {
          // Automatic migration in database
          setThemeModeState('pearl');
          try {
            localStorage.setItem(THEME_STORAGE_KEY, 'pearl');
          } catch {
            // Ignora
          }
          settingsRepository.update({ theme: 'pearl' }).catch(() => {
            // Ignora
          });
        } else if (settings.theme === 'light' || settings.theme === 'pearl' || settings.theme === 'dark') {
          setThemeModeState(settings.theme);
          try {
            localStorage.setItem(THEME_STORAGE_KEY, settings.theme);
          } catch {
            // Ignora
          }
        }
      }).catch(() => {
        // Ignora errori di lettura impostazioni iniziali
      });
    } catch {
      // Ignora errori sincroni di avvio Dexie
    }

    return () => {
      isMounted = false;
    };
  }, []);

  // 3. Synchronize DOM classes and attributes on documentElement and body
  useEffect(() => {
    try {
      if (typeof document === 'undefined') return;

      const root = document.documentElement;
      const body = document.body;

      if (themeMode === 'dark') {
        root.classList.add('dark');
        root.classList.remove('light');
        root.setAttribute('data-theme', 'dark');
        root.setAttribute('data-palette', 'anthracite');
        root.style.colorScheme = 'dark';
        if (body) {
          body.classList.add('dark');
          body.classList.remove('light');
        }
      } else if (themeMode === 'light') {
        root.classList.remove('dark');
        root.classList.add('light');
        root.setAttribute('data-theme', 'light');
        root.setAttribute('data-palette', 'sand');
        root.style.colorScheme = 'light';
        if (body) {
          body.classList.remove('dark');
          body.classList.add('light');
        }
      } else {
        // 'pearl' (default)
        root.classList.remove('dark');
        root.classList.add('light');
        root.setAttribute('data-theme', 'pearl');
        root.setAttribute('data-palette', 'pearl');
        root.style.colorScheme = 'light';
        if (body) {
          body.classList.remove('dark');
          body.classList.add('light');
        }
      }
    } catch {
      // Ignora errori di manipolazione DOM su sandbox protette
    }
  }, [themeMode]);

  // 4. Update theme function (updates state, localStorage, and Dexie settings)
  const setThemeMode = useCallback(async (mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Ignora errori di scrittura su localStorage
    }

    try {
      await settingsRepository.update({ theme: mode });
    } catch (err) {
      console.warn('Impossibile persistere la preferenza del tema in Dexie:', err);
    }
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    themeMode,
    setThemeMode,
  }), [themeMode, setThemeMode]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextValue => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme deve essere utilizzato all\'interno di un ThemeProvider');
  }
  return context;
};

