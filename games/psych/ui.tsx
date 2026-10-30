/** Psych UI: prompt card, write a fake answer, vote anonymously, reveal who fooled whom. */
import { useEffect, useState, type ReactNode } from "react";
import {
  ActionBar,
  Avatar,
  Banner,
  BigStatus,
  Button,
  ChoiceList,
  Countdown,
  GameScreen,
  PlayerStrip,
  Scoreboard,
  TextEntry,
  TurnIndicator,
  stripPlayers,
  type Choice,
  type GameUIProps,
  type SeatInfo,
} from "../../ui/kit";
import { legalOfType } from "../../engine";
import type { PlayerId } from "../../engine";
import type { Action, RevealInfo, RevealOption, View } from "./types";
import "./ui.css";

/** Same as types.ts BLANK (kept local: ui.tsx only imports types from ./types). */
const BLANK = "___";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function PsychUI({ view, me, players, legal, active, isHost, scores, over, deadline, act, pending }: GameUIProps<View, Action>) {
  const [draft, setDraft] = useState("");
  const [pick, setPick] = useState<string | null>(null);

  // Fresh input and selection every round / phase.
  useEffect(() => {
    setDraft("");
    setPick(null);
  }, [view.round, view.phase]);

  const name = (id: PlayerId) => (id === me ? "You" : players.find((p) => p.id === id)?.name ?? "?");
  const names = (ids: PlayerId[]) => ids.map(name).join(", ");

  const canAnswer = legalOfType(legal, "answer").length > 0;
  const votable = new Set(legalOfType(legal, "vote").map((a) => a.option));
  const canSkip = legalOfType(legal, "skip").length > 0;
  const canNext = legalOfType(legal, "nextRound").length > 0;
  const phase = over ? "over" : view.phase;

  const answersLeft = Math.max(0, view.answerTarget - view.answeredCount);
  const votesLeft = view.voters.filter((id) => !view.voted[id]).length;
  const amVoter = me !== null && view.voters.includes(me);

  const badge = (id: PlayerId): ReactNode => {
    if (phase === "answer") return view.answered[id] ? "✓" : undefined;
    if (phase === "vote") return view.voters.includes(id) ? (view.voted[id] ? "✓" : undefined) : "—";
    if (phase === "reveal" || phase === "over") {
      const pts = view.reveal?.roundPoints[id] ?? 0;
      return pts > 0 ? `+${pts}` : undefined;
    }
    return undefined;
  };

  // ---------- Board ----------
  const header = (
    <div className="g-psych-meta">
      <span className="gc-label">{phase === "over" ? "Final round" : `Round ${view.round} of ${view.totalRounds}`}</span>
      <span className="g-psych-chip">{view.sourceLabel}</span>
      <span className="gc-grow" />
      {deadline && (phase === "answer" || phase === "vote") && <Countdown deadline={deadline} label="⏱" />}
    </div>
  );

  const prompt = (
    <div className="g-psych-prompt" role="heading" aria-level={2}>
      <PromptText text={view.promptText} subjectName={view.kind === "friends" ? view.subjectName : null} />
      {view.kind === "friends" && view.iAmSubject && <span className="g-psych-prompt-sub">This one's about you!</span>}
    </div>
  );

  let body: ReactNode = null;
  if (phase === "answer") {
    body = (
      <div className="gc-stack">
        {view.myAnswer !== null ? (
          <>
            <MyAnswer text={view.myAnswer} label={view.writeTruth ? "Your true answer" : "Your answer"} />
            <BigStatus>{answersLeft > 0 ? `Waiting for ${plural(answersLeft, "answer")}` : "All answers in!"}</BigStatus>
          </>
        ) : canAnswer ? (
          <Banner tone="accent">
            {view.writeTruth
              ? "You're the subject: write the TRUE answer. Others score by spotting it."
              : view.truth === "fact"
                ? "Write a fake answer that sounds real. You score when others pick it."
                : view.truth === "subject"
                  ? `${view.subjectName ?? "The subject"} writes the truth. Write a fake that sounds like them: you score when others pick it.`
                  : "There's no right answer: write the one others will pick. You score for every vote."}
          </Banner>
        ) : (
          <BigStatus>
            {view.answeredCount} of {view.answerTarget} answered
          </BigStatus>
        )}
      </div>
    );
  } else if (phase === "vote" && view.options) {
    const canVote = votable.size > 0;
    const voteChoices: Choice[] = view.options.map((o) => ({
      value: o.id,
      label: <span className="g-psych-opt">{o.text}</span>,
      sub: o.isMine ? "your answer" : undefined,
      disabled: pending || !votable.has(o.id),
    }));
    body = (
      <div className="gc-stack">
        <div className="gc-label">
          {canVote ? (view.truth === "none" ? "Pick your favourite" : view.truth === "subject" ? `Which is ${view.subjectName ?? "the subject"}'s real answer?` : "Which one is real?") : view.myVote ? "Your vote is in" : "The answers"}
        </div>
        {me !== null && !amVoter && view.iAmSubject && <Banner>You're the subject, so you don't vote this round. Watch them guess!</Banner>}
        {canVote ? (
          <ChoiceList label="Answers" options={voteChoices} value={pick} onChange={setPick} />
        ) : (
          <div className="g-psych-optlist" role="list" aria-label="Answers">
            {view.options.map((o) => (
              <div key={o.id} role="listitem" className={`g-psych-optcard ${o.id === view.myVote ? "g-psych-optcard--on" : ""}`}>
                <span className="g-psych-opt">{o.text}</span>
                {o.id === view.myVote && <span className="g-psych-optnote g-psych-optnote--on">✓ your vote</span>}
                {o.isMine && <span className="g-psych-optnote">{view.iAmSubject && view.truth === "subject" ? "your truth" : "your answer"}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  } else if ((phase === "reveal" || phase === "over") && view.reveal) {
    body = (
      <div className="gc-stack">
        {phase === "over" && (
          <div className="gc-stack">
            <div className="gc-label">Final scores</div>
            <Scoreboard scores={scores} players={players} me={me} />
            <div className="gc-label">Last round</div>
          </div>
        )}
        <Reveal reveal={view.reveal} view={view} name={name} names={names} players={players} me={me} />
      </div>
    );
  }

  // ---------- Bottom (thumb zone) ----------
  let status: ReactNode;
  if (phase === "over") status = undefined;
  else if (phase === "reveal") status = canNext ? undefined : "Waiting for the host";
  // While typing, the input itself is the call to action: keep the thumb zone small (keyboard!).
  else if (phase === "answer") status = canAnswer ? undefined : view.myAnswer !== null ? "Answer sent ✓" : answersLeft > 0 ? `Waiting for ${plural(answersLeft, "answer")}` : "…";
  else if (phase === "vote") status = votable.size > 0 ? "Your vote" : votesLeft > 0 ? `Waiting for ${plural(votesLeft, "vote")}` : "…";

  const skipButton = canSkip && (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => act({ type: "skip" })}>
      Skip waiting ⏭
    </Button>
  );

  const bottom = (
    <>
      {phase === "over" ? (
        <BigStatus>🏁 Game over</BigStatus>
      ) : (
        status !== undefined && (
          <div className="g-psych-statusrow">
            <TurnIndicator active={active} me={me} players={players} text={status} />
            {skipButton}
          </div>
        )
      )}
      {status === undefined && phase !== "over" && skipButton}
      {phase === "answer" && canAnswer && (
        <TextEntry
          value={draft}
          onChange={setDraft}
          onSubmit={(v) => act({ type: "answer", text: v }).then((ok) => ok && setDraft(""))}
          placeholder={view.writeTruth ? "The true answer…" : view.truth === "fact" ? "Your fake answer…" : "Your answer…"}
          maxLength={view.rules.maxAnswerLength}
          submitLabel="Send"
          disabled={pending}
        />
      )}
      {phase === "vote" && votable.size > 0 && (
        <ActionBar>
          <Button
            variant="primary"
            size="lg"
            disabled={pending || pick === null || !votable.has(pick)}
            onClick={() => pick && act({ type: "vote", option: pick })}
          >
            Vote
          </Button>
        </ActionBar>
      )}
      {phase === "reveal" && canNext && isHost && (
        <ActionBar>
          <Button variant="primary" size="lg" disabled={pending} onClick={() => act({ type: "nextRound" })}>
            {view.isLastRound ? "Finish game" : "Next round"}
          </Button>
        </ActionBar>
      )}
    </>
  );

  return (
    <GameScreen
      top={
        <PlayerStrip
          me={me}
          players={stripPlayers(players, active, (id) => ({
            sub: plural(view.scores[id] ?? 0, "pt"),
            badge: badge(id),
            dim: phase === "vote" && !view.voters.includes(id),
          }))}
        />
      }
      board={
        <div className="g-psych-board">
          {header}
          {prompt}
          {body}
        </div>
      }
      bottom={bottom}
    />
  );
}

/** Prompt text with the blank drawn as a line and the subject's name highlighted. */
function PromptText({ text, subjectName }: { text: string; subjectName: string | null }) {
  const parts: ReactNode[] = [];
  let key = 0;
  text.split(BLANK).forEach((chunk, i) => {
    if (i > 0)
      parts.push(
        <span key={key++} className="g-psych-blank" aria-label="blank">
          {" "}
        </span>,
      );
    if (subjectName) {
      chunk.split(subjectName).forEach((piece, j) => {
        if (j > 0)
          parts.push(
            <mark key={key++} className="g-psych-subject">
              {subjectName}
            </mark>,
          );
        if (piece) parts.push(piece);
      });
    } else if (chunk) parts.push(chunk);
  });
  return <span className="g-psych-prompt-text">{parts}</span>;
}

function MyAnswer({ text, label }: { text: string; label: string }) {
  return (
    <div className="g-psych-mine">
      <span className="gc-label">{label}</span>
      <span className="g-psych-mine-text">{text}</span>
    </div>
  );
}

function Reveal({
  reveal,
  view,
  name,
  names,
  players,
  me,
}: {
  reveal: RevealInfo;
  view: View;
  name: (id: PlayerId) => string;
  names: (ids: PlayerId[]) => string;
  players: SeatInfo[];
  me: PlayerId | null;
}) {
  const realOpt = reveal.options.find((o) => o.isReal);
  // Real answer first, then fakes by votes received.
  const options = reveal.options.slice().sort((a, b) => Number(b.isReal) - Number(a.isReal) || b.voters.length - a.voters.length);
  const ranked = players
    .map((p) => ({ id: p.id, pts: reveal.roundPoints[p.id] ?? 0 }))
    .sort((a, b) => b.pts - a.pts);

  const myPts = me !== null ? reveal.roundPoints[me] ?? 0 : null;
  return (
    <div className="gc-stack">
      {myPts !== null && (
        <div className={`g-psych-you ${myPts > 0 ? "g-psych-you--plus" : ""}`}>
          {myPts > 0 ? `🎉 You scored +${myPts} this round` : "No points for you this round"}
        </div>
      )}
      {reveal.realAnswer !== null && !realOpt && (
        <div className="g-psych-result g-psych-result--real">
          <span className="g-psych-tag g-psych-tag--real">✓ Real answer</span>
          <span className="g-psych-result-text">{reveal.realAnswer}</span>
        </div>
      )}
      {reveal.realAnswer === null && view.truth === "none" && <Banner>No real answer this round: the most convincing answers win.</Banner>}
      {reveal.voteSkipped && <Banner>Not enough answers to vote this round.</Banner>}

      {options.map((o) => (
        <RevealCard key={o.id} o={o} view={view} name={name} names={names} />
      ))}

      {reveal.truthGuessers.length > 0 && (
        <div className="gc-small gc-muted">
          Guessed the truth: {names(reveal.truthGuessers)} (+{view.rules.truthPoints} each)
        </div>
      )}
      {reveal.noAnswer.length > 0 && <div className="gc-small gc-muted">No answer: {names(reveal.noAnswer)}</div>}
      {reveal.noVote.length > 0 && !reveal.voteSkipped && <div className="gc-small gc-muted">No vote: {names(reveal.noVote)}</div>}

      <div className="gc-label">This round</div>
      <div className="g-psych-points" role="list">
        {ranked.map((r) => (
          <span key={r.id} role="listitem" className={`g-psych-pt ${r.pts > 0 ? "g-psych-pt--plus" : ""} ${r.id === me ? "g-psych-pt--me" : ""}`}>
            <Avatar id={r.id} name={players.find((p) => p.id === r.id)?.name ?? "?"} />
            <span className="g-psych-pt-name">{name(r.id)}</span>
            <strong>{r.pts > 0 ? `+${r.pts}` : "0"}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function RevealCard({
  o,
  view,
  name,
  names,
}: {
  o: RevealOption;
  view: View;
  name: (id: PlayerId) => string;
  names: (ids: PlayerId[]) => string;
}) {
  let tag: ReactNode;
  if (o.isReal) {
    tag =
      view.truth === "subject" && o.authors.length > 0 ? (
        <span className="g-psych-tag g-psych-tag--real">✓ The truth, by {name(o.authors[0])}</span>
      ) : (
        <span className="g-psych-tag g-psych-tag--real">✓ Real answer</span>
      );
  } else {
    tag = <span className="g-psych-tag">✎ {o.authors.length ? names(o.authors) : "?"}</span>;
  }
  const pts = o.isReal ? (o.voters.length && view.rules.truthPoints > 0 ? `+${view.rules.truthPoints}${o.voters.length > 1 ? " each" : ""}` : null) : o.pointsPerAuthor > 0 ? `+${o.pointsPerAuthor}${o.authors.length > 1 ? " each" : ""}` : null;
  const youPicked = o.voters.some((v) => name(v) === "You");
  const votersLabel = o.isReal ? "Spotted by" : view.truth === "none" ? "Votes" : "Fooled";
  return (
    <div className={`g-psych-result ${o.isReal ? "g-psych-result--real" : ""} ${o.isMine ? "g-psych-result--mine" : ""}`}>
      <div className="g-psych-result-head">
        {tag}
        {pts && <span className="g-psych-gain">{pts}</span>}
      </div>
      <span className="g-psych-result-text">{o.text}</span>
      <span className="g-psych-voters">
        {o.voters.length === 0
          ? "No votes"
          : `${votersLabel}: ${names(o.voters)}`}
        {youPicked && !o.isReal && view.truth !== "none" && " 😅"}
      </span>
    </div>
  );
}
