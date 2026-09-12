import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_STORAGE_KEY } from '../lib/theme';
import { useTheme } from './useTheme';

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) ?? null) : null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

function createMatchMedia(prefersDark: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let matches = prefersDark;

  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    dispatchEvent: vi.fn(),
  } as MediaQueryList & {
    addEventListener: (type: 'change', listener: (event: MediaQueryListEvent) => void) => void;
    removeEventListener: (type: 'change', listener: (event: MediaQueryListEvent) => void) => void;
  };

  return {
    mediaQueryList,
    setPrefersDark(next: boolean) {
      matches = next;
      const event = { matches: next } as MediaQueryListEvent;
      listeners.forEach((listener) => {
        listener(event);
      });
    },
  };
}

describe('useTheme', () => {
  let storage: MemoryStorage;
  let matchMediaControl: ReturnType<typeof createMatchMedia>;

  beforeEach(() => {
    storage = new MemoryStorage();
    matchMediaControl = createMatchMedia(false);

    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => matchMediaControl.mediaQueryList),
    );
    document.documentElement.removeAttribute('data-theme');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-theme');
  });

  it('defaults to system preference when no stored choice exists', () => {
    matchMediaControl = createMatchMedia(true);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => matchMediaControl.mediaQueryList),
    );

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
    expect(result.current.hasUserPreference).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('reads a persisted explicit choice on load', () => {
    storage.setItem(THEME_STORAGE_KEY, 'dark');
    matchMediaControl = createMatchMedia(false);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => matchMediaControl.mediaQueryList),
    );

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
    expect(result.current.hasUserPreference).toBe(true);
  });

  it('persists an explicit toggle to localStorage', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('dark');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('reacts to prefers-color-scheme changes before an explicit choice', () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('light');

    act(() => {
      matchMediaControl.setPrefersDark(true);
    });

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('falls back to system preference when localStorage throws on read', () => {
    const throwingStorage = {
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
      setItem: vi.fn(),
    };
    vi.stubGlobal('localStorage', throwingStorage);
    matchMediaControl = createMatchMedia(true);
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => matchMediaControl.mediaQueryList),
    );

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
    expect(result.current.hasUserPreference).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('falls back to system preference when localStorage property getter throws', () => {
    vi.unstubAllGlobals();
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
      matchMediaControl = createMatchMedia(true);
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => matchMediaControl.mediaQueryList),
      );

      const { result } = renderHook(() => useTheme());

      expect(result.current.theme).toBe('dark');
      expect(result.current.hasUserPreference).toBe(false);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any).localStorage;
      }
    }
  });

  it('stops reacting to system changes after an explicit toggle', () => {
    const { result } = renderHook(() => useTheme());

    act(() => {
      result.current.toggleTheme();
    });

    expect(result.current.theme).toBe('dark');

    act(() => {
      matchMediaControl.setPrefersDark(false);
    });

    expect(result.current.theme).toBe('dark');
    expect(storage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });
});
