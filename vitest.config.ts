import {defineConfig} from 'vitest/config';

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
    },
    test: {
        globals: true,
        environment: 'happy-dom',
        setupFiles: ['src/tests/test-setup.ts'],
        include: ['src/tests/**/*.spec.ts'],
    },
});
