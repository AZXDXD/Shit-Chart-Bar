// One original <img>, pixel-based sizing and native scroll offsets in both modes.
export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 8;
const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
const clampZoom = scale => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));

export class ChartStripViewer {
  constructor(root) {
    this.root = root;
    this.viewport = root.querySelector('.strip-viewport');
    this.surface = root.querySelector('.strip-surface');
    this.image = root.querySelector('.strip-image');
    this.status = root.querySelector('.strip-status');
    this.label = root.querySelector('.strip-zoom-label');
    this.dimensions = root.querySelector('.strip-dimensions');
    this.buttons = [...root.querySelectorAll('[data-strip-action]')];
    this.source = '';
    this.scale = 1;
    this.mode = 'fit-height';
    this.ready = false;
    this.expanded = false;
    this.pointers = new Map();
    this.frame = null;
    this.image.addEventListener('load', () => this.loaded());
    this.image.addEventListener('error', () => this.unavailable('展譜圖載入失敗，請稍後重新整理。'));
    this.image.addEventListener('dragstart', event => event.preventDefault());
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-strip-action]');
      if (!button || button.disabled) return;
      const action = button.dataset.stripAction;
      if (action === 'fullscreen') { this.setExpanded(!this.expanded); return; }
      if (!this.ready) return;
      if (action === 'in') this.zoomStep(1);
      if (action === 'out') this.zoomStep(-1);
      if (action === 'original') this.setScale(1);
      if (action === 'fit') this.fitHeight();
      if (action === 'reset') this.reset();
    });
    this.viewport.addEventListener('wheel', event => {
      // Ordinary wheel scrolling stays native. Ctrl+wheel (including trackpad
      // pinch events) zooms only this viewer, never the whole document.
      if (!this.ready || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.viewport.clientHeight : 1;
      const change = Math.max(-250, Math.min(250, event.deltaY * units));
      this.setScale(this.scale * Math.exp(-change * 0.002), this.localPoint(event));
    }, { passive: false });
    this.viewport.addEventListener('pointerdown', event => this.pointerDown(event));
    this.viewport.addEventListener('pointermove', event => this.pointerMove(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.viewport.addEventListener(type, event => this.pointerEnd(event));
    }
    this.viewport.addEventListener('keydown', event => {
      if (!this.ready) return;
      if (event.key === '+' || event.key === '=') { event.preventDefault(); this.zoomStep(1); }
      if (event.key === '-') { event.preventDefault(); this.zoomStep(-1); }
      if (event.key === '0') { event.preventDefault(); this.setScale(1); }
      if (event.key === 'Home') { event.preventDefault(); this.viewport.scrollLeft = 0; }
      if (event.key === 'End') { event.preventDefault(); this.viewport.scrollLeft = this.viewport.scrollWidth; }
    });
    this.onKeyDown = event => {
      if (!this.expanded) return;
      if (event.key === 'Escape') { event.preventDefault(); this.setExpanded(false); }
      if (event.key === 'Tab') {
        const focusable = [...root.querySelectorAll('button:not(:disabled), a[href]:not([hidden]), [tabindex="0"]')];
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', this.onKeyDown);
    this.resizeObserver = new ResizeObserver(() => {
      if (this.ready && this.mode === 'fit-height') this.fitHeight();
    });
    this.resizeObserver.observe(this.viewport);
    this.unavailable('未提供展譜圖');
  }

  unavailable(text) {
    this.ready = false;
    this.surface.hidden = true;
    this.status.hidden = false;
    this.status.textContent = text;
    this.label.textContent = '—';
    this.dimensions.textContent = '';
    this.updateControls();
  }

  setSource(url) {
    // Auth/statistic refreshes must not replace the image or reset the viewport.
    if ((url || '') === this.source) return;
    this.source = url || '';
    this.stopGesture();
    if (!this.source) {
      this.image.removeAttribute('src');
      this.setExpanded(false);
      this.unavailable('未提供展譜圖');
      return;
    }
    this.unavailable('正在載入展譜圖…');
    this.image.src = this.source;
  }

  loaded() {
    if (!this.source || !this.image.naturalWidth || !this.image.naturalHeight) return;
    this.ready = true;
    this.surface.hidden = false;
    this.status.hidden = true;
    this.dimensions.textContent = `原圖 ${this.image.naturalWidth.toLocaleString()} × ${this.image.naturalHeight.toLocaleString()} px`;
    this.reset();
  }

  localPoint(event) {
    const rect = this.viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left - this.viewport.clientLeft, y: event.clientY - rect.top - this.viewport.clientTop };
  }

  setScale(value, anchor = { x: this.viewport.clientWidth / 2, y: this.viewport.clientHeight / 2 }, mode = 'manual') {
    if (!this.ready || !Number.isFinite(value)) return;
    const pixelX = (this.viewport.scrollLeft + anchor.x) / this.scale;
    const pixelY = (this.viewport.scrollTop + anchor.y) / this.scale;
    this.scale = clampZoom(value);
    this.mode = mode;
    this.renderSize();
    this.viewport.scrollLeft = pixelX * this.scale - anchor.x;
    this.viewport.scrollTop = pixelY * this.scale - anchor.y;
  }

  renderSize() {
    // At 100%, these are exactly naturalWidth/naturalHeight CSS pixels.
    const width = `${this.image.naturalWidth * this.scale}px`;
    const height = `${this.image.naturalHeight * this.scale}px`;
    this.image.style.width = this.surface.style.width = width;
    this.image.style.height = this.surface.style.height = height;
    const percent = `${Number((this.scale * 100).toFixed(1))}%`;
    this.label.textContent = this.mode === 'fit-height' ? `Fit Height · ${percent}` : percent;
    this.updateControls();
  }

  updateControls() {
    for (const button of this.buttons) {
      const action = button.dataset.stripAction;
      button.disabled = !(action === 'fullscreen' && this.expanded) &&
        (!this.ready || (action === 'in' && this.scale >= MAX_ZOOM) || (action === 'out' && this.scale <= MIN_ZOOM));
      if (action === 'fit') button.setAttribute('aria-pressed', String(this.ready && this.mode === 'fit-height'));
      if (action === 'original') button.setAttribute('aria-pressed', String(this.ready && this.mode === 'manual' && this.scale === 1));
      if (action === 'fullscreen') {
        button.textContent = this.expanded ? '✕ 離開全螢幕' : '⛶ 全螢幕查看';
        button.setAttribute('aria-expanded', String(this.expanded));
      }
    }
  }

  fitHeight() {
    if (!this.ready || this.viewport.clientHeight <= 0) return;
    // A horizontal scrollbar consumes height on Windows. Re-read after sizing
    // so Fit Height doesn't accidentally introduce an unnecessary vertical bar.
    for (let pass = 0; pass < 2; pass++) {
      this.setScale(this.viewport.clientHeight / this.image.naturalHeight, undefined, 'fit-height');
    }
  }

  zoomStep(direction) {
    const steps = direction > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse();
    const next = steps.find(value => direction > 0 ? value > this.scale + 0.00001 : value < this.scale - 0.00001);
    this.setScale(next ?? (direction > 0 ? MAX_ZOOM : MIN_ZOOM));
  }

  reset() {
    this.stopGesture();
    this.mode = 'fit-height';
    this.fitHeight();
    this.viewport.scrollLeft = 0;
    this.viewport.scrollTop = 0;
  }

  pointerDown(event) {
    if (!this.ready || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const point = this.localPoint(event);
    // Leave native scrollbar tracks/thumbs to the browser.
    if (point.x < 0 || point.y < 0 || point.x >= this.viewport.clientWidth || point.y >= this.viewport.clientHeight) return;
    event.preventDefault();
    this.viewport.focus({ preventScroll: true });
    this.flushGesture();
    this.pointers.set(event.pointerId, point);
    this.viewport.setPointerCapture(event.pointerId);
    this.viewport.classList.add('is-dragging');
    this.startGesture();
  }

  startGesture() {
    const points = [...this.pointers.values()];
    if (points.length >= 2) {
      const [a, b] = points;
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.gesture = { type: 'pinch', distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale: this.scale,
        pixelX: (this.viewport.scrollLeft + center.x) / this.scale, pixelY: (this.viewport.scrollTop + center.y) / this.scale };
    } else if (points.length) {
      this.gesture = { type: 'pan', ...points[0], left: this.viewport.scrollLeft, top: this.viewport.scrollTop };
    } else this.gesture = null;
  }

  pointerMove(event) {
    if (!this.pointers.has(event.pointerId)) return;
    event.preventDefault();
    this.pointers.set(event.pointerId, this.localPoint(event));
    if (this.frame === null) this.frame = requestAnimationFrame(() => { this.frame = null; this.applyGesture(); });
  }

  applyGesture() {
    if (!this.gesture) return;
    const points = [...this.pointers.values()];
    if (this.gesture.type === 'pinch' && points.length >= 2) {
      const [a, b] = points;
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.setScale(this.gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / this.gesture.distance, center);
      this.viewport.scrollLeft = this.gesture.pixelX * this.scale - center.x;
      this.viewport.scrollTop = this.gesture.pixelY * this.scale - center.y;
    } else if (points.length) {
      this.viewport.scrollLeft = this.gesture.left + this.gesture.x - points[0].x;
      this.viewport.scrollTop = this.gesture.top + this.gesture.y - points[0].y;
    }
  }

  flushGesture() {
    if (this.frame !== null) {
      cancelAnimationFrame(this.frame);
      this.frame = null;
      this.applyGesture();
    }
  }

  pointerEnd(event) {
    if (!this.pointers.has(event.pointerId)) return;
    this.flushGesture();
    this.pointers.delete(event.pointerId);
    if (this.viewport.hasPointerCapture(event.pointerId)) this.viewport.releasePointerCapture(event.pointerId);
    this.viewport.classList.toggle('is-dragging', this.pointers.size > 0);
    this.startGesture();
  }

  stopGesture() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    const ids = [...this.pointers.keys()];
    this.pointers.clear();
    this.gesture = null;
    for (const id of ids) if (this.viewport.hasPointerCapture(id)) this.viewport.releasePointerCapture(id);
    this.viewport.classList.remove('is-dragging');
  }

  setExpanded(expanded) {
    if (expanded === this.expanded) return;
    this.stopGesture();
    if (expanded) {
      this.previousFocus = document.activeElement;
      this.previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      this.root.setAttribute('role', 'dialog');
      this.root.setAttribute('aria-modal', 'true');
    } else {
      document.body.style.overflow = this.previousOverflow;
      this.root.setAttribute('role', 'region');
      this.root.removeAttribute('aria-modal');
    }
    this.expanded = expanded;
    this.root.classList.toggle('is-expanded', expanded);
    if (this.mode === 'fit-height') this.fitHeight();
    this.updateControls();
    if (expanded) this.viewport.focus({ preventScroll: true });
    else this.previousFocus?.focus({ preventScroll: true });
  }
}

const instances = new WeakMap();
export function getStripViewer(root = document.getElementById('stripViewer')) {
  if (!root) return null;
  if (!instances.has(root)) instances.set(root, new ChartStripViewer(root));
  return instances.get(root);
}
