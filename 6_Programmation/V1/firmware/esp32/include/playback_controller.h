#pragma once

#include <stdint.h>

#include "artifact.h"
#include "playback_runtime.h"

namespace spp {

enum class CommandType : uint8_t {
  kPlay,
  kPause,
  kResume,
  kRestart,
  kStop,
  kEmergencyRecover,
  kRestartController,
  kEnterProvisioning,
  kInvalid,
};

enum class DeviceState : uint8_t {
  kBooting,
  kProvisioning,
  kConnecting,
  kIdle,
  kPreparing,
  kReady,
  kPlaying,
  kPaused,
  kStopping,
  kError,
};

enum class CommandHandling : uint8_t {
  kAccepted,
  kRejected,
  kDuplicate,
  kDownloadArtifact,
  kEnterProvisioning,
  kRestartController,
};

enum class AcknowledgementResult : uint8_t { kNone, kAccepted, kRejected };
enum class SessionOutcome : uint8_t { kNone, kCompleted, kStopped, kFailed };

struct DesiredCommand {
  CommandType type = CommandType::kInvalid;
  bool expired = false;
  uint32_t revision = 0;
  char commandId[37]{};
  char sessionId[37]{};
  char songId[37]{};
  char artifactId[37]{};
  char artifactSha256[65]{};
  uint32_t artifactBytes = 0;
  uint8_t artifactVersion = 0;
  uint8_t profileVersion = 0;
  char profileId[101]{};
};

struct PlaybackSnapshot {
  DeviceState state = DeviceState::kBooting;
  uint32_t positionMs = 0;
  uint32_t durationMs = 0;
  uint32_t lastAppliedRevision = 0;
  uint32_t lastHandledRevision = 0;
  uint32_t acknowledgementRevision = 0;
  AcknowledgementResult acknowledgementResult = AcknowledgementResult::kNone;
  SessionOutcome sessionOutcome = SessionOutcome::kNone;
  char acknowledgementCommandId[37]{};
  char acknowledgementErrorCode[48]{};
  char acknowledgementErrorMessage[160]{};
  char sessionId[37]{};
  char songId[37]{};
  char errorCode[48]{};
  char errorMessage[160]{};
};

class PlaybackController {
 public:
  PlaybackController(PlaybackTransport& transport, PlaybackClock& clock)
      : transport_(transport), clock_(clock) {}

  void begin(uint32_t lastAppliedRevision, uint32_t lastHandledRevision);
  CommandHandling handle(const DesiredCommand& command);
  void artifactReady(const DesiredCommand& command, Artifact&& artifact);
  void artifactFailed(const DesiredCommand& command, const char* message);
  void tick();
  void setConnectivityState(DeviceState state);
  PlaybackSnapshot snapshot() const;
  bool consumeDirty();
  bool idle() const { return state_ == DeviceState::kIdle; }

 private:
  struct PendingOff {
    uint32_t timeMs;
    uint8_t keyIndex;
  };
  struct ResumeNote {
    uint32_t endMs;
    uint8_t keyIndex;
    uint8_t velocity;
  };
  static constexpr uint8_t kMaxPendingOffs = 10;
  static constexpr uint32_t kLookAheadMs = 750;
  static constexpr uint32_t kHeartbeatIntervalMs = 400;
  static constexpr uint32_t kShutdownRetryIntervalMs = 400;

  PlaybackTransport& transport_;
  PlaybackClock& clock_;
  Artifact artifact_;
  DeviceState state_ = DeviceState::kBooting;
  uint32_t cursor_ = 0;
  uint32_t basePositionMs_ = 0;
  uint32_t startedAtMs_ = 0;
  uint32_t lastHeartbeatMs_ = 0;
  uint32_t lastShutdownRetryMs_ = 0;
  uint32_t lastAppliedRevision_ = 0;
  uint32_t lastHandledRevision_ = 0;
  uint32_t acknowledgementRevision_ = 0;
  AcknowledgementResult acknowledgementResult_ = AcknowledgementResult::kNone;
  SessionOutcome sessionOutcome_ = SessionOutcome::kNone;
  PendingOff pendingOffs_[kMaxPendingOffs]{};
  uint8_t pendingOffCount_ = 0;
  ResumeNote resumeNotes_[kMaxPendingOffs]{};
  uint8_t resumeNoteCount_ = 0;
  uint8_t resumeNoteCursor_ = 0;
  char acknowledgementCommandId_[37]{};
  char acknowledgementErrorCode_[48]{};
  char acknowledgementErrorMessage_[160]{};
  char sessionId_[37]{};
  char songId_[37]{};
  char errorCode_[48]{};
  char errorMessage_[160]{};
  bool nanoStopped_ = false;
  bool dirty_ = true;

  void transition(DeviceState state);
  void fail(const char* code, const char* message);
  void reject(const DesiredCommand& command, const char* code, const char* message);
  void accept(const DesiredCommand& command);
  void resetScheduler(uint32_t positionMs);
  bool stopNano();
  bool startNanoClock(uint32_t positionMs);
  void tickErrorShutdown();
  uint32_t positionMs() const;
  bool scheduleNext(uint32_t windowEndMs);
  int8_t earliestOffIndex() const;
  void removeOff(uint8_t index);
  bool addOff(uint32_t timeMs, uint8_t keyIndex);
};

const char* stateName(DeviceState state);
const char* acknowledgementName(AcknowledgementResult result);
const char* sessionOutcomeName(SessionOutcome outcome);
CommandType commandTypeFrom(const char* value);

}  // namespace spp
