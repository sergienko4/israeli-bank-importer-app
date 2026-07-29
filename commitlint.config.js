/**
 * Commitlint configuration.
 *
 * Enforces Conventional Commits so history stays machine-readable and
 * release tooling can derive versions from commit types.
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'body-max-line-length': [2, 'always', 100],
  },
};
