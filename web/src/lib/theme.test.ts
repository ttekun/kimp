import { afterEach, describe, expect, it, vi } from 'vitest';

import { isTheme, persistTheme, readStoredTheme, resolveTheme, toggleThemeValue } from './theme';

function restoreLocalStorageDescriptor(originalDescriptor: PropertyDescriptor | undefined): void {
  if (originalDescriptor) {
    Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).localStorage;
  }
}

describe('theme helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('isTheme accepts only light and dark', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('system')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it('resolveTheme follows system preference when no stored value exists', () => {
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme(null, false)).toBe('light');
  });

  it('resolveTheme prefers stored value over system preference', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });

  it('readStoredTheme returns null for missing or invalid values', () => {
    const storage = {
      getItem: (key: string) => (key === 'kimchi-theme' ? 'invalid' : null),
    };
    vi.stubGlobal('localStorage', storage);
    expect(readStoredTheme()).toBeNull();
  });

  it('readStoredTheme returns null when storage access throws', () => {
    const storage = {
      getItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    };
    vi.stubGlobal('localStorage', storage);
    expect(readStoredTheme()).toBeNull();
  });

  it('readStoredTheme returns null when localStorage property getter throws', () => {
    vi.unstubAllGlobals();
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
      expect(readStoredTheme()).toBeNull();
    } finally {
      restoreLocalStorageDescriptor(originalDescriptor);
    }
  });

  it('persistTheme does not throw when storage access throws', () => {
    const storage = {
      setItem: () => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    };
    vi.stubGlobal('localStorage', storage);
    expect(() => persistTheme('dark')).not.toThrow();
  });

  it('persistTheme does not throw when localStorage property getter throws', () => {
    vi.unstubAllGlobals();
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    try {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
      expect(() => persistTheme('dark')).not.toThrow();
    } finally {
      restoreLocalStorageDescriptor(originalDescriptor);
    }
  });

  it('toggleThemeValue flips between light and dark', () => {
    expect(toggleThemeValue('light')).toBe('dark');
    expect(toggleThemeValue('dark')).toBe('light');
  });
});
