#include "playback_controller.h"

#include <string.h>
#include <utility>

#include "spp_release.h"

namespace spp {

namespace {

template <size_t Size>
void copyText(char (&destination)[Size], const char* source) {
  if (!source) source = "";
  strncpy(destination, source, Size - 1);
  destination[Size - 1] = '\0';
}

uint32_t activationTime(const ArtifactNote& note) {
  return note.startMs - note.activationLeadMs;
}

}  // namespace

const char* stateName(DeviceState state) {
  switch (state) {
    case DeviceState::kBooting: return "booting";
    case DeviceState::kProvisioning: return "provisioning";
    case DeviceState::kConnecting: return "connecting";
    case DeviceState::kIdle: return "idle";
    case DeviceState::kPreparing: return "preparing";
    case DeviceState::kReady: return "ready";
    case DeviceState::kPlaying: return "playing";
    case DeviceState::kPaused: return "paused";
    case DeviceState::kStopping: return "stopping";
    case DeviceState::kError: return "error";
  }
  return "error";
}

const char* acknowledgementName(AcknowledgementResult result) {
  if (result == AcknowledgementResult::kAccepted) return "accepted";
  if (result == AcknowledgementResult::kRejected) return "rejected";
  return "";
}

const char* sessionOutcomeName(SessionOutcome outcome) {
  if (outcome == SessionOutcome::kCompleted) return "completed";
  if (outcome == SessionOutcome::kStopped) return "stopped";
  if (outcome == SessionOutcome::kFailed) return "failed";
  return "";
}

CommandType commandTypeFrom(const char* value) {
  if (strcmp(value, "play") == 0) return CommandType::kPlay;
  if (strcmp(value, "pause") == 0) return CommandType::kPause;
  if (strcmp(value, "resume") == 0) return CommandType::kResume;
  if (strcmp(value, "restart") == 0) return CommandType::kRestart;
  if (strcmp(value, "stop") == 0) return CommandType::kStop;
  if (strcmp(value, "emergency_recover") == 0) return CommandType::kEmergencyRecover;
  if (strcmp(value, "restart_controller") == 0) return CommandType::kRestartController;
  if (strcmp(value, "enter_provisioning") == 0) return CommandType::kEnterProvisioning;
  return CommandType::kInvalid;
}

void PlaybackController::begin(uint32_t lastAppliedRevision, uint32_t lastHandledRevision) {
  lastAppliedRevision_ = lastAppliedRevision;
  lastHandledRevision_ = lastAppliedRevision > lastHandledRevision
      ? lastAppliedRevision
      : lastHandledRevision;
  const uint32_t startedAt = clock_.nowMs();
  bool stopped = false;
  do {
    stopped = stopNano();
    if (!stopped) clock_.delayMs(50);
  } while (!stopped && clock_.nowMs() - startedAt < 3000);
  if (!stopped) {
    copyText(errorCode_, "nano_unavailable");
    copyText(errorMessage_, "Nano did not acknowledge startup all-off");
    transition(DeviceState::kError);
    return;
  }
  transition(DeviceState::kIdle);
}

void PlaybackController::transition(DeviceState state) {
  state_ = state;
  dirty_ = true;
}

void PlaybackController::setConnectivityState(DeviceState state) {
  if (state_ != DeviceState::kIdle && state_ != DeviceState::kConnecting &&
      state_ != DeviceState::kProvisioning) return;
  transition(state);
}

bool PlaybackController::stopNano() {
  pendingOffCount_ = 0;
  nanoStopped_ = transport_.flushAllOff() == SpiResult::kOk;
  return nanoStopped_;
}

bool PlaybackController::startNanoClock(uint32_t positionMs) {
  nanoStopped_ = false;
  return transport_.syncClock(positionMs) == SpiResult::kOk && transport_.clockRunning();
}

void PlaybackController::fail(const char* code, const char* message) {
  if (!nanoStopped_) stopNano();
  lastShutdownRetryMs_ = clock_.nowMs();
  copyText(errorCode_, code);
  copyText(errorMessage_, message);
  if (sessionId_[0] != '\0') sessionOutcome_ = SessionOutcome::kFailed;
  transition(DeviceState::kError);
}

void PlaybackController::accept(const DesiredCommand& command) {
  lastHandledRevision_ = command.revision;
  lastAppliedRevision_ = command.revision;
  acknowledgementRevision_ = command.revision;
  acknowledgementResult_ = AcknowledgementResult::kAccepted;
  copyText(acknowledgementCommandId_, command.commandId);
  acknowledgementErrorCode_[0] = '\0';
  acknowledgementErrorMessage_[0] = '\0';
  dirty_ = true;
}

void PlaybackController::reject(const DesiredCommand& command, const char* code,
                                const char* message) {
  lastHandledRevision_ = command.revision;
  acknowledgementRevision_ = command.revision;
  acknowledgementResult_ = AcknowledgementResult::kRejected;
  copyText(acknowledgementCommandId_, command.commandId);
  copyText(acknowledgementErrorCode_, code);
  copyText(acknowledgementErrorMessage_, message);
  dirty_ = true;
}

uint32_t PlaybackController::positionMs() const {
  if (state_ != DeviceState::kPlaying) return basePositionMs_;
  return basePositionMs_ + (clock_.nowMs() - startedAtMs_);
}

void PlaybackController::resetScheduler(uint32_t position) {
  cursor_ = 0;
  pendingOffCount_ = 0;
  resumeNoteCount_ = 0;
  resumeNoteCursor_ = 0;
  ArtifactNote note{};
  while (cursor_ < artifact_.noteCount() && artifact_.noteAt(cursor_, note) &&
         activationTime(note) < position) {
    const uint32_t endMs = note.startMs + note.durationMs;
    if (endMs > position && resumeNoteCount_ < kMaxPendingOffs) {
      resumeNotes_[resumeNoteCount_++] =
          ResumeNote{endMs, note.keyIndex, note.velocity};
    }
    ++cursor_;
  }
  basePositionMs_ = position;
  startedAtMs_ = clock_.nowMs();
}

CommandHandling PlaybackController::handle(const DesiredCommand& command) {
  if (command.revision <= lastHandledRevision_) return CommandHandling::kDuplicate;
  if (command.expired) {
    reject(command, "command_expired", "The retained command has expired");
    return CommandHandling::kRejected;
  }
  if (command.type == CommandType::kInvalid) {
    reject(command, "invalid_command", "The command type is invalid");
    return CommandHandling::kRejected;
  }
  if (command.type == CommandType::kPlay &&
      (strcmp(command.profileId, kProfileId) != 0 ||
       !artifactProfileCompatible(command.artifactVersion,
                                  command.profileVersion))) {
    reject(command, "profile_mismatch",
           "The command artifact is incompatible with this firmware profile");
    return CommandHandling::kRejected;
  }

  if (command.type == CommandType::kStop) {
    if (sessionId_[0] != '\0' &&
        strcmp(command.sessionId, sessionId_) != 0) {
      reject(command, "session_mismatch", "The active session does not match");
      return CommandHandling::kRejected;
    }
    if (sessionId_[0] == '\0') copyText(sessionId_, command.sessionId);
    const uint32_t stoppedPosition = positionMs();
    transition(DeviceState::kStopping);
    if (!stopNano()) {
      reject(command, "nano_unavailable", "Nano did not acknowledge all-off");
      fail("nano_unavailable", "Nano did not acknowledge Stop");
      return CommandHandling::kRejected;
    }
    basePositionMs_ = stoppedPosition;
    sessionOutcome_ = SessionOutcome::kStopped;
    errorCode_[0] = '\0';
    errorMessage_[0] = '\0';
    accept(command);
    transition(DeviceState::kIdle);
    return CommandHandling::kAccepted;
  }

  if (command.type == CommandType::kEmergencyRecover ||
      command.type == CommandType::kRestartController) {
    const bool restartController = command.type == CommandType::kRestartController;
    copyText(sessionId_, command.sessionId);
    copyText(songId_, command.songId);
    const uint32_t stoppedPosition = positionMs();
    transition(DeviceState::kStopping);
    if (!stopNano()) {
      reject(command, "nano_unavailable", "Nano did not acknowledge emergency all-off");
      fail("nano_unavailable", "Nano did not acknowledge emergency all-off");
      return CommandHandling::kRejected;
    }
    artifact_.clear();
    resetScheduler(stoppedPosition);
    sessionOutcome_ = SessionOutcome::kStopped;
    errorCode_[0] = '\0';
    errorMessage_[0] = '\0';
    accept(command);
    if (!restartController) transition(DeviceState::kIdle);
    return restartController
        ? CommandHandling::kRestartController
        : CommandHandling::kAccepted;
  }

  if (command.type != CommandType::kPlay && command.type != CommandType::kEnterProvisioning &&
      strcmp(command.sessionId, sessionId_) != 0) {
    reject(command, "session_mismatch", "The active session does not match");
    return CommandHandling::kRejected;
  }

  switch (command.type) {
    case CommandType::kPlay:
      if (state_ != DeviceState::kIdle) {
        reject(command, "piano_busy", "The piano is not idle");
        return CommandHandling::kRejected;
      }
      copyText(sessionId_, command.sessionId);
      copyText(songId_, command.songId);
      errorCode_[0] = '\0';
      errorMessage_[0] = '\0';
      sessionOutcome_ = SessionOutcome::kNone;
      artifact_.clear();
      resetScheduler(0);
      accept(command);
      transition(DeviceState::kPreparing);
      return CommandHandling::kDownloadArtifact;
    case CommandType::kPause:
      if (state_ != DeviceState::kPlaying) {
        reject(command, "invalid_state", "Pause requires active playback");
        return CommandHandling::kRejected;
      }
      basePositionMs_ = positionMs();
      if (!stopNano()) {
        reject(command, "nano_unavailable", "Nano did not acknowledge Pause");
        fail("nano_unavailable", "Nano did not acknowledge Pause");
        return CommandHandling::kRejected;
      }
      accept(command);
      transition(DeviceState::kPaused);
      return CommandHandling::kAccepted;
    case CommandType::kResume:
      if (state_ != DeviceState::kPaused) {
        reject(command, "invalid_state", "Resume requires paused playback");
        return CommandHandling::kRejected;
      }
      resetScheduler(basePositionMs_);
      if (!startNanoClock(basePositionMs_)) {
        reject(command, "nano_unavailable", "Nano did not acknowledge Resume");
        fail("nano_unavailable", "Nano did not acknowledge Resume");
        return CommandHandling::kRejected;
      }
      accept(command);
      transition(DeviceState::kPlaying);
      return CommandHandling::kAccepted;
    case CommandType::kRestart:
      if (state_ != DeviceState::kPlaying && state_ != DeviceState::kPaused) {
        reject(command, "invalid_state", "Restart requires an active session");
        return CommandHandling::kRejected;
      }
      if (!stopNano()) {
        reject(command, "nano_unavailable", "Nano did not acknowledge Restart all-off");
        fail("nano_unavailable", "Nano did not acknowledge Restart");
        return CommandHandling::kRejected;
      }
      resetScheduler(0);
      if (!startNanoClock(0)) {
        reject(command, "nano_unavailable", "Nano did not acknowledge Restart clock");
        fail("nano_unavailable", "Nano did not acknowledge Restart");
        return CommandHandling::kRejected;
      }
      accept(command);
      transition(DeviceState::kPlaying);
      return CommandHandling::kAccepted;
    case CommandType::kEnterProvisioning:
      if (state_ != DeviceState::kIdle) {
        reject(command, "invalid_state", "Provisioning requires an idle piano");
        return CommandHandling::kRejected;
      }
      accept(command);
      return CommandHandling::kEnterProvisioning;
    case CommandType::kStop:
    case CommandType::kEmergencyRecover:
    case CommandType::kRestartController:
    case CommandType::kInvalid:
      break;
  }
  reject(command, "invalid_command", "The command could not be handled");
  return CommandHandling::kRejected;
}

void PlaybackController::artifactReady(const DesiredCommand& command, Artifact&& artifact) {
  if (state_ != DeviceState::kPreparing || command.revision != lastAppliedRevision_ ||
      strcmp(command.sessionId, sessionId_) != 0) return;
  artifact_ = std::move(artifact);
  resetScheduler(0);
  if (!startNanoClock(0)) {
    fail("nano_unavailable", "Nano did not acknowledge clock synchronization");
    return;
  }
  transition(DeviceState::kReady);
  transition(DeviceState::kPlaying);
}

void PlaybackController::artifactFailed(const DesiredCommand& command, const char* message) {
  if (state_ != DeviceState::kPreparing || command.revision != lastAppliedRevision_ ||
      strcmp(command.sessionId, sessionId_) != 0) return;
  fail("artifact_download_failed", message);
}

int8_t PlaybackController::earliestOffIndex() const {
  if (pendingOffCount_ == 0) return -1;
  uint8_t earliest = 0;
  for (uint8_t index = 1; index < pendingOffCount_; ++index) {
    if (pendingOffs_[index].timeMs < pendingOffs_[earliest].timeMs) earliest = index;
  }
  return earliest;
}

void PlaybackController::removeOff(uint8_t index) {
  if (index >= pendingOffCount_) return;
  pendingOffs_[index] = pendingOffs_[pendingOffCount_ - 1];
  --pendingOffCount_;
}

bool PlaybackController::addOff(uint32_t timeMs, uint8_t keyIndex) {
  if (pendingOffCount_ >= kMaxPendingOffs) return false;
  pendingOffs_[pendingOffCount_++] = PendingOff{timeMs, keyIndex};
  return true;
}

bool PlaybackController::scheduleNext(uint32_t windowEndMs) {
  ArtifactNote nextNote{};
  const bool hasNote = cursor_ < artifact_.noteCount() && artifact_.noteAt(cursor_, nextNote);
  const int8_t offIndex = earliestOffIndex();
  const bool hasResume = resumeNoteCursor_ < resumeNoteCount_;
  uint32_t eventTime = hasNote ? activationTime(nextNote) : UINT32_MAX;
  enum class EventType : uint8_t { kNote, kResume, kOff };
  EventType eventType = EventType::kNote;
  if (hasResume && basePositionMs_ <= eventTime) {
    eventTime = basePositionMs_;
    eventType = EventType::kResume;
  }
  if (offIndex >= 0 && pendingOffs_[offIndex].timeMs <= eventTime) {
    eventTime = pendingOffs_[offIndex].timeMs;
    eventType = EventType::kOff;
  }
  if (eventTime > windowEndMs) return false;

  SpiResult result;
  if (eventType == EventType::kOff) {
    result = transport_.sendNote(false, pendingOffs_[offIndex].keyIndex, 0, eventTime);
    if (result == SpiResult::kOk) removeOff(offIndex);
  } else if (eventType == EventType::kResume) {
    const ResumeNote& resume = resumeNotes_[resumeNoteCursor_];
    result = transport_.sendNote(true, resume.keyIndex, resume.velocity,
                                 basePositionMs_);
    if (result == SpiResult::kOk) {
      if (!addOff(resume.endMs, resume.keyIndex)) {
        fail("scheduler_overflow", "Too many active notes in the artifact");
        return false;
      }
      ++resumeNoteCursor_;
    }
  } else {
    result = transport_.sendNote(true, nextNote.keyIndex, nextNote.velocity,
                                 activationTime(nextNote));
    if (result == SpiResult::kOk) {
      if (!addOff(nextNote.startMs + nextNote.durationMs,
                  nextNote.keyIndex)) {
        fail("scheduler_overflow", "Too many active notes in the artifact");
        return false;
      }
      ++cursor_;
    }
  }

  if (result == SpiResult::kBufferFull) return false;
  if (result != SpiResult::kOk) {
    fail("spi_protocol_error", "Nano rejected or failed to acknowledge a scheduled note");
    return false;
  }
  return true;
}

void PlaybackController::tickErrorShutdown() {
  if (nanoStopped_) {
    if (sessionId_[0] != '\0') return;
    errorCode_[0] = '\0';
    errorMessage_[0] = '\0';
    transition(DeviceState::kIdle);
    return;
  }

  if (clock_.nowMs() - lastShutdownRetryMs_ < kShutdownRetryIntervalMs) return;
  lastShutdownRetryMs_ = clock_.nowMs();
  stopNano();
}

void PlaybackController::tick() {
  if (state_ == DeviceState::kError) {
    tickErrorShutdown();
    return;
  }
  if (state_ != DeviceState::kPlaying) return;

  if (clock_.nowMs() - lastHeartbeatMs_ >= kHeartbeatIntervalMs) {
    const SpiResult heartbeat = transport_.heartbeat();
    if (heartbeat != SpiResult::kOk || !transport_.clockRunning()) {
      fail(heartbeat == SpiResult::kHardwareUnavailable ? "nano_hardware_unavailable" : "nano_timeout",
           heartbeat == SpiResult::kHardwareUnavailable
               ? "Nano reports unavailable PCA hardware"
               : "Nano stopped or failed to acknowledge its heartbeat");
      return;
    }
    lastHeartbeatMs_ = clock_.nowMs();
  }

  const uint32_t currentPosition = positionMs();
  for (uint8_t count = 0; count < 24 && transport_.freeSlots() > 0; ++count) {
    if (!scheduleNext(currentPosition + kLookAheadMs)) break;
  }
  if (state_ != DeviceState::kPlaying) return;
  if (currentPosition >= artifact_.durationMs() &&
      cursor_ >= artifact_.noteCount() &&
      resumeNoteCursor_ >= resumeNoteCount_ && pendingOffCount_ == 0) {
    basePositionMs_ = artifact_.durationMs();
    if (!stopNano()) {
      fail("nano_unavailable", "Nano did not acknowledge completion all-off");
      return;
    }
    sessionOutcome_ = SessionOutcome::kCompleted;
    transition(DeviceState::kIdle);
  }
}

PlaybackSnapshot PlaybackController::snapshot() const {
  PlaybackSnapshot result{};
  result.state = state_;
  result.positionMs = positionMs();
  result.durationMs = artifact_.durationMs();
  result.lastAppliedRevision = lastAppliedRevision_;
  result.lastHandledRevision = lastHandledRevision_;
  result.acknowledgementRevision = acknowledgementRevision_;
  result.acknowledgementResult = acknowledgementResult_;
  result.sessionOutcome = sessionOutcome_;
  copyText(result.acknowledgementCommandId, acknowledgementCommandId_);
  copyText(result.acknowledgementErrorCode, acknowledgementErrorCode_);
  copyText(result.acknowledgementErrorMessage, acknowledgementErrorMessage_);
  copyText(result.sessionId, sessionId_);
  copyText(result.songId, songId_);
  copyText(result.errorCode, errorCode_);
  copyText(result.errorMessage, errorMessage_);
  return result;
}

bool PlaybackController::consumeDirty() {
  const bool result = dirty_;
  dirty_ = false;
  return result;
}

}  // namespace spp
