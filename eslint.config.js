import js from '@eslint/js';
import ts from 'typescript-eslint';
export default ts.config(
  { ignores: ['node_modules/**', '.pnpm-store/**', 'dist/**', '**/dist/**', '.local/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended, ...ts.configs.recommended,
  { files: ['**/*.ts', '**/*.tsx'], rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  { files: ['infra/pocketbase/**/*.js'], languageOptions: { globals: { migrate: 'readonly', routerAdd: 'readonly', ApiError: 'readonly', UnauthorizedError: 'readonly', ForbiddenError: 'readonly', $app: 'readonly', $apis: 'readonly', $os: 'readonly', $security: 'readonly', __hooks: 'readonly', require: 'readonly', module: 'readonly', arrayOf: 'readonly', DynamicModel: 'readonly', toString: 'readonly' } }, rules: { '@typescript-eslint/no-require-imports': 'off', '@typescript-eslint/triple-slash-reference': 'off' } }
);
