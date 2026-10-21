import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['reference-projects/**', '.claude/**', 'node_modules/**', 'dist/**', 'site/dist/**', 'test-artifacts/**', 'playwright-report/**', 'test-results/**', '.opensinnoh-cache/**', '.lantern-cache/**', '.lantern-nds-cache/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } },
);
