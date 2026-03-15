import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { resolve } from 'path';

// Determine which target to build via env var: content, service-worker, or options
const target = process.env.BUILD_TARGET || 'options';

const configs: Record<string, ReturnType<typeof defineConfig>> = {
  content: defineConfig({
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/content/index.ts'),
        name: 'BrainstormContent',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  }),
  'service-worker': defineConfig({
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: resolve(__dirname, 'src/background/service-worker.ts'),
        name: 'BrainstormSW',
        formats: ['iife'],
        fileName: () => 'service-worker.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
  }),
  options: defineConfig({
    plugins: [preact()],
    base: '',
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        input: {
          options: resolve(__dirname, 'src/options/index.html'),
        },
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },
  }),
};

export default configs[target];
