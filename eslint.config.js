// eslint.config.js

import typescriptPlugin from '@typescript-eslint/eslint-plugin';
import typescriptParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import prettierPlugin from 'eslint-plugin-prettier';

export default [
  {
    files: ['src/**/*.ts', 'packages/**/*.ts', '**/*.ts'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        ecmaVersion: 2025,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': typescriptPlugin,
      prettier: prettierPlugin,
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
      // 'import/prefer-default-export': 'off',
      // 'import/no-unresolved': 'off',
      // 'import/extensions': [
      //   'error',
      //   'ignorePackages',
      //   {
      //     ts: 'never',
      //     tsx: 'never',
      //   },
      // ],

      // // Simple Import Sort rules
      // 'simple-import-sort/imports': 'error',
      // 'simple-import-sort/exports': 'error',

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
      'import/order': [
        'error',
        {
          groups: [
            'builtin', // Node.js built-in modules
            'external', // npm packages
            'internal', // Internal project modules, defined using aliases
            'parent', // Relative imports to parent directories
            'sibling', // Relative imports to sibling directories
            'index', // Imports to index.js/ts within the same directory
          ],
          pathGroups: [
            // Example: Treat imports starting with "~/" as internal
            {
              pattern: '~/**',
              group: 'internal',
              position: 'after', // Position after external imports
            },
            // Example: Separate specific libraries or components into their own groups
            {
              pattern: 'react',
              group: 'external',
              position: 'before', // Force React to be at the top of external imports
            },
            {
              pattern: '@mui/material/**',
              group: 'external',
              position: 'before', // Place MUI material imports before other external imports
            },
            {
              pattern: '@mui/icons-material/**',
              group: 'external',
              position: 'after', // Place MUI icon imports after other external imports
            },
          ],
          pathGroupsExcludedImportTypes: ['internal'], // Prevent internal imports from being placed within other groups
          alphabetize: {
            order: 'asc', // Sort imports alphabetically within each group
            caseInsensitive: true, // Ignore case when sorting
          },
          // 'newlines-between': 'always', // Add a newline between import groups
        },
      ],
      // Other import-related rules (optional)
      'import/first': 'error', // Ensure all imports appear before other statements
      'import/newline-after-import': 'error', // Enforce a newline after import statements
      'import/no-duplicates': 'error', // Forbid repeated import of the same module
    },
    settings: {
      'import/resolver': {
        typescript: {},
      },
    },
  },
  prettierConfig,
];
