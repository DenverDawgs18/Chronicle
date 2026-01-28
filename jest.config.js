module.exports = {
  testEnvironment: 'jsdom',
  testMatch: ['**/tests/**/*.test.js', '**/*.test.js'],
  moduleFileExtensions: ['js'],
  collectCoverageFrom: ['static/**/*.js'],
  coverageDirectory: 'coverage',
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js']
};
