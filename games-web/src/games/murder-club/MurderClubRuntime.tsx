import { useEffect, useMemo, useState } from "react";
import {
  castMurderClubEvidenceVote,
  castMurderClubSuspectVote,
  continueMurderClub,
  getMurderClubState,
  initMurderClub,
  playAgainMurderClub,
  setMurderClubTheme,
  type MurderClubState
} from "../../lib/murderClubApi";
import {
  getMurderClubThemeById,
  getRandomMurderClubThemeId
} from "./themes";

type MurderClubRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

type EvidenceChoice = "admit" | "reject" | null;

function findPlayerName(state: MurderClubState, playerId: string | null): string {
  if (!playerId) {
    return "";
  }
  return state.players.find((player) => player.id === playerId)?.name || "";
}

function isWaitingOnYou(state: MurderClubState): boolean {
  return state.waitingOn.includes(state.you.id);
}

export default function MurderClubRuntime({ gameCode, playerToken }: MurderClubRuntimeProps) {
  const [state, setState] = useState<MurderClubState | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");
  const [selectedSuspectId, setSelectedSuspectId] = useState<string>("");
  const [selectedEvidenceVote, setSelectedEvidenceVote] = useState<EvidenceChoice>(null);
  const [didSubmitSuspectVote, setDidSubmitSuspectVote] = useState<boolean>(false);
  const [didSubmitEvidenceVote, setDidSubmitEvidenceVote] = useState<boolean>(false);

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      try {
        const next = await initMurderClub(gameCode, playerToken);
        if (!active) {
          return;
        }
        setState(next);
        setErrorText("");
      } catch (error) {
        if (!active) {
          return;
        }
        setErrorText((error as Error).message || "Failed to load game runtime.");
      }
    };

    void bootstrap();

    const interval = window.setInterval(async () => {
      try {
        const next = await getMurderClubState(gameCode, playerToken);
        if (!active) {
          return;
        }
        setState(next);
      } catch {
        // retain current state on transient poll errors
      }
    }, 1200);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [gameCode, playerToken]);

  useEffect(() => {
    if (!state) {
      return;
    }
    if (state.phase !== "suspect_vote") {
      setDidSubmitSuspectVote(false);
      setSelectedSuspectId("");
    }
    if (state.phase !== "evidence_vote") {
      setDidSubmitEvidenceVote(false);
      setSelectedEvidenceVote(null);
    }
  }, [state?.phase]);

  const theme = useMemo(() => (state ? getMurderClubThemeById(state.themeId) : null), [state]);
  const currentEvidence = useMemo(() => {
    if (!state || !theme) {
      return "";
    }
    if (theme.evidences.length === 0) {
      return "No evidence found.";
    }
    const index = state.evidenceIndex % theme.evidences.length;
    return theme.evidences[index];
  }, [state, theme]);

  const conspiratorNames = useMemo(() => {
    if (!state || state.you.role !== "conspirator") {
      return [];
    }
    return state.players
      .filter((player) => state.you.conspiratorIds.includes(player.id) && player.id !== state.you.id)
      .map((player) => player.name);
  }, [state]);

  async function doContinue() {
    if (!state || busy) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await continueMurderClub(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  async function doRespinTheme() {
    if (!state || busy || !state.you.isHost) {
      return;
    }
    const nextThemeId = getRandomMurderClubThemeId(state.themeId);
    setBusy(true);
    setErrorText("");
    try {
      const next = await setMurderClubTheme(gameCode, playerToken, nextThemeId);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to re-spin theme.");
    } finally {
      setBusy(false);
    }
  }

  async function doVoteSuspect() {
    if (!state || busy || state.phase !== "suspect_vote" || !selectedSuspectId) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await castMurderClubSuspectVote(gameCode, playerToken, selectedSuspectId);
      setState(next);
      setDidSubmitSuspectVote(true);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to cast suspect vote.");
    } finally {
      setBusy(false);
    }
  }

  async function doVoteEvidence() {
    if (!state || busy || state.phase !== "evidence_vote" || !selectedEvidenceVote) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await castMurderClubEvidenceVote(gameCode, playerToken, selectedEvidenceVote);
      setState(next);
      setDidSubmitEvidenceVote(true);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to cast evidence vote.");
    } finally {
      setBusy(false);
    }
  }

  async function doPlayAgain() {
    if (!state || busy || !state.you.isHost) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await playAgainMurderClub(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to start another game.");
    } finally {
      setBusy(false);
    }
  }

  if (!state || !theme) {
    return (
      <section className="runtime-card">
        <h2>Murder Club</h2>
        <p>Loading game...</p>
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </section>
    );
  }

  const suspectName = findPlayerName(state, state.suspectPlayerId);

  return (
    <section className="runtime-card runtime-flow">
      {state.phase === "rules" && (
        <>
          <h2>{theme.title}</h2>
          <p>{theme.openingScene}</p>

          {state.you.isHost ? (
            <button type="button" className="btn btn-soft runtime-reroll-btn" onClick={() => void doRespinTheme()} disabled={busy}>
              Re-spin theme
            </button>
          ) : (
            <button type="button" className="btn btn-soft runtime-reroll-btn" disabled>
              Host can re-spin
            </button>
          )}

          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy ? "Loading..." : isWaitingOnYou(state) ? "Continue" : "Waiting for others..."}
          </button>
        </>
      )}

      {state.phase === "role_reveal" && (
        <>
          {state.you.role === "conspirator" ? (
            <>
              <h2>Your role, Murderer</h2>
              <p>Your team, Conspirators</p>
              <p>Do not reveal your role or team.</p>
              <p>Prevent evidence from being admitted. 3 blocks wins for conspirators.</p>
              {conspiratorNames.length > 0 && (
                <p>Other conspirators: {conspiratorNames.join(", ")}</p>
              )}
            </>
          ) : (
            <>
              <h2>Your role, Investigator</h2>
              <p>Your team, Investigators</p>
              <p>Find the conspirators and submit real evidence to the case file.</p>
              <p>3 evidence submits wins for investigators.</p>
            </>
          )}
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy ? "Loading..." : isWaitingOnYou(state) ? "Ready" : "Waiting for others..."}
          </button>
        </>
      )}

      {state.phase === "round_ready" && (
        <>
          <h2>Ready to begin?</h2>
          <p>Round {state.roundNumber}</p>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy ? "Loading..." : isWaitingOnYou(state) ? "Begin" : "Waiting for all players to click begin..."}
          </button>
        </>
      )}

      {state.phase === "evidence_reveal" && (
        <>
          <h2>Until...</h2>
          <div className="link-card">
            <p><b>New evidence:</b></p>
            <p>{currentEvidence}</p>
          </div>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy ? "Loading..." : isWaitingOnYou(state) ? "Understood" : "Waiting for all players to click continue..."}
          </button>
        </>
      )}

      {state.phase === "suspect_vote" && (
        <>
          {didSubmitSuspectVote ? (
            <>
              <h2>Loading votes...</h2>
              <p>Waiting for all players to vote.</p>
            </>
          ) : (
            <>
              <h2>Discuss, suspect selection...</h2>
              <p>Place suspicion. Choose one player.</p>
              <div className="player-grid">
                {state.players.map((player) => (
                  <button
                    key={player.id}
                    type="button"
                    className="btn btn-soft"
                    onClick={() => setSelectedSuspectId(player.id)}
                    style={selectedSuspectId === player.id ? { borderColor: "#f4dd44" } : undefined}
                  >
                    {player.name}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-key" onClick={() => void doVoteSuspect()} disabled={busy || !selectedSuspectId}>
                Vote
              </button>
              <p>Waiting for all players to vote...</p>
            </>
          )}
        </>
      )}

      {state.phase === "suspect_result" && (
        <>
          {state.suspectVoteResult === "hung" ? (
            <>
              <h2>Hung vote!</h2>
              <p>There was a tie in the suspect vote. Discuss and re-vote to reach a majority.</p>
            </>
          ) : (
            <>
              <h2>{suspectName} is under suspicion...</h2>
              <p>They cannot speak or vote during the evidence decision.</p>
            </>
          )}

          <div className="player-grid">
            {state.players.map((player) => {
              const count = state.suspectCounts.find((entry) => entry.playerId === player.id)?.count ?? 0;
              return (
                <div
                  key={player.id}
                  className="player-pill"
                  style={
                    state.suspectPlayerId === player.id
                      ? { borderColor: "#f4dd44", color: "#f4dd44" }
                      : undefined
                  }
                >
                  {player.name} {count > 0 ? `(${count})` : ""}
                </div>
              );
            })}
          </div>

          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy ? "Loading..." : isWaitingOnYou(state) ? (state.suspectVoteResult === "hung" ? "Vote again" : "Continue") : "Waiting for all players to click continue..."}
          </button>
        </>
      )}

      {state.phase === "evidence_vote" && (
        <>
          <h2>Evidence vote...</h2>
          <p>Should this evidence be added to the case files?</p>
          <div className="link-card">
            <p><b>{currentEvidence}</b></p>
          </div>

          <div className="bottom-row">
            <p>Conspirators, evidence blocks: {state.conspiratorScore}/{state.targetScore}</p>
            <p>Investigators, evidence submits: {state.investigatorScore}/{state.targetScore}</p>
          </div>

          {state.you.isUnderSuspicion ? (
            <>
              <p className="hint-text error-text">You are under suspicion. You can not talk or vote.</p>
              <p>Waiting for all players to vote...</p>
            </>
          ) : didSubmitEvidenceVote ? (
            <>
              <h2>Loading votes...</h2>
              <p>Waiting for all players to vote...</p>
            </>
          ) : (
            <>
              <p>Two voting cards are dealt at random to all players.</p>
              <div className="bottom-row">
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => setSelectedEvidenceVote("reject")}
                  disabled={state.you.evidenceCard !== "reject"}
                  style={selectedEvidenceVote === "reject" ? { borderColor: "#ff7070" } : undefined}
                >
                  Reject evidence
                </button>
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => setSelectedEvidenceVote("admit")}
                  disabled={state.you.evidenceCard !== "admit"}
                  style={selectedEvidenceVote === "admit" ? { borderColor: "#86e484" } : undefined}
                >
                  Admit evidence
                </button>
              </div>
              <button type="button" className="btn btn-key" onClick={() => void doVoteEvidence()} disabled={busy || !selectedEvidenceVote}>
                Vote
              </button>
            </>
          )}
        </>
      )}

      {state.phase === "evidence_result" && (
        <>
          {state.evidenceVoteResult === "admitted" && (
            <>
              <h2>Evidence admitted...</h2>
              <p>The evidence will be added to the case file.</p>
            </>
          )}
          {state.evidenceVoteResult === "rejected" && (
            <>
              <h2>Evidence rejected...</h2>
              <p>The evidence will not be added to the case file.</p>
            </>
          )}
          {state.evidenceVoteResult === "hung" && (
            <>
              <h2>Hung vote!</h2>
              <p>There was a tie in the evidence vote. Discuss and re-vote.</p>
            </>
          )}

          <div className="bottom-row">
            <p>Conspirators, evidence blocks: {state.conspiratorScore}/{state.targetScore}</p>
            <p>Investigators, evidence submits: {state.investigatorScore}/{state.targetScore}</p>
          </div>

          <div className="player-grid">
            {state.players.map((player) => (
              <div key={player.id} className="player-pill">
                {player.name}
              </div>
            ))}
          </div>

          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou(state)}>
            {busy
              ? "Loading..."
              : isWaitingOnYou(state)
                ? state.investigatorScore >= state.targetScore || state.conspiratorScore >= state.targetScore
                  ? "Finish"
                  : `Continue to Round ${state.roundNumber + 1}`
                : "Waiting for all players to click continue..."}
          </button>
        </>
      )}

      {state.phase === "result" && (
        <>
          <h2>
            {state.investigatorScore >= state.targetScore
              ? "Investigators win!"
              : "Conspirators win!"}
          </h2>
          <p>Investigators, evidence submits: {state.investigatorScore}/{state.targetScore}</p>
          <p>Conspirators, evidence blocks: {state.conspiratorScore}/{state.targetScore}</p>

          {state.you.isHost ? (
            <button type="button" className="btn btn-key" onClick={() => void doPlayAgain()} disabled={busy}>
              Play again
            </button>
          ) : (
            <button type="button" className="btn btn-key" disabled>
              Ask host to play again
            </button>
          )}
        </>
      )}

      {(state.lastLine || state.lastError || errorText) && (
        <p className="hint-text error-text">{state.lastError || errorText || state.lastLine}</p>
      )}
    </section>
  );
}
