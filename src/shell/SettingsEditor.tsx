/** Renders a game's house-rule schema. Read-only for non-hosts. */
import { isFieldVisible, resolveSettings } from "../../engine/settings";
import type { SettingField, SettingsValues } from "../../engine/types";
import { haptic } from "../../ui/kit";

export function SettingsEditor({
  schema,
  values,
  onChange,
  readOnly,
}: {
  schema: SettingField[];
  values: unknown;
  onChange?: (next: SettingsValues) => void;
  readOnly?: boolean;
}) {
  const resolved = resolveSettings(schema, values);
  const set = (key: string, v: unknown) => {
    haptic("tap");
    onChange?.(resolveSettings(schema, { ...resolved, [key]: v }));
  };
  if (schema.length === 0) return <p className="gc-muted gc-small">This game has no house rules.</p>;

  let lastGroup: string | undefined;
  return (
    <div className="gc-settings">
      {schema.map((f) => {
        if (!isFieldVisible(f, resolved)) return null;
        const header = f.group && f.group !== lastGroup ? <div className="gc-label gc-settings-group">{f.group}</div> : null;
        lastGroup = f.group ?? lastGroup;
        return (
          <div key={f.key}>
            {header}
            <Field field={f} value={resolved[f.key]} set={(v) => set(f.key, v)} readOnly={readOnly} />
          </div>
        );
      })}
    </div>
  );
}

function Field({ field: f, value, set, readOnly }: { field: SettingField; value: unknown; set: (v: unknown) => void; readOnly?: boolean }) {
  const label = (
    <span className="gc-grow">
      <span className="gc-setting-label">{f.label}</span>
      {f.help && <span className="gc-choice-sub">{f.help}</span>}
    </span>
  );
  switch (f.type) {
    case "number": {
      const n = value as number;
      const step = f.step ?? 1;
      return (
        <div className="gc-setting">
          {label}
          <div className="gc-stepper">
            <button type="button" aria-label={`Decrease ${f.label}`} disabled={readOnly || n <= f.min} onClick={() => set(n - step)}>
              −
            </button>
            <output aria-live="polite">{n}</output>
            <button type="button" aria-label={`Increase ${f.label}`} disabled={readOnly || n >= f.max} onClick={() => set(n + step)}>
              +
            </button>
          </div>
        </div>
      );
    }
    case "boolean":
      return (
        <label className="gc-setting">
          {label}
          <input
            type="checkbox"
            role="switch"
            className="gc-switch"
            checked={value as boolean}
            disabled={readOnly}
            onChange={(e) => set(e.target.checked)}
          />
        </label>
      );
    case "select":
      return (
        <div className="gc-setting gc-setting--column">
          {label}
          <div className="gc-segments" role="radiogroup" aria-label={f.label}>
            {f.options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={value === o.value}
                className={`gc-segment ${value === o.value ? "gc-segment--on" : ""}`}
                disabled={readOnly}
                onClick={() => set(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      );
    case "multiselect": {
      const vals = value as string[];
      return (
        <div className="gc-setting gc-setting--column">
          {label}
          <div className="gc-segments">
            {f.options.map((o) => {
              const on = vals.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  className={`gc-segment ${on ? "gc-segment--on" : ""}`}
                  disabled={readOnly}
                  onClick={() => set(on ? vals.filter((v) => v !== o.value) : [...vals, o.value])}
                >
                  {on ? "✓ " : ""}
                  {o.label}
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case "text":
      return (
        <div className="gc-setting gc-setting--column">
          {label}
          {f.multiline ? (
            <textarea
              className="gc-input"
              value={value as string}
              maxLength={f.maxLength}
              placeholder={f.placeholder}
              disabled={readOnly}
              onChange={(e) => set(e.target.value)}
            />
          ) : (
            <input
              className="gc-input"
              value={value as string}
              maxLength={f.maxLength}
              placeholder={f.placeholder}
              disabled={readOnly}
              onChange={(e) => set(e.target.value)}
            />
          )}
        </div>
      );
  }
}
