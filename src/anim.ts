// @ts-nocheck
// Helpers de animación (solo DOM). Se pueden importar desde el motor porque
// no tocan `document` hasta que se llaman.

// Cartas que están "volando" hacia la mesa: la mesa las dibuja ocultas hasta
// que el vuelo termina. La clave es la que arma arenaKey().
export const flying = new Set();

// Tiempos del colapso (ms): duración de cada carta y separación entre cartas.
export const COLLAPSE_DUR = 850;
export const COLLAPSE_STAGGER = 600;

export function arenaKey(handNum, trickIdx, seat) {
  return `${handNum}:${trickIdx}:${seat}`;
}

export function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function rectCenter(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Hace volar `node` (un clon visual) desde fromRect hasta toRect.
// El fantasma se posiciona en el destino y se anima con transform (FLIP),
// así no depende del tamaño de las cartas ni del layout.
export function flyGhost(node, fromRect, toRect, opts = {}) {
  const { duration = 420, fromRot = 0, toRot = 0, fromOpacity = 1, easing = 'cubic-bezier(0.22,0.8,0.24,1)' } = opts;
  return new Promise(resolve => {
    if (!node || !fromRect || !toRect || !toRect.width || prefersReducedMotion()) {
      resolve();
      return;
    }
    const ghost = document.createElement('div');
    ghost.className = 'fly-ghost';
    ghost.style.cssText = `left:${toRect.left}px;top:${toRect.top}px;width:${toRect.width}px;height:${toRect.height}px;`;
    ghost.appendChild(node);
    document.body.appendChild(ghost);

    const a = rectCenter(fromRect), b = rectCenter(toRect);
    const dx = a.x - b.x, dy = a.y - b.y;
    const s = fromRect.width / toRect.width;

    const anim = ghost.animate([
      { transform: `translate(${dx}px,${dy}px) scale(${s}) rotate(${fromRot}deg)`, opacity: fromOpacity },
      { transform: `translate(0,0) scale(1) rotate(${toRot}deg)`, opacity: 1 },
    ], { duration, easing, fill: 'forwards' });

    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      ghost.remove();
      resolve();
    };
    anim.onfinish = done;
    anim.oncancel = done;
    // Seguro: si la pestaña está en segundo plano el navegador puede pausar
    // la animación; el reloj garantiza que el fantasma no quede colgado.
    setTimeout(done, duration + 200);
  });
}

// Dorso de carta para usar como fantasma al repartir.
export function makeCardBack() {
  const el = document.createElement('div');
  el.className = 'card-back';
  el.textContent = '⊗';
  return el;
}
