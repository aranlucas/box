import { fileURLToPath } from 'node:url';
import { defineConfig } from 'oxlint';
import native from 'oxlint-config-universe/native';
import typescriptAnalysis from 'oxlint-config-universe/typescript-analysis';

const metroAssetPattern =
  '\\.(aac|aiff|avif|bmp|caf|db|gif|heic|html|jpeg|jpg|json|m4a|m4v|mov|mp3|mp4|mpeg|mpg|otf|pdf|png|psd|svg|ttf|wav|webm|webp|xml|yaml|yml|zip)$';
const metroExtensions = ['', '.android', '.ios', '.web', '.native'].flatMap((platform) =>
  ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.d.ts', '.json'].map(
    (extension) => platform + extension,
  ),
);

export default defineConfig({
  extends: [native, typescriptAnalysis],
  plugins: ['typescript', 'unicorn', 'oxc', 'promise', 'jsx-a11y'],
  categories: {
    correctness: 'error',
    suspicious: 'error',
    perf: 'error',
  },
  options: {
    typeAware: true,
    reportUnusedDisableDirectives: 'error',
    respectEslintDisableDirectives: false,
  },
  ignorePatterns: ['apps/app/dist/**', 'apps/app/android/app/build/**'],
  jsPlugins: [
    { name: 'import-js', specifier: 'eslint-plugin-import' },
    { name: 'react-js', specifier: 'eslint-plugin-react' },
    { name: 'hooks-js', specifier: 'eslint-plugin-react-hooks' },
    'eslint-plugin-expo',
  ],
  settings: {
    'import/extensions': metroExtensions,
    'import/resolver': {
      node: { extensions: metroExtensions },
      typescript: { project: fileURLToPath(new URL('./apps/app/tsconfig.json', import.meta.url)) },
    },
    react: { version: '19.3' },
  },
  rules: {
    eqeqeq: ['error', 'always'],
    'no-unused-vars': ['error', { args: 'all', argsIgnorePattern: '^_', caughtErrors: 'all' }],
    curly: ['error', 'multi-line'],
    'no-void': ['error', { allowAsStatement: true }],
    'typescript/no-empty-object-type': 'error',
    'typescript/no-explicit-any': 'error',
    'typescript/no-floating-promises': 'error',
    'typescript/no-misused-promises': 'error',
    'typescript/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    'typescript/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],
    'typescript/return-await': ['error', 'in-try-catch'],
    // Typed HTTP, database, and native APIs use checked narrowing or explicit boundary assertions.
    'typescript/no-unsafe-type-assertion': 'off',
    'no-underscore-dangle': ['error', { allow: ['__BX_DEV__', '__BX_OIDC_ISSUER__'] }],
    'array-callback-return': 'error',
    'import/no-cycle': 'error',
    'typescript/switch-exhaustiveness-check': 'error',
    'typescript/no-unsafe-assignment': 'error',
    'typescript/no-unsafe-call': 'error',
    'typescript/no-unsafe-member-access': 'error',
    'typescript/no-unsafe-argument': 'error',
    'typescript/no-unsafe-return': 'error',
    'react/react-in-jsx-scope': 'off',
    'react/display-name': 'error',
    'react/jsx-no-comment-textnodes': 'error',
    'react/no-unescaped-entities': 'error',
    'react/exhaustive-deps': 'error',
    'react/require-render-return': 'error',
    'react/unsupported-syntax': 'error',
    'react/no-unstable-nested-components': ['error', { allowAsProps: true }],
  },
  overrides: [
    {
      files: ['**/*.{js,jsx,mjs,cjs}'],
      rules: { 'no-undef': 'error' },
    },
    {
      files: ['oxlint.config.mts', 'apps/app/**/metro.config.js'],
      env: { node: true },
    },
    {
      files: ['**/test/**/*.{js,ts,mjs,tsx}', '**/vitest.config.ts', '**/vite.config.ts'],
      env: { node: true },
    },
    {
      files: ['**/*.test.{js,ts,tsx}'],
      plugins: ['typescript', 'unicorn', 'oxc', 'promise', 'import', 'vitest'],
      rules: {
        // Vitest infers the signature from the mock implementation.
        'vitest/require-mock-type-parameters': 'off',
      },
    },
    {
      files: ['apps/worker/src/index.ts'],
      rules: {
        // Hono supports async middleware and route handlers.
        'oxc/no-async-endpoint-handlers': 'off',
      },
    },
    {
      files: ['apps/worker/test/api-check.mjs'],
      rules: {
        // This JS integration test inspects untyped HTTP response bodies and polls in order.
        'no-await-in-loop': 'off',
        'typescript/no-unsafe-argument': 'off',
        'typescript/no-unsafe-assignment': 'off',
        'typescript/no-unsafe-call': 'off',
        'typescript/no-unsafe-member-access': 'off',
        'typescript/no-unsafe-return': 'off',
        'typescript/no-unsafe-unary-minus': 'off',
        'typescript/restrict-template-expressions': 'off',
      },
    },
    {
      files: ['apps/app/**/*.{js,jsx,mjs,cjs,ts,tsx}'],
      env: { browser: true, commonjs: true },
      globals: { ...native.globals, console: 'readonly', global: 'readonly' },
      rules: {
        'expo/no-dynamic-env-var': 'error',
        'expo/no-env-var-destructuring': 'error',
        'expo/use-dom-exports': 'error',
        'hooks-js/config': 'error',
        'hooks-js/gating': 'error',
        'import-js/no-unresolved': 'error',
        'import/namespace': 'error',
        'react-js/no-deprecated': 'error',
        // Expo StatusBar uses a mode string for its style prop.
        'react/style-prop-object': ['error', { allow: ['StatusBar'] }],
      },
    },
    {
      files: ['apps/app/**/*.{ts,tsx}'],
      rules: {
        'typescript/no-require-imports': ['error', { allow: [metroAssetPattern] }],
      },
    },
    {
      files: ['packages/label/src/webBluetooth.ts'],
      env: { browser: true },
    },
  ],
});
