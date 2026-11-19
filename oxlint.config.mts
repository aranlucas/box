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
    // On in full; the exceptions are listed, with reasons, at the end of `rules`.
    pedantic: 'error',
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
    curly: ['error', 'all'],
    'no-void': ['error', { allowAsStatement: true }],
    'typescript/no-empty-object-type': 'error',
    'typescript/no-explicit-any': 'error',
    'typescript/no-floating-promises': 'error',
    'typescript/no-misused-promises': 'error',
    'typescript/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    'typescript/prefer-nullish-coalescing': ['error', { ignorePrimitives: { string: true } }],
    'typescript/return-await': ['error', 'in-try-catch'],
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

    // ---- Hand-picked from `style` and `restriction` ----
    'no-console': ['error', { allow: ['warn', 'error'] }],
    'no-else-return': 'error',
    'no-lonely-if': 'error',
    'no-nested-ternary': 'error',
    'no-param-reassign': 'error',
    'no-sequences': 'error',
    'no-useless-computed-key': 'error',
    'no-useless-rename': 'error',
    'object-shorthand': 'error',
    'prefer-const': 'error',
    'prefer-object-spread': 'error',
    'prefer-template': 'error',
    'react/jsx-boolean-value': 'error',
    'react/jsx-curly-brace-presence': 'error',
    'react/jsx-no-useless-fragment': 'error',
    'react/self-closing-comp': 'error',
    'typescript/array-type': 'error',
    'typescript/consistent-type-definitions': ['error', 'type'],
    'typescript/consistent-type-imports': 'error',
    'typescript/no-import-type-side-effects': 'error',
    'typescript/no-non-null-assertion': 'error',
    // Only sound because every tsconfig sets noUncheckedIndexedAccess: without it `list[0]` is typed as always present.
    'typescript/no-unnecessary-condition': 'error',
    'typescript/prefer-optional-chain': 'error',
    'typescript/use-unknown-in-catch-callback-variable': 'error',
    'unicorn/catch-error-name': 'error',
    'unicorn/no-array-for-each': 'error',
    'unicorn/prefer-node-protocol': 'error',
    'unicorn/prefer-number-properties': 'error',

    // ---- React Compiler rules (app.json has reactCompiler: true) ----
    'react/error-boundaries': 'error',
    'react/globals': 'error',
    'react/immutability': 'error',
    'react/incompatible-library': 'error',
    'react/preserve-manual-memoization': 'error',
    'react/purity': 'error',
    'react/refs': 'error',
    'react/set-state-in-effect': 'error',
    'react/set-state-in-render': 'error',
    'react/static-components': 'error',
    'react/use-memo': 'error',

    // ---- Pedantic rules that are off, with the reason ----
    // Library types (Hono Context, React props, D1) are not readonly; this cannot be satisfied.
    'typescript/prefer-readonly-parameter-types': 'off',
    // Truthiness checks on `string | null` are the idiom here; the explicit form is longer, not safer.
    'typescript/strict-boolean-expressions': 'off',
    // Metro does not support top-level await.
    'unicorn/prefer-top-level-await': 'off',
    // A `u` flag on every ASCII-only pattern is noise.
    'require-unicode-regexp': 'off',
    // Bytes are packed into binary strings for btoa(); code points are the wrong unit.
    'unicorn/prefer-code-point': 'off',
    // Size limits are judged in review, not by line counts.
    'max-lines': 'off',
    'max-lines-per-function': 'off',
    'import/max-dependencies': 'off',
    'no-inline-comments': 'off',
    // Passing a named function to map() is the simple form; the wrapper arrow adds nothing.
    'unicorn/no-array-callback-reference': 'off',
    // An explicit `undefined` keeps return types honest (`T | undefined`, not `T | void`).
    'unicorn/no-useless-undefined': 'off',
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
        // Fakes implement async interfaces without awaiting anything.
        'require-await': 'off',
        'typescript/require-await': 'off',
        // Table-driven tests branch over their cases.
        'vitest/no-conditional-in-test': 'off',
        // Several tests only care that a bad input is rejected, whatever the library's wording.
        'vitest/require-to-throw-message': 'off',
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
        'no-console': 'off',
        // Its fake auth server is an async request handler.
        'typescript/no-misused-promises': 'off',
        'typescript/strict-void-return': 'off',
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
