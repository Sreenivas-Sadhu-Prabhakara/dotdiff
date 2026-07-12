// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://sreenivas-sadhu-prabhakara.github.io',
  base: '/dotdiff',
  trailingSlash: 'ignore',
  build: {
    // Keep CSS as external files so the strict CSP (style-src allows
    // 'unsafe-inline' only for small inline bits) stays clean, and keep
    // our island script external so script-src 'self' is never violated.
    inlineStylesheets: 'never',
  },
});
