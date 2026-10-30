/**
 * Raja Mantri Chor Sipahi UI. Secret roles are shown only inside HoldToReveal; everything else on
 * screen is public info (the guesser, the Raja if revealed, and every role once the guess is made).
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  ActionBar,
  Avatar,
  Banner,
  BigStatus,
  Button,
  ChoiceList,
  GameScreen,
  HoldToReveal,
  PlayerStrip,
  RoleCard,
  Scoreboard,
  Sheet,
  TurnIndicator,
  stripPlayers,
  type GameUIProps,
  type SeatInfo,
} from "../../ui/kit";
import { legalOfType, type PlayerId } from "../../engine";
import type { Action, Role, RoleInfo, RoundResult, View } from "./types";
import "./ui.css";

export default function RajaMantriUI({ view, me, players, legal, active, scores, act, pending }: GameUIProps<View, Action>) {
  const [target, setTarget] = useState<PlayerId | null>(null);
  const [redealOpen, setRedealOpen] = useState(false);
  const width = useAppWidth();

  // A new deal (next round or re-deal) clears the pending accusation.
  const dealKey = `${view.round}:${view.redeals}:${view.phase}`;
  useEffect(() => {
    setTarget(null);
    setRedealOpen(false);
  }, [dealKey]);

  const targets = legalOfType(legal, "guess").map((a) => a.target);
  const canRedeal = legalOfType(legal, "redeal").length > 0;
  const canNext = legalOfType(legal, "nextRound").length > 0;
  const chosen = target !== null && targets.includes(target) ? target : null;

  const nameOf = (id: PlayerId) => (id === me ? "You" : players.find((p) => p.id === id)?.name ?? "?");
  /** Name for the middle of a sentence ("accused you"). */
  const nameIn = (id: PlayerId) => (id === me ? "you" : nameOf(id));
  const info = (role: Role): RoleInfo => view.roleTable.find((r) => r.role === role) ?? { role, name: role, emoji: "❓", points: 0 };
  const guesserInfo = info(view.guesserRole);
  const guessing = view.phase === "guess";
  /** A role everyone at the table may see right now (never the viewer's own secret). */
  const publicRole = (id: PlayerId): Role | null => {
    const r = view.roles[id] ?? null;
    if (!guessing) return r;
    return id === view.guesser || id === view.raja ? r : null;
  };

  const strip = (
    <PlayerStrip
      me={me}
      players={stripPlayers(players, active, (id) => {
        const r = publicRole(id);
        return { sub: `${view.totals[id] ?? 0} pts`, badge: r ? info(r).emoji : undefined };
      })}
    />
  );

  const roundLabel = (
    <div className="g-rajamantri-round gc-label">
      Round {view.round} of {view.totalRounds}
      {view.redeals > 0 && ` · re-dealt ${view.redeals}×`}
    </div>
  );

  const myRoleCard = me && view.myRole && (
    <HoldToReveal label="Hold to see your role" hint="Release to hide · keep it secret">
      <RoleCard emoji={info(view.myRole).emoji} title={info(view.myRole).name} subtitle={roleHint(view, view.myRole, info, guesserInfo)} />
    </HoldToReveal>
  );

  const accuse = () => chosen && act({ type: "guess", target: chosen }).then((ok) => ok && setTarget(null));
  const guesserName = nameOf(view.guesser);

  let board: ReactNode;
  let bottom: ReactNode;

  if (guessing) {
    board = (
      <div className="g-rajamantri-board">
        {roundLabel}
        {view.amGuesser ? (
          <div className="g-rajamantri-headline">
            <BigStatus>🦹 Who is the Chor?</BigStatus>
            <span className="g-rajamantri-sub">Pick a hidden player, then tap Accuse.</span>
          </div>
        ) : (
          <div className="g-rajamantri-headline">
            <BigStatus>
              {guesserInfo.emoji} {guesserName} {view.guesser === me ? "are" : "is"} choosing…
            </BigStatus>
            <span className="g-rajamantri-sub">The {guesserInfo.name} must find the 🦹 Chor.</span>
          </div>
        )}

        {!view.amGuesser && myRoleCard}
        {me === null && <Banner>You're watching. Roles are revealed after the guess.</Banner>}

        {view.amGuesser ? (
          <div className="g-rajamantri-section">
            <span className="gc-label">Suspects</span>
            <ChoiceList
              label="Who is the Chor?"
              value={chosen}
              onChange={setTarget}
              options={view.hiddenPlayers.map((id) => ({
                value: id,
                label: (
                  <>
                    <strong>{nameOf(id)}</strong>
                    {chosen === id && <span className="g-rajamantri-sub"> · 👉 your pick</span>}
                  </>
                ),
                icon: <PlayerAvatar id={id} players={players} />,
                disabled: !targets.includes(id),
              }))}
            />
            {view.raja && (
              <span className="g-rajamantri-sub gc-center gc-small">
                {info("raja").emoji} {nameOf(view.raja)} {view.raja === me ? "are" : "is"} the Raja and can't be accused.
              </span>
            )}
          </div>
        ) : (
          <div className="g-rajamantri-section">
            <span className="gc-label">Players</span>
            <Roster
              view={view}
              me={me}
              players={players}
              rows={players.map((p) => p.id)}
              role={publicRole}
              info={info}
              nameOf={nameOf}
            />
          </div>
        )}

        {view.amGuesser && myRoleCard}
        <RoleChips roles={view.roleTable} />
        {canRedeal && (
          <Button variant="ghost" size="sm" className="g-rajamantri-redeal" onClick={() => setRedealOpen(true)}>
            ↻ Re-deal this round…
          </Button>
        )}
      </div>
    );
    bottom = (
      <>
        <TurnIndicator
          active={active}
          me={me}
          players={players}
          text={view.amGuesser ? "Your turn: find the Chor" : `${guesserName} ${view.guesser === me ? "are" : "is"} choosing…`}
        />
        {view.amGuesser && (
          <ActionBar>
            <Button variant="primary" size="lg" disabled={pending || chosen === null} onClick={accuse}>
              {chosen ? `Accuse ${nameOf(chosen)}` : "Pick a suspect"}
            </Button>
          </ActionBar>
        )}
      </>
    );
  } else {
    const result = view.lastResult;
    const over = view.phase === "over";
    // Per-round columns: the latest rounds that fit the phone width, so Total never scrolls away.
    const fit = Math.max(1, Math.floor((width - 196) / 52));
    const shown = view.history.slice(-fit);
    const columns = shown.map((r) => ({ label: `R${r.round}`, values: r.points }));
    const scoreTable = (
      <div className="g-rajamantri-section">
        <span className="gc-label">
          {over ? "Final scores" : "Scores"}
          {shown.length < view.history.length && ` · last ${shown.length} rounds`}
        </span>
        <Scoreboard scores={scores} players={players} me={me} columns={columns} />
      </div>
    );
    const leaders = scores.filter((s) => s.rank === 1);
    board = (
      <div className="g-rajamantri-board">
        {over ? (
          <div className="g-rajamantri-headline">
            <BigStatus>🏆 Game over</BigStatus>
            <span className="g-rajamantri-sub">
              {leaders.length === 1
                ? `${nameOf(leaders[0].playerId)} ${leaders[0].playerId === me ? "win" : "wins"} with ${leaders[0].score} points!`
                : `${leaders.map((l) => nameOf(l.playerId)).join(" & ")} tie with ${leaders[0]?.score ?? 0} points!`}
            </span>
          </div>
        ) : (
          roundLabel
        )}
        {over && scoreTable}
        {result && <ResultBlock result={result} view={view} me={me} players={players} info={info} nameOf={nameOf} nameIn={nameIn} over={over} />}
        {!over && scoreTable}
      </div>
    );
    bottom = over ? (
      <TurnIndicator active={[]} me={me} players={players} text="Game over" />
    ) : canNext ? (
      <>
        <TurnIndicator active={[]} me={me} players={players} text={view.isLastRound ? "That was the last round" : `Round ${view.round} done`} />
        <ActionBar>
          <Button variant="primary" size="lg" disabled={pending} onClick={() => act({ type: "nextRound" })}>
            {view.isLastRound ? "See final results" : "Next round"}
          </Button>
        </ActionBar>
      </>
    ) : (
      <TurnIndicator active={[]} me={me} players={players} text={view.isLastRound ? "Waiting for host to finish the game" : "Waiting for host to start the next round"} />
    );
  }

  return (
    <>
      <GameScreen top={strip} board={board} bottom={bottom} />
      <Sheet open={redealOpen && canRedeal} onClose={() => setRedealOpen(false)} title="Re-deal this round?">
        <div className="gc-stack">
          <p className="gc-muted" style={{ margin: 0 }}>
            Use this only if {guesserName} is away or stuck. Everyone gets new roles for round {view.round}; nobody
            scores.
          </p>
          <Button
            variant="danger"
            block
            disabled={pending}
            onClick={() => act({ type: "redeal" }).then(() => setRedealOpen(false))}
          >
            Re-deal roles
          </Button>
          <Button variant="ghost" block onClick={() => setRedealOpen(false)}>
            Cancel
          </Button>
        </div>
      </Sheet>
    </>
  );
}

/** Width of the phone-width app column (it never grows past 480px). */
function useAppWidth(): number {
  const read = () => Math.min(window.innerWidth, 480);
  const [w, setW] = useState(read);
  useEffect(() => {
    const on = () => setW(read());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

/** Short goal line under the player's own role (only rendered while held). */
function roleHint(view: View, role: Role, info: (r: Role) => RoleInfo, guesser: RoleInfo): string {
  const pts = info(role).points;
  if (view.amGuesser) return `Find the Chor: ${pts} pts if right, 0 if wrong.`;
  if (role === "chor") {
    return view.settings.wrongGuess === "swap"
      ? `Stay hidden! If the ${guesser.name} guesses wrong, you get ${guesser.points} pts.`
      : `Stay hidden! You score ${pts} pts.`;
  }
  return `${pts} pts this round.`;
}

function PlayerAvatar({ id, players }: { id: PlayerId; players: SeatInfo[] }) {
  const p = players.find((x) => x.id === id);
  return <Avatar id={id} name={p?.name ?? "?"} isBot={p?.isBot} />;
}

function RoleLabel({ role, info }: { role: Role | null; info: (r: Role) => RoleInfo }) {
  if (!role) return <span className="g-rajamantri-role g-rajamantri-role--hidden">❓ Hidden</span>;
  const i = info(role);
  return (
    <span className="g-rajamantri-role">
      {i.emoji} {i.name}
    </span>
  );
}

/** Player rows with their (public) role, optional tags and points. */
function Roster({
  view,
  me,
  players,
  rows,
  role,
  info,
  nameOf,
  tags,
  points,
}: {
  view: View;
  me: PlayerId | null;
  players: SeatInfo[];
  rows: PlayerId[];
  role: (id: PlayerId) => Role | null;
  info: (r: Role) => RoleInfo;
  nameOf: (id: PlayerId) => string;
  tags?: (id: PlayerId) => string;
  points?: Record<PlayerId, number>;
}) {
  return (
    <ul className="g-rajamantri-roster">
      {rows.map((id) => {
        const tag = tags ? tags(id) : id === view.guesser ? "🔍 Guessing" : "";
        return (
          <li
            key={id}
            className={[
              "g-rajamantri-row",
              id === me && "g-rajamantri-row--me",
              view.phase === "guess" && id === view.guesser && "g-rajamantri-row--guesser",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <PlayerAvatar id={id} players={players} />
            <span className="g-rajamantri-who">
              <span className="g-rajamantri-name">{nameOf(id)}</span>
              {tag && <span className="g-rajamantri-tags">{tag}</span>}
            </span>
            <RoleLabel role={role(id)} info={info} />
            {points && (
              <span className={`g-rajamantri-pts ${points[id] ? "" : "g-rajamantri-pts--zero"}`}>
                {points[id] ? `+${points[id]}` : "0"}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The round's outcome: headline, my points, and every player's role and points. */
function ResultBlock({
  result,
  view,
  me,
  players,
  info,
  nameOf,
  nameIn,
  over,
}: {
  result: RoundResult;
  view: View;
  me: PlayerId | null;
  players: SeatInfo[];
  info: (r: Role) => RoleInfo;
  nameOf: (id: PlayerId) => string;
  nameIn: (id: PlayerId) => string;
  over: boolean;
}) {
  const g = nameOf(result.guesser);
  const gRole = info(result.roles[result.guesser]);
  const order = view.roleTable.map((r) => r.role);
  const rows = players
    .map((p) => p.id)
    .filter((id) => result.roles[id])
    .sort((a, b) => order.indexOf(result.roles[a]) - order.indexOf(result.roles[b]));
  const tags = (id: PlayerId) => {
    const t: string[] = [];
    if (id === result.guesser) t.push(result.correct ? "🔍 Guessed right" : "🔍 Guessed wrong");
    if (id === result.accused && !result.correct) t.push("👉 Wrongly accused");
    if (id === result.chor) t.push(result.correct ? "🚨 Caught" : "😈 Got away");
    return t.join(" · ");
  };
  const swap = !result.correct && view.settings.wrongGuess === "swap";
  return (
    <div className="g-rajamantri-section">
      {over && <span className="gc-label">Last round ({result.round})</span>}
      <div className="g-rajamantri-headline">
        <BigStatus>{result.correct ? `✅ ${g} caught the Chor!` : `❌ Wrong guess!`}</BigStatus>
        <span className="g-rajamantri-sub">
          {result.correct
            ? `${g} (${gRole.emoji} ${gRole.name}) accused ${nameIn(result.chor)}, the 🦹 Chor.`
            : `${g} (${gRole.emoji} ${gRole.name}) accused ${nameIn(result.accused)}. The 🦹 Chor was ${nameIn(result.chor)}${
                swap ? `, who takes the ${gRole.name}'s ${gRole.points} points.` : "."
              }`}
        </span>
      </div>
      {me && result.roles[me] && (
        <Banner tone="accent">
          You were {info(result.roles[me]).emoji} {info(result.roles[me]).name} and scored{" "}
          <strong>{result.points[me] ? `+${result.points[me]}` : "0"}</strong> this round.
        </Banner>
      )}
      <Roster
        view={view}
        me={me}
        players={players}
        rows={rows}
        role={(id) => result.roles[id] ?? null}
        info={info}
        nameOf={nameOf}
        tags={tags}
        points={result.points}
      />
    </div>
  );
}

/** The roles in play this match and their points. */
function RoleChips({ roles }: { roles: RoleInfo[] }) {
  return (
    <div className="g-rajamantri-section">
      <span className="gc-label gc-center">Roles this game</span>
      <div className="g-rajamantri-chips">
        {roles.map((r) => (
          <span key={r.role} className="g-rajamantri-chip">
            {r.emoji} {r.name} {r.points}
          </span>
        ))}
      </div>
    </div>
  );
}
