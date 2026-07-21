import { defineConfig } from 'tsup';

// Dual ESM+CJS build so both `import` and `require` consumers (e.g. the P2-01
// integration suite running against a packed tarball) can load the validators.
// Schemas are NOT bundled — they ship as static files under schemas/ and are
// read at runtime relative to the module (../schemas), which resolves the same
// from dist/ and from src/ since both sit one level under the package root.
export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'node24',
    // Inject an import.meta.url shim into the CJS output so ../schemas resolves
    // for require() consumers too (esbuild leaves import.meta unshimmed otherwise).
    shims: true,
});
