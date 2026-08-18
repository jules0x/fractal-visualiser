import './style.css';
import { App } from './app.ts';
import { Panel } from './ui/panel.ts';
import { attachInput } from './ui/input.ts';
import { readHashState } from './state/urlstate.ts';

function fatal(message: string): void {
  const node = document.getElementById('fatal');
  if (!node) return;
  node.hidden = false;
  node.innerHTML = `<strong>AETHER can’t start</strong><div>${message}</div>`;
}

function boot(): void {
  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  if (!canvas) return fatal('Canvas element missing.');

  let app: App;
  try {
    app = new App(canvas);
  } catch (err) {
    return fatal(
      `${err instanceof Error ? err.message : String(err)}<br><br>` +
        'The deep-zoom engine needs WebGL 2 with float textures.',
    );
  }

  const panel = new Panel(app);
  attachInput(app, canvas, panel);

  app.resize();
  window.addEventListener('resize', () => app.resize());

  // Someone pasting a new link into the same tab, or using back/forward.
  window.addEventListener('hashchange', () => {
    const state = readHashState(location.hash);
    if (state) {
      app.applyViewState(state, true);
      panel.refreshControls();
    }
  });

  app.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
