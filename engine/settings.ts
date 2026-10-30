import type { SettingField, SettingsValues, SettingValue } from "./types";

/** Default values for a schema. */
export function defaultSettings(schema: readonly SettingField[]): SettingsValues {
  const out: SettingsValues = {};
  for (const f of schema) out[f.key] = Array.isArray(f.default) ? [...f.default] : f.default;
  return out;
}

function resolveField(f: SettingField, raw: unknown): SettingValue {
  switch (f.type) {
    case "number": {
      const n = typeof raw === "number" && Number.isFinite(raw) ? raw : f.default;
      const step = f.step ?? 1;
      const snapped = f.min + Math.round((n - f.min) / step) * step;
      return Math.min(f.max, Math.max(f.min, Number(snapped.toFixed(6))));
    }
    case "boolean":
      return typeof raw === "boolean" ? raw : f.default;
    case "select":
      return typeof raw === "string" && f.options.some((o) => o.value === raw) ? raw : f.default;
    case "multiselect": {
      if (!Array.isArray(raw)) return [...f.default];
      const allowed = new Set(f.options.map((o) => o.value));
      const vals = [...new Set(raw.filter((v): v is string => typeof v === "string" && allowed.has(v)))];
      return vals.length >= (f.minSelected ?? 0) ? vals : [...f.default];
    }
    case "text":
      return typeof raw === "string" ? raw.slice(0, f.maxLength) : f.default;
  }
}

/**
 * Fill defaults, drop unknown keys, clamp/snap numbers, reject unknown options.
 * The result is what setup() and validateSettings() receive. Never throws.
 */
export function resolveSettings(schema: readonly SettingField[], raw: unknown): SettingsValues {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: SettingsValues = {};
  for (const f of schema) out[f.key] = resolveField(f, src[f.key]);
  return out;
}

/** Whether a field is shown given the other values (visibleIf). */
export function isFieldVisible(field: SettingField, values: SettingsValues): boolean {
  if (!field.visibleIf) return true;
  const v = values[field.visibleIf.key];
  return field.visibleIf.in.some((x) => JSON.stringify(x) === JSON.stringify(v));
}

/** Developer check for a schema: unique keys, defaults within range. Returns problems found. */
export function lintSchema(schema: readonly SettingField[]): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  for (const f of schema) {
    if (keys.has(f.key)) problems.push(`duplicate key ${f.key}`);
    keys.add(f.key);
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(f.key)) problems.push(`key ${f.key} must be alphanumeric camelCase`);
    const resolved = resolveField(f, f.default);
    if (JSON.stringify(resolved) !== JSON.stringify(f.default)) problems.push(`default of ${f.key} is out of range`);
    if (f.visibleIf && !schema.some((g) => g.key === f.visibleIf!.key)) {
      problems.push(`visibleIf of ${f.key} points at unknown key ${f.visibleIf.key}`);
    }
  }
  return problems;
}
