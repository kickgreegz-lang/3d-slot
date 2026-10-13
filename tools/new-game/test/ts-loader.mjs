// Resolve hook: './spec' -> './spec.ts' for the engine sources under test (no bundler needed).
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
    throw err;
  }
}
