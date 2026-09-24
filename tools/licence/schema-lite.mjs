// Dependency-free validator for the JSON Schema (2020-12) subset used by art/manifest.schema.json:
// type (incl. type arrays / "integer"), required, properties, additionalProperties (bool | schema),
// enum, const, pattern, minimum, items, $ref (local "#/..." pointers), format "date-time".
// Unknown keywords are ignored (as JSON Schema requires); descriptions/defaults are annotations.

const typeOf = (v) => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
};
const matchesType = (v, t) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeOf(v) === t);
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

function resolveRef(root, ref) {
  if (!ref.startsWith('#')) throw new Error(`only local $ref supported, got ${ref}`);
  return ref.slice(1).split('/').filter(Boolean).reduce((o, k) => o?.[decodeURIComponent(k.replace(/~1/g, '/').replace(/~0/g, '~'))], root);
}

export function validate(schema, value, root = schema, at = '') {
  const errs = [];
  const err = (msg) => errs.push(`${at || '/'}: ${msg}`);
  if (schema === true || schema === undefined) return errs;
  if (schema === false) { err('not allowed'); return errs; }
  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    if (!target) { err(`unresolved $ref ${schema.$ref}`); return errs; }
    errs.push(...validate(target, value, root, at));
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) { err(`expected ${types.join('|')}, got ${typeOf(value)}`); return errs; }
  }
  if ('const' in schema && JSON.stringify(schema.const) !== JSON.stringify(value)) err(`must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) err(`must be one of ${schema.enum.join(', ')}`);
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) err(`does not match ${schema.pattern}`);
    if (schema.format === 'date-time' && !(DATE_TIME.test(value) && !Number.isNaN(Date.parse(value)))) err('not an RFC 3339 date-time');
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) err(`must be >= ${schema.minimum}`);
  if (Array.isArray(value) && schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, root, `${at}/${i}`)));
  if (typeOf(value) === 'object') {
    for (const k of schema.required ?? []) if (!(k in value)) err(`missing required property '${k}'`);
    const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value)) {
      if (k in props) errs.push(...validate(props[k], v, root, `${at}/${k}`));
      else if (schema.additionalProperties === false) err(`unexpected property '${k}'`);
      else if (typeof schema.additionalProperties === 'object') errs.push(...validate(schema.additionalProperties, v, root, `${at}/${k}`));
    }
  }
  return errs;
}
