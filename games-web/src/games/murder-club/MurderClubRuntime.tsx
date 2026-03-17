import { useEffect, useMemo, useState } from "react";
import {
  castMurderClubMissionVote,
  castMurderClubTeamVote,
  continueMurderClub,
  getMurderClubState,
  initMurderClub,
  playAgainMurderClub,
  setMurderClubTeam,
  type MurderClubState
} from "../../lib/murderClubApi";

type MurderClubRuntimeProps = {
  gameCode: string;
  playerToken: string;
};

export default function MurderClubRuntime({ gameCode, playerToken }: MurderClubRuntimeProps) {
  const [state, setState] = useState<MurderClubState | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string>("");
  const [nowMs, setNowMs] = useState<number>(Date.now());
  const [selectedTeam, setSelectedTeam] = useState<string[]>([]);

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
        // retain current state on transient errors
      }
    }, 1000);

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [gameCode, playerToken]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!state || state.phase !== "team_pick") {
      return;
    }
    setSelectedTeam(state.selectedTeam);
  }, [state?.phase, state?.selectedTeam?.join("|")]);

  const leaderName = useMemo(() => {
    if (!state?.leaderId) {
      return "Leader";
    }
    return state.players.find((player) => player.id === state.leaderId)?.name || "Leader";
  }, [state]);

  const discussionSecondsLeft = useMemo(() => {
    if (!state?.discussionEndsAt) {
      return 0;
    }
    const diff = Math.ceil((new Date(state.discussionEndsAt).getTime() - nowMs) / 1000);
    return Math.max(0, diff);
  }, [state?.discussionEndsAt, nowMs]);

  const leaderPitchSecondsLeft = useMemo(() => {
    if (!state?.discussionLeaderEndsAt) {
      return 0;
    }
    const diff = Math.ceil((new Date(state.discussionLeaderEndsAt).getTime() - nowMs) / 1000);
    return Math.max(0, diff);
  }, [state?.discussionLeaderEndsAt, nowMs]);

  const teamVoteSecondsLeft = useMemo(() => {
    if (!state?.teamVoteEndsAt) {
      return 0;
    }
    const diff = Math.ceil((new Date(state.teamVoteEndsAt).getTime() - nowMs) / 1000);
    return Math.max(0, diff);
  }, [state?.teamVoteEndsAt, nowMs]);

  const missionVoteSecondsLeft = useMemo(() => {
    if (!state?.missionVoteEndsAt) {
      return 0;
    }
    const diff = Math.ceil((new Date(state.missionVoteEndsAt).getTime() - nowMs) / 1000);
    return Math.max(0, diff);
  }, [state?.missionVoteEndsAt, nowMs]);

  const isWaitingOnYou = Boolean(state?.waitingOn.includes(state?.you.id || ""));
  const teamVoteByMe = useMemo(
    () => state?.teamVotes.find((entry) => entry.playerId === state.you.id)?.vote ?? null,
    [state]
  );
  const amLeader = Boolean(state?.you.isLeader);

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

  function toggleTeamMember(playerId: string) {
    if (!state || !amLeader || busy || state.phase !== "team_pick") {
      return;
    }
    const hasPlayer = selectedTeam.includes(playerId);
    if (hasPlayer) {
      setSelectedTeam((old) => old.filter((id) => id !== playerId));
      return;
    }
    if (selectedTeam.length >= state.teamSizeRequired) {
      return;
    }
    setSelectedTeam((old) => [...old, playerId]);
  }

  async function submitTeamPick() {
    if (!state || !amLeader || busy || state.phase !== "team_pick") {
      return;
    }
    if (selectedTeam.length !== state.teamSizeRequired) {
      setErrorText(`Select exactly ${state.teamSizeRequired} players.`);
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await setMurderClubTeam(gameCode, playerToken, selectedTeam);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to set team.");
    } finally {
      setBusy(false);
    }
  }

  async function castTeamVote(vote: "approve" | "reject") {
    if (!state || busy || state.phase !== "team_vote" || teamVoteByMe) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await castMurderClubTeamVote(gameCode, playerToken, vote);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to cast vote.");
    } finally {
      setBusy(false);
    }
  }

  async function castMissionVote(vote: "safe" | "murder") {
    if (!state || busy || state.phase !== "mission_vote" || !state.you.isSelected) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await castMurderClubMissionVote(gameCode, playerToken, vote);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to cast mission vote.");
    } finally {
      setBusy(false);
    }
  }

  async function doPlayAgain() {
    if (!state || !state.you.isHost || busy) {
      return;
    }
    setBusy(true);
    setErrorText("");
    try {
      const next = await playAgainMurderClub(gameCode, playerToken);
      setState(next);
    } catch (error) {
      setErrorText((error as Error).message || "Unable to play again.");
    } finally {
      setBusy(false);
    }
  }

  if (!state) {
    return (
      <section className="runtime-card">
        <h2>Murder Club</h2>
        <p>Loading game...</p>
        {errorText && <p className="hint-text error-text">{errorText}</p>}
      </section>
    );
  }

  return (
    <section className="runtime-card runtime-flow">
      <h2>Murder Club</h2>
      <p>
        Round {state.roundNumber} | Innocents {state.innocentScore} - {state.killerScore} Killers
      </p>
      <p>Leader: {leaderName}</p>

      {state.phase === "rules" && (
        <>
          <p>You've all been invited to a Coastal Town Murder Club...</p>
          <p>Hidden killers sabotage missions. Innocents try to stop them.</p>
          <p>First side to {state.targetScore} wins.</p>
          <button type="button" className="btn btn-key" onClick={() => void doContinue()} disabled={busy || !isWaitingOnYou}>
            {busy ? "Loading..." : isWaitingOnYou ? "Begin" : "Waiting for others"}
          </button>
        </>
      )}

      {state.phase === "team_pick" && (
        <>
          <p>Leader picks a team of {state.teamSizeRequired}.</p>
          <div className="player-grid">
            {state.players.map((player) => {
              const selected = selectedTeam.includes(player.id);
              return (
                <button
                  key={player.id}
                  type="button"
                  className="btn btn-soft"
                  onClick={() => toggleTeamMember(player.id)}
                  disabled={!amLeader || busy}
                >
                  {selected ? "Selected: " : ""}{player.name}
                </button>
              );
            })}
          </div>
          {amLeader ? (
            <button type="button" className="btn btn-key" onClick={() => void submitTeamPick()} disabled={busy}>
              {busy ? "Loading..." : "Confirm team"}
            </button>
          ) : (
            <p>Waiting for {leaderName} to pick the team.</p>
          )}
        </>
      )}

      {state.phase === "discussion_phase" && (
        <>
          {leaderPitchSecondsLeft > 0 ? (
            <p>Leader pitch: explain your team ({leaderPitchSecondsLeft}s)</p>
          ) : (
            <p>Discuss. Who do you trust?</p>
          )}
          <p>{discussionSecondsLeft}s remaining</p>
          {discussionSecondsLeft <= 3 && <p className="hint-text error-text">Vote now</p>}
        </>
      )}

      {state.phase === "team_vote" && (
        <>
          <p>Team vote (public): approve or reject.</p>
          <p>{teamVoteSecondsLeft}s remaining</p>
          {!teamVoteByMe ? (
            <div className="bottom-row">
              <button type="button" className="btn btn-key" onClick={() => void castTeamVote("approve")} disabled={busy}>
                Approve
              </button>
              <button type="button" className="btn btn-soft" onClick={() => void castTeamVote("reject")} disabled={busy}>
                Reject
              </button>
            </div>
          ) : (
            <p>You voted: {teamVoteByMe}</p>
          )}
          <div className="players-panel">
            <p className="body-text left">Votes</p>
            <div className="player-grid teams">
              {state.teamVotes.map((entry) => (
                <div key={entry.playerId} className="player-pill team">
                  {entry.name}: {entry.vote || "..."}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {state.phase === "mission_vote" && (
        <>
          <p>Mission vote (secret).</p>
          <p>{missionVoteSecondsLeft}s remaining</p>
          {state.you.isSelected ? (
            <div className="bottom-row">
              <button type="button" className="btn btn-key" onClick={() => void castMissionVote("safe")} disabled={busy}>
                Safe
              </button>
              <button
                type="button"
                className="btn btn-soft"
                onClick={() => void castMissionVote("murder")}
                disabled={busy || !state.you.canUseMurder}
              >
                Murder
              </button>
            </div>
          ) : (
            <p>Watching... who do you think is lying?</p>
          )}
        </>
      )}

      {state.phase === "round_result" && (
        <>
          <h2>Round result</h2>
          <p>Murders played: {state.lastMurderCount}</p>
          <p>{state.lastLine}</p>
        </>
      )}

      {state.phase === "result" && (
        <>
          <h2>{state.innocentScore >= state.targetScore ? "Innocents win" : "Killers win"}</h2>
          <p>Ready to play again?</p>
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

      {(state.lastError || errorText) && <p className="hint-text error-text">{state.lastError || errorText}</p>}
    </section>
  );
}
