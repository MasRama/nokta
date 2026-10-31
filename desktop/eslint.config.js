import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
    { ignores: ['dist/', 'src-tauri/', 'src/generated/', 'node_modules/'] },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        languageOptions: { globals: globals.browser },
    },
    {
        files: ['scripts/**/*.mjs', 'eslint.config.js', 'vite.config.ts'],
        languageOptions: { globals: globals.node },
    },
    {
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    },
);
