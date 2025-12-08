// Boot module for the Full-mode page.
// It sets a global flag and dynamically imports the main game module so
// the main module can decide at runtime whether to build Full mode.

// Mark that we want the Full-mode features (texture atlas, models)
try { window.__FORCE_FULL__ = true; } catch (e) { /* ignore */ }

// Dynamic import so the flag above is set before the main module runs
(async () => {
  try {
    await import('./mygame.js');
  } catch (e) {
    console.error('Failed to load mygame.js from mygamefull.js', e);
  }
})();
