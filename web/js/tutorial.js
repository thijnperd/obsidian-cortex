// A guided coach-mark tour. This module owns the overlay and nothing else:
// the controller supplies the copy and the actions, so the tutorial cannot
// reach into vault state or write a note by accident.

const TARGET_WAIT_MS = 900;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function richText(parent, text) {
  const parts = String(text).split('`');
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    if (index % 2 === 1) {
      const key = document.createElement('kbd');
      key.textContent = part;
      parent.appendChild(key);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  }
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export class Tutorial {
  constructor() {
    this.root = document.getElementById('tour');
    this.card = document.getElementById('tour-card');
    this.spot = document.getElementById('tour-spot');
    this.els = {
      kicker: document.getElementById('tour-kicker'),
      context: document.getElementById('tour-context'),
      progress: document.getElementById('tour-progress-bar'),
      title: document.getElementById('tour-title'),
      body: document.getElementById('tour-body'),
      hint: document.getElementById('tour-hint'),
      back: document.getElementById('tour-back'),
      next: document.getElementById('tour-next'),
      secondary: document.getElementById('tour-secondary'),
      close: document.getElementById('tour-close'),
    };
    this.active = false;
    this.busy = false;
    this.index = 0;
    this.steps = [];
    this.onExit = null;
    this.targetEl = null;
    this.lastFocus = null;
    this.completed = false;
    this.context = '';
    this.reason = '';
    this._keyHandler = (event) => this.handleKey(event);

    this.els.next.addEventListener('click', () => this.next());
    this.els.back.addEventListener('click', () => this.back());
    this.els.close.addEventListener('click', () => this.close());
    this.els.secondary.addEventListener('click', () => this.close({ stay: true }));
    window.addEventListener('resize', () => {
      if (this.active) this.layout();
    });
  }

  async start(steps, { context = '', reason = '', onExit = null } = {}) {
    if (!this.root || this.active || !steps.length) return;
    this.steps = steps;
    this.index = 0;
    this.active = true;
    this.busy = false;
    this.completed = false;
    this.onExit = onExit;
    this.context = context;
    this.reason = reason;
    this.lastFocus = document.activeElement;
    document.body.classList.add('is-touring');
    this.root.hidden = false;
    this.els.context.hidden = !context;
    this.els.context.textContent = context;
    this.els.context.title = reason || '';
    document.addEventListener('keydown', this._keyHandler, true);
    await this.go(0);
    this.card.focus({ preventScroll: true });
  }

  async go(index) {
    if (!this.active || this.busy) return;
    const targetIndex = clamp(index, 0, this.steps.length - 1);
    this.busy = true;
    this.index = targetIndex;
    this.targetEl = null;
    const step = this.steps[targetIndex];
    this.render(step);
    this.root.classList.remove('has-spot', 'is-center');
    this.spot.hidden = true;

    try {
      await step.enter?.();
    } catch (error) {
      console.error('[tour] step action failed', error);
    }
    if (!this.active) {
      this.busy = false;
      return;
    }

    await wait(0);
    this.targetEl = await this.findTarget(step.target);
    if (!this.active) {
      this.busy = false;
      return;
    }
    this.layout();
    this.card.focus({ preventScroll: true });
    this.busy = false;
  }

  render(step) {
    this.els.kicker.textContent = `Guided tour · ${this.index + 1} of ${this.steps.length}`;
    this.els.progress.style.width = `${((this.index + 1) / this.steps.length) * 100}%`;
    this.els.title.textContent = step.title || '';
    this.els.body.replaceChildren();
    for (const paragraph of step.body || []) {
      const element = document.createElement('p');
      richText(element, paragraph);
      this.els.body.appendChild(element);
    }
    if (step.points?.length) {
      const list = document.createElement('ul');
      for (const point of step.points) {
        const item = document.createElement('li');
        richText(item, point);
        list.appendChild(item);
      }
      this.els.body.appendChild(list);
    }
    this.els.hint.replaceChildren();
    if (step.hint) richText(this.els.hint, step.hint);
    this.els.hint.hidden = !step.hint;
    this.els.back.disabled = this.index === 0;
    this.els.next.textContent = step.nextLabel || (this.index === this.steps.length - 1 ? 'Finish tour' : 'Next');
    const secondary = step.secondary;
    this.els.secondary.hidden = !secondary;
    if (secondary) this.els.secondary.textContent = secondary.label;
  }

  resolveTarget(target) {
    if (!target) return null;
    if (typeof target === 'function') return target();
    return document.querySelector(target);
  }

  visible(element) {
    if (!element || element.hidden) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }

  async findTarget(target) {
    const started = performance.now();
    while (this.active && performance.now() - started < TARGET_WAIT_MS) {
      const element = this.resolveTarget(target);
      if (this.visible(element)) {
        if (element.getBoundingClientRect().bottom > window.innerHeight - 24) {
          element.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
        return element;
      }
      await wait(50);
    }
    return null;
  }

  layout() {
    if (!this.active) return;
    const step = this.steps[this.index];
    const target = this.targetEl;
    if (!target || !this.visible(target)) {
      this.root.classList.remove('has-spot');
      this.root.classList.add('is-center');
      this.spot.hidden = true;
      this.card.style.left = '';
      this.card.style.top = '';
      return;
    }

    const rect = target.getBoundingClientRect();
    const pad = 5;
    this.spot.style.left = `${rect.left - pad}px`;
    this.spot.style.top = `${rect.top - pad}px`;
    this.spot.style.width = `${rect.width + pad * 2}px`;
    this.spot.style.height = `${rect.height + pad * 2}px`;
    this.spot.hidden = false;
    this.root.classList.add('has-spot');
    this.root.classList.remove('is-center');

    const card = this.card.getBoundingClientRect();
    const gap = 16;
    const margin = 16;
    const placement = step.placement || 'bottom';
    let left = rect.left + rect.width / 2 - card.width / 2;
    let top = rect.bottom + gap;

    if (placement === 'top') {
      top = rect.top - card.height - gap;
      if (top < margin) top = rect.bottom + gap;
    } else if (placement === 'right') {
      left = rect.right + gap;
      top = rect.top + rect.height / 2 - card.height / 2;
      if (left + card.width > window.innerWidth - margin) {
        left = rect.left - card.width - gap;
      }
    } else if (placement === 'left') {
      left = rect.left - card.width - gap;
      top = rect.top + rect.height / 2 - card.height / 2;
      if (left < margin) {
        left = rect.right + gap;
      }
    } else {
      if (top + card.height > window.innerHeight - margin) {
        top = rect.top - card.height - gap;
      }
    }

    left = clamp(left, margin, Math.max(margin, window.innerWidth - card.width - margin));
    top = clamp(top, margin, Math.max(margin, window.innerHeight - card.height - margin));
    this.card.style.left = `${left}px`;
    this.card.style.top = `${top}px`;
  }

  next() {
    if (this.busy || !this.active) return;
    if (this.index >= this.steps.length - 1) {
      this.completed = true;
      this.close();
      return;
    }
    this.go(this.index + 1);
  }

  back() {
    if (this.busy || !this.active || this.index === 0) return;
    this.go(this.index - 1);
  }

  async close({ stay = false } = {}) {
    if (!this.active) return;
    this.active = false;
    this.busy = false;
    document.removeEventListener('keydown', this._keyHandler, true);
    document.body.classList.remove('is-touring');
    this.root.hidden = true;
    this.spot.hidden = true;
    this.root.classList.remove('has-spot', 'is-center');
    this.card.style.left = '';
    this.card.style.top = '';
    this.targetEl = null;
    const callback = this.onExit;
    this.onExit = null;
    if (this.lastFocus?.focus) this.lastFocus.focus({ preventScroll: true });
    if (callback) await callback({ stay, completed: this.completed });
  }

  handleKey(event) {
    if (!this.active) return;
    if (event.key === 'Tab') {
      const focusable = [...this.card.querySelectorAll('button:not([hidden]):not([disabled])')]
        .filter((element) => this.visible(element));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!this.card.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
      event.stopPropagation();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      event.stopPropagation();
      this.next();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      this.back();
      return;
    }
    // The tour is a focus mode: no app shortcut should fire underneath it.
    event.stopPropagation();
  }
}
