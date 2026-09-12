import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(eslint.configs.recommended, ...tseslint.configs.recommended, {
  ignores: [
    '**/dist/**',
    '**/node_modules/**',
    '**/coverage/**',
    'scripts/**',
    'web/e2e/**/*.png',
    'web/public/**',
  ],
});
