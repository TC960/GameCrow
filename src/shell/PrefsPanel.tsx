import { usePrefs } from "../../ui/kit";

/** Theme, four-colour deck and haptics toggles (per device). */
export function PrefsPanel() {
  const [prefs, setPrefs] = usePrefs();
  return (
    <div className="gc-settings">
      <label className="gc-setting">
        <span className="gc-grow">
          <span className="gc-setting-label">Light mode</span>
        </span>
        <input type="checkbox" role="switch" className="gc-switch" checked={prefs.theme === "light"} onChange={(e) => setPrefs({ theme: e.target.checked ? "light" : "dark" })} />
      </label>
      <label className="gc-setting">
        <span className="gc-grow">
          <span className="gc-setting-label">Four-colour suits</span>
          <span className="gc-choice-sub">Blue ♦ and green ♣ for colour-blind friendly cards</span>
        </span>
        <input type="checkbox" role="switch" className="gc-switch" checked={prefs.fourColor} onChange={(e) => setPrefs({ fourColor: e.target.checked })} />
      </label>
      <label className="gc-setting">
        <span className="gc-grow">
          <span className="gc-setting-label">Vibration</span>
          <span className="gc-choice-sub">On your turn and key moments (Android)</span>
        </span>
        <input type="checkbox" role="switch" className="gc-switch" checked={prefs.haptics} onChange={(e) => setPrefs({ haptics: e.target.checked })} />
      </label>
    </div>
  );
}
