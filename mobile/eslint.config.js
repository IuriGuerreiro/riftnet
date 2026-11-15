const js = require('@eslint/js');
const globals = require('globals');
const reactHooks = require('eslint-plugin-react-hooks');
const tseslint = require('typescript-eslint');

// Same rules as client/eslint.config.js, minus the web-only bits.
module.exports = tseslint.config(
  { ignores: ['android', 'ios', 'node_modules', '*.config.js', 'index.js'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: { ...reactHooks.configs.recommended.rules },
  },
);
