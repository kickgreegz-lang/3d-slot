import { gsap } from 'gsap';
import { h } from './h';

export interface ModalOptions {
  /** panel content (already built) */
  panel: HTMLElement;
  /** full-screen sheet on phones / popouts (menus) vs centred dialog */
  sheet?: boolean;
  /** Esc / scrim click close it (false for blocking errors) */
  dismissible?: boolean;
  /** accessible name */
  label: string;
  onClose?: () => void;
}

export interface ModalHandle {
  readonly layer: HTMLElement;
  close(): void;
  readonly isOpen: boolean;
}

interface Entry {
  layer: HTMLElement;
  opts: ModalOptions;
  restore: Element | null;
  open: boolean;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
/** fallback removal if 'transitionend' never fires (hidden tab, reduced motion) */
const CLOSE_FALLBACK_S = 0.45;

/**
 * Stack of glass modals inside the overlay root: open/close transitions (CSS),
 * Esc + scrim dismissal, focus trap and focus restore. Reports "any modal open"
 * so the HUD can suspend its hotkeys.
 */
export class ModalStack {
  private readonly stack: Entry[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly onChange: (anyOpen: boolean) => void,
  ) {
    window.addEventListener('keydown', this.onKey, true);
  }

  get anyOpen(): boolean {
    return this.stack.some((e) => e.open);
  }

  open(opts: ModalOptions): ModalHandle {
    const scrim = h('div.ui-scrim');
    if (!opts.panel.getAttribute('role')) opts.panel.setAttribute('role', 'dialog');
    opts.panel.setAttribute('aria-modal', 'true');
    opts.panel.setAttribute('aria-label', opts.label);
    opts.panel.tabIndex = -1;
    const layer = h(`div.ui-layer${opts.sheet ? '.is-sheet' : ''}`, null, scrim, opts.panel);
    const entry: Entry = { layer, opts, restore: document.activeElement, open: true };
    if (opts.dismissible !== false) scrim.addEventListener('click', () => this.close(entry));
    this.stack.push(entry);
    this.root.appendChild(layer);
    void layer.offsetWidth; // commit the closed state so the transition runs
    layer.classList.add('is-open');
    const first = opts.panel.querySelector<HTMLElement>('[data-autofocus]') ?? opts.panel;
    first.focus({ preventScroll: true });
    this.onChange(true);
    return {
      layer,
      close: () => this.close(entry),
      get isOpen() {
        return entry.open;
      },
    };
  }

  closeTop(): void {
    const top = this.top();
    if (top && top.opts.dismissible !== false) this.close(top);
  }

  closeAll(): void {
    for (const e of [...this.stack]) this.close(e);
  }

  private top(): Entry | undefined {
    for (let i = this.stack.length - 1; i >= 0; i--) if (this.stack[i].open) return this.stack[i];
    return undefined;
  }

  private close(entry: Entry): void {
    if (!entry.open) return;
    entry.open = false;
    const { layer } = entry;
    layer.classList.remove('is-open');
    layer.classList.add('is-closing');
    let done = false;
    const remove = (): void => {
      if (done) return;
      done = true;
      layer.remove();
      const i = this.stack.indexOf(entry);
      if (i >= 0) this.stack.splice(i, 1);
    };
    entry.opts.panel.addEventListener('transitionend', remove, { once: true });
    gsap.delayedCall(CLOSE_FALLBACK_S, remove);
    const back = entry.restore;
    if (back instanceof HTMLElement && document.contains(back)) back.focus({ preventScroll: true });
    entry.opts.onClose?.();
    this.onChange(this.anyOpen);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const top = this.top();
    if (!top) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      this.closeTop();
      return;
    }
    if (e.key === 'Tab') {
      const all = top.opts.panel.querySelectorAll<HTMLElement>(FOCUSABLE);
      const items = [...all].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === top.opts.panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    // keep game hotkeys (space / enter) from reaching the HUD while a modal is up
    if ((e.code === 'Space' || e.key === 'Enter') && !(document.activeElement instanceof HTMLButtonElement)) {
      e.stopPropagation();
    }
  };
}
