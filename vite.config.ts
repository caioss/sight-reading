/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Web MIDI and Web Bluetooth require a secure context. `localhost` counts as
// secure, but to test on a real Android device over the LAN we need HTTPS, which
// the basic-ssl plugin provides with a self-signed certificate.
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
