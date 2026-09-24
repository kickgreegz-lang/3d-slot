import type { Container, Filter } from 'pixi.js';

/**
 * Live-filter budget (ctx.budget.maxFilters: 3 high tier, 1 low tier). Every
 * transient FX filter goes through `tryAddFilter` / `removeFilter` so the total
 * number of filters applied by FX/presentation never exceeds the tier budget.
 * Filters are appended to a container's existing list (never replacing other
 * modules' filters) and use resolution 0.5 + a fixed filterArea (set by callers).
 */
let max = 3;
let live = 0;

export const configureFilterBudget = (maxFilters: number): void => {
  max = maxFilters;
};

export const filterSlotsFree = (): number => Math.max(0, max - live);

/** Append `filter` to `target.filters` if the budget allows. Returns success. */
export const tryAddFilter = (target: Container, filter: Filter): boolean => {
  if (live >= max) return false;
  const list = target.filters ? [...(target.filters as Filter[])] : [];
  list.push(filter);
  target.filters = list;
  live++;
  return true;
};

export const removeFilter = (target: Container, filter: Filter): void => {
  const list = target.filters ? [...(target.filters as Filter[])] : [];
  const i = list.indexOf(filter);
  if (i < 0) return;
  list.splice(i, 1);
  target.filters = list.length ? list : null;
  live = Math.max(0, live - 1);
};
