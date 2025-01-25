// @ts-check

import typescript from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-plugin-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import { flatConfigs } from 'eslint-plugin-import';

export default [
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: '@typescript-eslint/parser',
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      prettier: prettier,
      import: flatConfigs.recommended,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      // Prettier integration
      'prettier/prettier': 'error',

      // TypeScript rules
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'warn',

      // Import rules
      'import/prefer-default-export': 'off',
      'import/no-unresolved': 'off',
      'import/extensions': [
        'error',
        'ignorePackages',
        {
          ts: 'always',
        },
      ],

      // Simple Import Sort rules
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',

      // General rules
      'no-console': 'warn',
      'no-var': 'error',
      'prefer-const': 'error',
    },
    extends: [
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended',
      'airbnb-base',
      'plugin:prettier/recommended',
    ],
    settings: {
      'import/resolver': {
        typescript: {},
      },
    },
  },
];
