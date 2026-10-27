import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
    { ignores: ['dist/', '.test-build/', 'src/generated/', 'node_modules/'] },
    js.configs.recommended,
    tseslint.configs.recommended,
    {
        files: ['scripts/**/*.mjs', 'eslint.config.js'],
        languageOptions: { globals: globals.node },
    },
    {
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    },
);
