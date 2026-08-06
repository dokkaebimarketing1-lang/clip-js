import {defineConfig, globalIgnores} from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const legacyWarnings = {
  'react-hooks/refs': 'warn',
  'react-hooks/immutability': 'warn',
  'react-hooks/set-state-in-effect': 'warn',
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/ban-ts-comment': 'warn',
  'prefer-const': 'warn',
};

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {rules: legacyWarnings},
  {
    files: ['app/lib/**/*.{ts,tsx}', 'app/api/**/*.{ts,tsx}', 'remotion/**/*.{ts,tsx}'],
    rules: {
      'react-hooks/refs': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/set-state-in-effect': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  globalIgnores([
    '.next/**', 'out/**', 'build/**', 'remotion-bundle/**', 'renders/**', 'next-env.d.ts',
    'app/components/editor/player/canvas-(not-used)/**',
  ]),
]);
