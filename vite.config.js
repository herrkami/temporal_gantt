import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
    build: {
        lib: {
            entry: resolve(__dirname, 'src/index.js'),
            name: 'Gantt',
            fileName: 'frappe-gantt',
        },
        minify: mode !== 'debug',
        sourcemap: mode === 'debug',
        rollupOptions: {
            output: {
                format: 'cjs',
                assetFileNames: 'frappe-gantt[extname]',
                entryFileNames: 'frappe-gantt.[format].js'
            },
        },
    },
    output: { interop: 'auto' },
    server: { watch: { include: ['dist/*', 'src/*'] } }
}));