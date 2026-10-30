import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button, IconButton, Sheet, useToast } from "../../ui/kit";
import { ROOM_CODE_RE, deviceToken, errorText, lastRoom, navigate, saveName, savedName } from "../lib";
import { PrefsPanel } from "../shell/PrefsPanel";
import { InstallHint } from "../pwa";

export function Home() {
  const toast = useToast();
  const create = useMutation(api.rooms.create);
  const join = useMutation(api.rooms.join);
  const [name, setName] = useState(savedName);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefsOpen] = useState(false);
  const previous = lastRoom();

  const run = async (fn: () => Promise<string>) => {
    if (!name.trim()) return toast("Pick a nickname first", "error");
    setBusy(true);
    try {
      saveName(name);
      navigate(`/r/${await fn()}`);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="gc-header">
        <span className="gc-header-title">🐦‍⬛ GameCrow</span>
        <IconButton aria-label="Display settings" onClick={() => setPrefsOpen(true)}>
          ⚙️
        </IconButton>
      </header>
      <div className="gc-scroll">
        <div className="gc-stack gc-home">
          <div className="gc-hero">
            <img className="gc-hero-logo" src="/icons/icon.svg" alt="" />
            <h1 className="gc-h1">GameCrow</h1>
            <p className="gc-muted">Card & party games for your crew. One room code, everyone's phone.</p>
          </div>

          <label className="gc-stack" style={{ gap: 6 }}>
            <span className="gc-label">Your nickname</span>
            <input
              className="gc-input"
              value={name}
              maxLength={20}
              placeholder="e.g. Priya"
              autoComplete="nickname"
              enterKeyHint="done"
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          <Button variant="primary" size="lg" block disabled={busy} onClick={() => run(async () => (await create({ name, token: deviceToken() })).code)}>
            Create a room
          </Button>

          <div className="gc-divider-text">
            <span>or join friends</span>
          </div>

          <form
            className="gc-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!ROOM_CODE_RE.test(code)) return toast("Room codes are 4 letters", "error");
              run(async () => {
                await join({ code, name, token: deviceToken() });
                return code;
              });
            }}
          >
            <input
              className="gc-input gc-code-input gc-grow"
              value={code}
              maxLength={4}
              placeholder="CODE"
              aria-label="Room code"
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
            />
            <button type="submit" className="gc-btn gc-btn--lg" disabled={busy || code.length !== 4}>
              Join
            </button>
          </form>

          {previous && (
            <Button variant="ghost" block onClick={() => navigate(`/r/${previous}`)}>
              ↩ Back to room {previous}
            </Button>
          )}
          <InstallHint />
          {import.meta.env.DEV && (
            <Button variant="ghost" block onClick={() => navigate("/sandbox")}>
              🧪 Dev sandbox
            </Button>
          )}
        </div>
      </div>
      <Sheet open={prefs} onClose={() => setPrefsOpen(false)} title="Display">
        <PrefsPanel />
      </Sheet>
    </>
  );
}
