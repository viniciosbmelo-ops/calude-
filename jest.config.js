module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  collectCoverageFrom: ['src/clinical/**/*.ts'],
  coverageThreshold: { global: { lines: 90, branches: 80 } }
};
