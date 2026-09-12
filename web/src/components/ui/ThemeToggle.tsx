import { useTheme } from '../../hooks/useTheme';
import './ThemeToggle.css';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      className="theme-toggle"
      role="switch"
      onClick={toggleTheme}
      aria-label="Dark mode"
      aria-checked={isDark}
    >
      <span className="theme-toggle__label" aria-hidden="true">
        {isDark ? 'Day' : 'Night'}
      </span>
    </button>
  );
}
