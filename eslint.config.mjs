/**
 * Flat ESLint config for the Expo / React Native app.
 *
 * Strict, type-aware baseline adapted from the backend's guardrails but made
 * React-Native-safe: it keeps the strict spirit (type safety, import hygiene,
 * complexity/size caps, mandatory JSDoc on exports, no bypass comments) while
 * dropping backend-only rules that fight React idioms (void/null-return bans,
 * setTimeout ban, Procedure/Pipeline/Canary/Playwright rules).
 */
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import expoConfig from 'eslint-config-expo/flat.js';
import prettier from 'eslint-config-prettier';
import importX from 'eslint-plugin-import-x';
import unusedImports from 'eslint-plugin-unused-imports';
import checkFile from 'eslint-plugin-check-file';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import jsdoc from 'eslint-plugin-jsdoc';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import globals from 'globals';

/**
 * Syntax bans kept for the app. Backend architecture bans (void/null returns,
 * setTimeout, nested calls, Procedure/Pipeline) are intentionally excluded
 * because React components return JSX/null and RN uses timers for animation.
 */
const RN_RESTRICTED_SYNTAX = [
  'ForInStatement',
  'LabeledStatement',
  'WithStatement',
  {
    selector: "CallExpression[callee.name='sleep']",
    message: "BRITTLE LOGIC: 'sleep()' is forbidden. Use a proper 'waitFor' mechanism.",
  },
];

/** Curated, RN-safe SonarJS rules (bug detection + complexity). */
const SONARJS_RULES = {
  'sonarjs/cognitive-complexity': ['error', 15],
  'sonarjs/no-identical-functions': 'error',
  'sonarjs/no-identical-expressions': 'error',
  'sonarjs/no-collapsible-if': 'error',
  'sonarjs/no-redundant-boolean': 'error',
  'sonarjs/no-unused-collection': 'error',
  'sonarjs/no-useless-catch': 'error',
  'sonarjs/prefer-immediate-return': 'error',
  'sonarjs/prefer-single-boolean-return': 'error',
  'sonarjs/no-small-switch': 'error',
  'sonarjs/no-duplicated-branches': 'error',
  'sonarjs/no-nested-template-literals': 'error',
  // Catastrophic backtracking on untrusted input, caught here rather than in
  // the SonarCloud report a push later.
  'sonarjs/super-linear-regex': 'error',
  'sonarjs/slow-regex': 'error',
  'sonarjs/prefer-read-only-props': 'error',
};

/** Curated, RN-safe Unicorn rules (recommended set minus React-hostile ones). */
const UNICORN_RULES = {
  'unicorn/better-regex': 'error',
  'unicorn/no-array-push-push': 'error',
  'unicorn/no-instanceof-array': 'error',
  'unicorn/no-lonely-if': 'error',
  'unicorn/no-unnecessary-await': 'error',
  'unicorn/no-useless-spread': 'error',
  'unicorn/prefer-array-find': 'error',
  'unicorn/prefer-array-some': 'error',
  'unicorn/prefer-includes': 'error',
  'unicorn/prefer-string-starts-ends-with': 'error',
  'unicorn/prefer-ternary': 'error',
  'unicorn/throw-new-error': 'error',
  'unicorn/no-negated-condition': 'error',
  'unicorn/prefer-optional-catch-binding': 'error',
  'unicorn/no-abusive-eslint-disable': 'error',
};

export default tseslint.config(
  // 1. Global ignores
  {
    ignores: [
      'dist/**',
      '.expo/**',
      'node_modules/**',
      'coverage/**',
      'babel.config.js',
      'metro.config.js',
      '*.config.js',
    ],
  },

  // 2. Base configs
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  ...expoConfig,
  prettier,

  // 2b. Type-aware parsing for every TS/TSX file (root App.tsx/index.ts included),
  //     so the type-checked rules above have type information everywhere.
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },

  // 3. Main source (strict, type-aware)
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    plugins: {
      'import-x': importX,
      'unused-imports': unusedImports,
      'check-file': checkFile,
      'simple-import-sort': simpleImportSort,
      jsdoc,
      sonarjs,
      unicorn,
    },
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2021 },
    },
    rules: {
      // Bypass / bad-practice bans
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-warning-comments': [
        'error',
        {
          terms: [
            'todo',
            'fixme',
            'istanbul ignore',
            'c8 ignore',
            'v8 ignore',
            '@ts-ignore',
            '@ts-nocheck',
            '@ts-expect-error',
            'eslint-disable',
            'prettier-ignore',
          ],
          location: 'anywhere',
        },
      ],
      'no-restricted-syntax': ['error', ...RN_RESTRICTED_SYNTAX],
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-nested-ternary': 'error',
      'no-await-in-loop': 'error',
      'class-methods-use-this': 'error',

      // Imports
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/max-dependencies': ['error', { max: 20, ignoreTypeImports: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],

      // Type safety
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],

      // Unused code
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
      ],

      // Naming (RN-adapted: no I-prefix; components PascalCase; CONSTS optional)
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: ['variable', 'function'], format: ['camelCase', 'PascalCase', 'UPPER_CASE'] },
        { selector: 'parameter', format: ['camelCase', 'PascalCase'], leadingUnderscore: 'allow' },
        { selector: 'typeParameter', format: ['PascalCase'] },
        { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
      ],

      // File naming: .tsx PascalCase, .ts camelCase (matches current layout)
      'check-file/filename-naming-convention': [
        'error',
        { 'src/**/*.tsx': 'PASCAL_CASE', 'src/**/*.ts': 'CAMEL_CASE' },
        { ignoreMiddleExtensions: true },
      ],

      // JSDoc on all exports (inline callbacks exempt via publicOnly)
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
          },
          contexts: ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'],
        },
      ],
      'jsdoc/require-description': ['error', { contexts: ['any'] }],
      'jsdoc/require-param': ['error', { checkDestructured: false }],
      'jsdoc/require-param-description': 'error',
      'jsdoc/require-param-type': 'off',
      'jsdoc/check-param-names': ['error', { checkDestructured: false }],
      'jsdoc/require-returns': 'error',
      'jsdoc/require-returns-description': 'error',
      'jsdoc/require-returns-type': 'off',
      'jsdoc/check-tag-names': ['error', { definedTags: ['remarks'] }],

      // Limits
      complexity: ['error', { max: 10 }],
      '@typescript-eslint/max-params': ['error', { max: 3 }],
      'max-classes-per-file': ['error', 1],
      'max-len': [
        'error',
        { code: 100, ignoreUrls: true, ignoreStrings: true, ignoreComments: true },
      ],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],

      ...SONARJS_RULES,
      ...UNICORN_RULES,
    },
  },

  // 4. Components / screens: JSX is verbose — relax per-function lines and the
  //    awkward @returns requirement (the JSX return is self-evident).
  {
    files: ['src/**/*.tsx'],
    rules: {
      'max-lines-per-function': ['error', { max: 120, skipBlankLines: true, skipComments: true }],
      'jsdoc/require-returns': 'off',
      'jsdoc/require-returns-description': 'off',
    },
  },

  // 5. Tests (relaxed)
  {
    files: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts'],
    languageOptions: { globals: { ...globals.jest } },
    rules: {
      'no-console': 'off',
      'max-lines-per-function': 'off',
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
      'max-len': 'off',
      'check-file/filename-naming-convention': 'off',
      'jsdoc/require-jsdoc': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-conversion': 'off',
      '@typescript-eslint/no-dynamic-delete': 'off',
      'sonarjs/no-identical-functions': 'off',
      'sonarjs/cognitive-complexity': 'off',
      'no-restricted-syntax': 'off',
    },
  },

  // 6. All JS/MJS/CJS files (configs like eslint.config.mjs): type-aware
  //    rules need a TS project, so disable them here.
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      'import/no-named-as-default-member': 'off',
      'import/no-named-as-default': 'off',
    },
  },

  // 7. Repo tooling scripts run under Node, not Metro, so they need Node globals.
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
);
