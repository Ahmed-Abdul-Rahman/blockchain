// eslint.config.js

import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import prettierPlugin from 'eslint-plugin-prettier';
import simpleImportSortPlugin from 'eslint-plugin-simple-import-sort';
import importPlugin from 'eslint-plugin-import';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    files: ['src/**/*.ts', 'packages/**/*.ts', '**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
      prettier: prettierPlugin,
      'simple-import-sort': simpleImportSortPlugin,
      import: importPlugin,
    },
    rules: {
      // Prettier integration
      'prettier/prettier': [
        'error',
        {
          singleQuote: true,
          trailingComma: 'all',
          useTabs: false,
          tabWidth: 2,
          bracketSpacing: true,
          printWidth: 120,
          endOfLine: 'auto',
        },
      ],

      // TypeScript rules
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'warn',

      // Import rules
      'import/prefer-default-export': 'off',
      'import/no-unresolved': 'off',
      'import/extensions': [
        'error',
        'ignorePackages',
        {
          ts: 'never',
          tsx: 'never',
        },
      ],

      // Simple Import Sort rules
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // General rules
      'no-console': 'warn',
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'off',
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name='console'][callee.property.name!=/^(log|warn|error|info|trace)$/]",
          message: 'Unexpected property on console object was called',
        },
      ],
    },
    settings: {
      'import/resolver': {
        typescript: {},
      },
    },
  },
  prettierConfig,
];
