import globals from 'globals';

export default [
  {
    files: ['src/**/*.js', 'test/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node },
    rules: { 'no-unused-vars': ['error', { args: 'none' }], 'no-undef': 'error' },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.browser },
    rules: { 'no-unused-vars': ['error', { args: 'none' }], 'no-undef': 'error' },
  },
];
