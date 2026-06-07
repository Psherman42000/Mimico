import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Complexidade
      'complexity': ['warn', 10],
      'max-depth': ['warn', 3],
      'max-nested-callbacks': ['warn', 2],
      'max-lines-per-function': ['warn', { max: 40, skipBlankLines: true, skipComments: true }],
      'max-params': ['warn', 4],
      'max-statements': ['warn', 20],

      // Clean Code
      'no-console': 'off',
      'no-alert': 'off',
      'no-var': 'error',
      'prefer-const': 'warn',
      'prefer-arrow-callback': 'warn',
      'prefer-template': 'warn',
      'no-eval': 'error',
      'no-implicit-coercion': 'warn',
      'no-lonely-if': 'warn',
      'no-negated-condition': 'warn',
      'no-nested-ternary': 'warn',
      'no-unneeded-ternary': 'warn',
      'no-useless-return': 'warn',
      'no-else-return': 'warn',
      'curly': ['warn', 'all'],
      'eqeqeq': ['warn', 'always'],
      'yoda': 'warn',

      // Nomes
      'id-length': ['warn', { min: 2, max: 30, properties: 'never', exceptions: ['_', 'x', 'y'] }],
      'camelcase': ['warn', { properties: 'never' }],
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'workers/', 'scripts/', 'eslint.config.js'],
  },
];
