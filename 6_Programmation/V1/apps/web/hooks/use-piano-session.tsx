"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import mqtt, { type MqttClient } from "mqtt";
import { isReportedState, type ArtifactNote, type CommandType, type ReportedState } from "@spp/contracts";
import { reconcileRealtimeStatus } from "@/lib/realtime-status";
import { uncertainCommandResolved, type UncertainCommand } from "@/lib/recovery-session";
import { fetchArtifactNotes } from "@/lib/artifact";
import { pendingCommandOutcome, type PendingCommand } from "@/lib/pending-command";
import { enforceReportedProfile } from "@/lib/profile-compatibility";
import { useLocale } from "@/hooks/use-locale";

interface RealtimeConfig {
  pianoId: string;
  pianoName: string;
  profileId: string;
  profileVersion: number;
  url: string;
  username?: string;
  password?: string;
  topic: string;
}

const INITIAL_STATUS: ReportedState = {
  pianoId: "",
  state: "offline",
  online: false,
  positionMs: 0,
  durationMs: 0,
  firmwareVersion: "unknown",
  profileId: "legacy-v1",
  profileVersion: 0,
  lastAppliedRevision: 0,
  lastHandledRevision: 0,
  reportedAt: new Date(0).toISOString(),
};

interface CommandResponsePayload {
  error?: string;
  sessionId?: string;
  revision?: number;
  delivery?: "confirmed" | "uncertain";
}

export interface PianoSessionState {
  pianoName: string | undefined;
  status: ReportedState;
  notes: ArtifactNote[];
  notesLoading: boolean;
  selectedSongId: string | undefined;
  setSelectedSongId: Dispatch<SetStateAction<string | undefined>>;
  activeSongId: string | undefined;
  effectiveSongId: string | undefined;
  busy: boolean;
  commandPending: boolean;
  pendingCommandType: CommandType | undefined;
  message: string | undefined;
  loginRequired: boolean;
  recoverySessionId: string | undefined;
  sendCommand: (type: CommandType) => Promise<void>;
}

const PianoSessionContext = createContext<PianoSessionState | undefined>(undefined);

const usePianoSessionState = (): PianoSessionState => {
  const { t } = useLocale();
  const [realtime, setRealtime] = useState<RealtimeConfig>();
  const [status, setStatus] = useState<ReportedState>(INITIAL_STATUS);
  const [notes, setNotes] = useState<ArtifactNote[]>([]);
  const [loadedNotesSongId, setLoadedNotesSongId] = useState<string>();
  const [selectedSongId, setSelectedSongId] = useState<string>();
  const [pendingCommand, setPendingCommand] = useState<PendingCommand>();
  const [message, setMessage] = useState<string>();
  const [loginRequired, setLoginRequired] = useState(false);
  const [uncertainCommand, setUncertainCommand] = useState<UncertainCommand>();
  const mqttRef = useRef<MqttClient | null>(null);

  // Piano connection details and last known durable status, loaded once on mount.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/realtime-config")
      .then(async (response) => {
        if (!response.ok) throw new Error("Realtime configuration unavailable");
        return (await response.json()) as RealtimeConfig;
      })
      .then(async (config) => {
        if (cancelled) return;
        const statusResponse = await fetch(`/api/pianos/${config.pianoId}/status`).catch(() => undefined);
        if (statusResponse?.ok && !cancelled) {
          const reported: unknown = await statusResponse.json();
          if (isReportedState(reported)) {
            const compatible = enforceReportedProfile(
              { id: config.profileId, version: config.profileVersion },
              reported,
            );
            setStatus((current) => reconcileRealtimeStatus(current, compatible));
          }
        }
        if (!cancelled) setRealtime(config);
      })
      .catch(() => {
        if (!cancelled) setMessage(t("session.realtimeUnavailable"));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live status feed: browser subscribes read-only to the piano's reported-state topic.
  useEffect(() => {
    if (!realtime?.url) return;
    const client = mqtt.connect(realtime.url, {
      ...(realtime.username ? { username: realtime.username } : {}),
      ...(realtime.password ? { password: realtime.password } : {}),
      reconnectPeriod: 1_000,
      connectTimeout: 5_000,
      clean: true,
    });
    mqttRef.current = client;
    client.on("connect", () => client.subscribe(realtime.topic, { qos: 1 }));
    client.on("message", (_topic, payload) => {
      try {
        const reported: unknown = JSON.parse(payload.toString());
        if (!isReportedState(reported)) throw new Error("Invalid reported state");
        const compatible = enforceReportedProfile(
          { id: realtime.profileId, version: realtime.profileVersion },
          reported,
        );
        setStatus((current) => reconcileRealtimeStatus(current, compatible));
      } catch {
        setMessage(t("session.unreadableStatus"));
      }
    });
    return () => {
      mqttRef.current = null;
      void client.endAsync();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realtime]);

  const activeSongId = status.state !== "idle" && status.state !== "offline" ? status.songId : undefined;
  const effectiveSongId = activeSongId ?? selectedSongId;
  // Notes for the newly selected song are still downloading when the ids diverge.
  const notesLoading = Boolean(effectiveSongId) && effectiveSongId !== loadedNotesSongId;

  // Falling-notes preview follows whichever song is active on the piano, or the one the visitor picked.
  useEffect(() => {
    if (!effectiveSongId) return;
    let cancelled = false;
    fetchArtifactNotes(effectiveSongId)
      .then((decoded) => {
        if (cancelled) return;
        setNotes(decoded);
        setLoadedNotesSongId(effectiveSongId);
      })
      .catch(() => {
        if (cancelled) return;
        setNotes([]);
        setLoadedNotesSongId(effectiveSongId);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveSongId]);

  // "Busy" means the piano actually has an active session/song, not merely that its raw
  // state isn't idle - a session-less error (e.g. a hardware fault before any playback)
  // must not be confused with a song being played.
  const busy = Boolean(activeSongId);
  const recoveryResolved = uncertainCommand ? uncertainCommandResolved(uncertainCommand, status) : false;
  const recoverySessionId = recoveryResolved ? undefined : uncertainCommand?.sessionId;
  const commandOutcome = pendingCommand
    ? pendingCommandOutcome(pendingCommand, status)
    : "accepted";
  const commandPending = commandOutcome === "pending";
  const commandRejection = commandOutcome === "rejected"
    ? status.acknowledgement?.error?.message ?? t("session.commandRejected")
    : undefined;

  useEffect(() => {
    if (!pendingCommand || !commandPending) return;
    const timeout = window.setTimeout(() => {
      setPendingCommand(undefined);
      setMessage(t("session.commandTimedOut"));
    }, 120_000);
    return () => window.clearTimeout(timeout);
  }, [pendingCommand, commandPending, t]);

  const visibleMessage = useMemo(
    () => commandRejection ??
      (recoveryResolved && message === t("session.uncertainDelivery") ? undefined : message),
    [commandRejection, message, recoveryResolved, t],
  );

  const sendCommand = useCallback(
    async (type: CommandType) => {
      if (!realtime || commandPending) return;
      setPendingCommand({ type, revision: undefined });
      setMessage(undefined);
      try {
        const response = await fetch(`/api/pianos/${realtime.pianoId}/commands`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type,
            ...(type === "play" ? { songId: selectedSongId } : { sessionId: status.sessionId ?? recoverySessionId }),
          }),
        });
        if (response.status === 401) {
          setPendingCommand(undefined);
          setLoginRequired(true);
          setMessage(t("session.expired"));
          return;
        }
        const payload = (await response.json()) as CommandResponsePayload;
        if (!response.ok) throw new Error(payload.error ?? "The command was rejected");
        if (payload.revision === undefined) throw new Error("The server did not return a command revision");
        setPendingCommand({ type, revision: payload.revision });
        if (payload.delivery === "uncertain" && payload.sessionId && payload.revision !== undefined) {
          setUncertainCommand({ sessionId: payload.sessionId, revision: payload.revision });
          setMessage(t("session.uncertainDelivery"));
        } else if (type === "stop") {
          setUncertainCommand(undefined);
        }
      } catch (error) {
        setPendingCommand(undefined);
        setMessage(error instanceof Error ? error.message : t("session.commandFailed"));
      }
    },
    [realtime, commandPending, selectedSongId, status.sessionId, recoverySessionId, t],
  );

  return {
    pianoName: realtime?.pianoName,
    status,
    notes: effectiveSongId ? notes : [],
    notesLoading,
    selectedSongId,
    setSelectedSongId,
    activeSongId,
    effectiveSongId,
    busy,
    commandPending,
    pendingCommandType: commandPending ? pendingCommand?.type : undefined,
    message: visibleMessage,
    loginRequired,
    recoverySessionId,
    sendCommand,
  };
};

export const PianoSessionProvider = ({ children }: { children: ReactNode }) => {
  const value = usePianoSessionState();
  return <PianoSessionContext.Provider value={value}>{children}</PianoSessionContext.Provider>;
};

export const usePianoSession = () => {
  const context = useContext(PianoSessionContext);
  if (!context) throw new Error("usePianoSession must be used within a PianoSessionProvider");
  return context;
};
