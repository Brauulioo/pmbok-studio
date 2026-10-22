import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `--mode artifact` empaqueta todo en un único HTML para la vista previa como Artifact.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'artifact' ? [viteSingleFile()] : [])],
  server: {
    port: 5173,
    // Permite importar backend/data/presets.json (presets incluidos como respaldo offline)
    fs: { allow: ['..'] },
  },
}));
