import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      'complexity': ['warn', 8],
      'max-depth': ['warn', 4],
      'max-statements': ['warn', 20],
      'max-nested-callbacks': ['warn', 3],
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'workers/', 'scripts/'],
  },
];
