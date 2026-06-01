/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    // Mock native UDP module — not available in Node environment
    'react-native-udp': '<rootDir>/src/__mocks__/react-native-udp.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        strict: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    }],
  },
  forceExit: true,
  clearMocks: true,
};
