#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <MQTT.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <time.h>

#include "artifact_downloader.h"
#include "command_expiry.h"
#include "config.h"
#include "durable_status_queue.h"
#ifdef SPP_NANO_LOOPBACK
#include "nano_loopback_link.h"
#else
#include "esp32_spi_link.h"
#endif
#include "playback_controller.h"
#include "spi_transport.h"
#include "wifi_provisioner.h"

namespace
{

  enum class PlaybackMessageType : uint8_t
  {
    kCommand,
    kArtifactReady,
    kArtifactFailed,
    kConnectivity,
  };

  struct PlaybackMessage
  {
    PlaybackMessageType type = PlaybackMessageType::kCommand;
    spp::DesiredCommand command{};
    spp::Artifact *artifact = nullptr;
    spp::DeviceState connectivityState = spp::DeviceState::kConnecting;
    char error[160]{};
  };

  enum class NetworkActionType : uint8_t
  {
    kDownloadArtifact,
    kEnterProvisioning,
    kRestartController,
  };

  struct NetworkAction
  {
    NetworkActionType type = NetworkActionType::kDownloadArtifact;
    spp::DesiredCommand command{};
  };

  WiFiClientSecure g_mqttTls;
  MQTTClient g_mqtt(2048);
  Preferences g_preferences;
  QueueHandle_t g_playbackQueue = nullptr;
  QueueHandle_t g_networkActionQueue = nullptr;
  QueueHandle_t g_snapshotQueue = nullptr;
  class ArduinoPlaybackClock final : public spp::PlaybackClock
  {
  public:
    uint32_t nowMs() const override { return millis(); }
    void delayMs(uint32_t durationMs) override { delay(durationMs); }
  };

  ArduinoPlaybackClock g_playbackClock;
#ifdef SPP_NANO_LOOPBACK
  spp::NanoLoopbackLink g_spiLink;
#else
  spp::Esp32SpiLink g_spiLink;
#endif
  spp::SpiTransport g_spi(g_spiLink, g_playbackClock);
  spp::ArtifactDownloader g_downloader;
  spp::PlaybackController g_playback(g_spi, g_playbackClock);
  spp::PlaybackSnapshot g_latestSnapshot{};

  String g_desiredTopic;
  String g_reportedTopic;
  uint32_t g_lastMqttAttemptMs = 0;
  uint32_t g_mqttBackoffMs = 1000;
  uint32_t g_mqttConnectedAtMs = 0;
  uint32_t g_lastReportedMs = 0;
  uint32_t g_lastDurableHeartbeatMs = 0;
  constexpr size_t kDurableStatusQueueCapacity = 12;
  spp::DurableStatusQueue<kDurableStatusQueueCapacity> g_durableStatuses;
  uint32_t g_nextDurableAttemptMs = 0;
  uint32_t g_durableRetryMs = 1000;
  uint32_t g_wifiDisconnectedAtMs = 0;
  uint32_t g_initialAppliedRevision = 0;
  uint32_t g_initialHandledRevision = 0;
  bool g_provisioning = false;
  bool g_wifiWasConnected = false;
  bool g_operational = false;
  bool g_snapshotChanged = true;
  bool g_hasSnapshot = false;
  bool g_durableBackpressure = false;
  bool g_provisionOnBoot = false;
  bool g_provisionRestartPending = false;
  uint32_t g_provisionRestartScheduledAtMs = 0;
  bool g_controllerRestartPending = false;
  uint32_t g_controllerRestartRevision = 0;
  uint32_t g_lastNetworkDiagnosticMs = 0;
  bool g_mqttSuspendedForHttps = false;

  constexpr char kProvisionOnBootKey[] = "provisionBoot";
  constexpr uint32_t kProvisionRestartDelayMs = 750;
  constexpr uint8_t kArtifactDownloadAttempts = 3;
  constexpr uint32_t kMqttControlWindowMs = 500;
  constexpr uint32_t kDurableHttpTimeoutMs = 2500;
  constexpr uint32_t kDurableTlsHandshakeTimeoutSeconds = 3;

  void configureTls(WiFiClientSecure &client)
  {
    client.setCACert(spp::config::kTlsRootCaBundle);
  }

  bool clockSynchronized()
  {
    return time(nullptr) >= 1700000000;
  }

  String isoTimestamp()
  {
    const time_t now = time(nullptr);
    if (now < 1700000000)
      return "1970-01-01T00:00:00Z";
    struct tm value{};
    gmtime_r(&now, &value);
    char result[24]{};
    strftime(result, sizeof(result), "%Y-%m-%dT%H:%M:%SZ", &value);
    return String(result);
  }

  String reportedPayload(const spp::PlaybackSnapshot &snapshot, bool online)
  {
    JsonDocument document;
    document["pianoId"] = spp::config::kPianoId;
    document["state"] = online ? spp::stateName(snapshot.state) : "offline";
    document["online"] = online;
    if (snapshot.sessionId[0] != '\0')
      document["sessionId"] = snapshot.sessionId;
    if (snapshot.songId[0] != '\0')
      document["songId"] = snapshot.songId;
    document["positionMs"] = snapshot.positionMs;
    document["durationMs"] = snapshot.durationMs;
    document["firmwareVersion"] = spp::config::kFirmwareVersion;
    document["profileId"] = spp::kProfileId;
    document["profileVersion"] = spp::kProfileVersion;
    document["lastAppliedRevision"] = snapshot.lastAppliedRevision;
    document["lastHandledRevision"] = snapshot.lastHandledRevision;
    if (snapshot.acknowledgementResult != spp::AcknowledgementResult::kNone)
    {
      document["acknowledgement"]["commandId"] = snapshot.acknowledgementCommandId;
      document["acknowledgement"]["revision"] = snapshot.acknowledgementRevision;
      document["acknowledgement"]["result"] = spp::acknowledgementName(snapshot.acknowledgementResult);
      if (snapshot.acknowledgementErrorCode[0] != '\0')
      {
        document["acknowledgement"]["error"]["code"] = snapshot.acknowledgementErrorCode;
        document["acknowledgement"]["error"]["message"] = snapshot.acknowledgementErrorMessage;
      }
    }
    if (snapshot.sessionOutcome != spp::SessionOutcome::kNone)
    {
      document["sessionOutcome"] = spp::sessionOutcomeName(snapshot.sessionOutcome);
    }
    if (snapshot.errorCode[0] != '\0')
    {
      document["error"]["code"] = snapshot.errorCode;
      document["error"]["message"] = snapshot.errorMessage;
    }
    const size_t queuedSnapshots = g_snapshotQueue
                                       ? uxQueueMessagesWaiting(g_snapshotQueue)
                                       : 0;
    document["statusDelivery"]["state"] = g_durableBackpressure
                                              ? "backpressure"
                                          : g_durableRetryMs > 1000 ? "retrying"
                                                                    : "healthy";
    document["statusDelivery"]["pendingReports"] =
        g_durableStatuses.size() + queuedSnapshots;
    document["reportedAt"] = isoTimestamp();
    String payload;
    serializeJson(document, payload);
    return payload;
  }

  void enqueueConnectivity(spp::DeviceState state)
  {
    PlaybackMessage message{};
    message.type = PlaybackMessageType::kConnectivity;
    message.connectivityState = state;
    xQueueSend(g_playbackQueue, &message, 0);
  }

  bool parseCommand(const String &payload, spp::DesiredCommand &command)
  {
    JsonDocument document;
    if (deserializeJson(document, payload) != DeserializationError::Ok)
      return false;
    if (strcmp(document["pianoId"] | "", spp::config::kPianoId) != 0)
      return false;
    command.type = spp::commandTypeFrom(document["type"] | "");
    command.revision = document["revision"] | 0;
    command.artifactBytes = document["artifactBytes"] | 0;
    command.artifactVersion = document["artifactVersion"] | 0;
    command.profileVersion = document["profileVersion"] | 0;
    strlcpy(command.commandId, document["commandId"] | "", sizeof(command.commandId));
    strlcpy(command.sessionId, document["sessionId"] | "", sizeof(command.sessionId));
    strlcpy(command.songId, document["songId"] | "", sizeof(command.songId));
    strlcpy(command.artifactId, document["artifactId"] | "", sizeof(command.artifactId));
    strlcpy(command.artifactSha256, document["artifactSha256"] | "", sizeof(command.artifactSha256));
    strlcpy(command.profileId, document["profileId"] | "", sizeof(command.profileId));
    command.expired = spp::commandExpired(
        document["expiresAtEpochSeconds"] | 0,
        static_cast<uint32_t>(time(nullptr)), clockSynchronized());
    if (command.type == spp::CommandType::kInvalid || command.revision == 0 ||
        strlen(command.commandId) != 36 || strlen(command.sessionId) != 36)
      return false;
    if (command.type == spp::CommandType::kPlay &&
        (strlen(command.songId) != 36 || strlen(command.artifactId) != 36 ||
         strlen(command.artifactSha256) != 64 || command.artifactBytes == 0 ||
         command.artifactVersion == 0 || command.profileVersion == 0 ||
         command.profileId[0] == '\0'))
      return false;
    return true;
  }

  void onMqttMessage(String &topic, String &payload)
  {
    if (topic != g_desiredTopic || !g_playbackQueue || g_controllerRestartPending)
      return;
    PlaybackMessage message{};
    message.type = PlaybackMessageType::kCommand;
    if (!parseCommand(payload, message.command))
      return;
    if (xQueueSend(g_playbackQueue, &message, 0) != pdTRUE)
      g_mqtt.disconnect();
  }

  void publishReported()
  {
    if (!g_hasSnapshot || !g_mqtt.connected())
      return;
    g_mqtt.publish(g_reportedTopic, reportedPayload(g_latestSnapshot, true), true, 1);
    g_lastReportedMs = millis();
  }

  void suspendMqttForHttps()
  {
    if (g_mqttSuspendedForHttps)
      return;
    g_mqttSuspendedForHttps = true;
    if (!g_mqtt.connected())
      return;
    g_mqtt.loop();
    g_mqtt.disconnect();
    Serial.println("MQTT suspended for HTTPS transfer");
  }

  void resumeMqttAfterHttps()
  {
    if (!g_mqttSuspendedForHttps)
      return;
    g_mqttSuspendedForHttps = false;
    g_lastMqttAttemptMs = millis() - g_mqttBackoffMs;
  }

  bool deadlineReached(uint32_t now, uint32_t deadline)
  {
    return deadline == 0 || static_cast<int32_t>(now - deadline) >= 0;
  }

  void updateDurableBackpressure()
  {
    if (!g_durableBackpressure || g_durableStatuses.size() > kDurableStatusQueueCapacity / 2)
      return;
    g_durableBackpressure = false;
    Serial.println("Durable status delivery recovered; MQTT commands enabled");
  }

  void scheduleDurableRetry(uint32_t delayMs)
  {
    g_nextDurableAttemptMs = millis() + delayMs;
  }

  void failDurableStatus(const char *reason, int responseCode = 0,
                         const String &responseBody = "")
  {
    if (responseCode == 0)
    {
      Serial.printf("Durable status delivery failed: %s; retrying in %lu ms\n",
                    reason, static_cast<unsigned long>(g_durableRetryMs));
    }
    else
    {
      Serial.printf("Durable status delivery failed: %s (HTTP %d: %.160s); retrying in %lu ms\n",
                    reason, responseCode, responseBody.c_str(),
                    static_cast<unsigned long>(g_durableRetryMs));
    }
    scheduleDurableRetry(g_durableRetryMs);
    g_durableRetryMs = min<uint32_t>(g_durableRetryMs * 2, 30000);
  }

  void serviceDurableStatus()
  {
    if (g_durableStatuses.empty() && g_hasSnapshot &&
        millis() - g_lastDurableHeartbeatMs >= spp::config::kDurableHeartbeatMs)
    {
      g_durableStatuses.push(g_latestSnapshot);
    }
    if (g_durableStatuses.empty() ||
        !deadlineReached(millis(), g_nextDurableAttemptMs))
      return;
    if (WiFi.status() != WL_CONNECTED || !clockSynchronized())
    {
      scheduleDurableRetry(1000);
      return;
    }
    if (!g_mqtt.connected())
    {
      scheduleDurableRetry(100);
      return;
    }
    const uint32_t mqttConnectedForMs = millis() - g_mqttConnectedAtMs;
    if (mqttConnectedForMs < kMqttControlWindowMs)
    {
      scheduleDurableRetry(kMqttControlWindowMs - mqttConnectedForMs);
      return;
    }

    suspendMqttForHttps();
    const spp::PlaybackSnapshot *snapshot = g_durableStatuses.front();
    if (!snapshot)
    {
      resumeMqttAfterHttps();
      return;
    }
    WiFiClientSecure client;
    configureTls(client);
    client.setHandshakeTimeout(kDurableTlsHandshakeTimeoutSeconds);
    HTTPClient request;
    if (!request.begin(client, String(spp::config::kApiBaseUrl) + "/api/device/status"))
    {
      resumeMqttAfterHttps();
      failDurableStatus("unable to open the endpoint");
      return;
    }
    request.addHeader("Authorization", String("Bearer ") + spp::config::kDeviceToken);
    request.addHeader("Content-Type", "application/json");
    request.setTimeout(kDurableHttpTimeoutMs);
    const int responseCode = request.POST(reportedPayload(*snapshot, true));
    const String responseBody = responseCode >= 200 && responseCode < 300
                                    ? ""
                                    : request.getString();
    request.end();

    if (responseCode < 200 || responseCode >= 300)
    {
      resumeMqttAfterHttps();
      failDurableStatus("server did not accept the report", responseCode, responseBody);
      return;
    }

    g_durableStatuses.pop();
    g_lastDurableHeartbeatMs = millis();
    g_durableRetryMs = 1000;
    updateDurableBackpressure();
    resumeMqttAfterHttps();
    if (g_durableStatuses.empty())
    {
      g_nextDurableAttemptMs = 0;
    }
    else
    {
      scheduleDurableRetry(kMqttControlWindowMs);
    }
  }

  bool startProvisioning()
  {
    if (g_provisioning)
      return true;
    g_operational = false;
    WiFi.setAutoReconnect(false);
    if (WiFi.status() == WL_CONNECTED)
      WiFi.disconnect(false, false);
    const String serviceName = String("PROV_PIANO_") +
                               String(static_cast<uint32_t>(ESP.getEfuseMac()), HEX);
    if (!spp::startBleWifiProvisioning(spp::config::kProvisionPop, serviceName.c_str()))
    {
      WiFi.setAutoReconnect(true);
      WiFi.begin();
      g_wifiDisconnectedAtMs = millis();
      return false;
    }

    g_provisioning = true;
    enqueueConnectivity(spp::DeviceState::kProvisioning);
    Serial.printf("BLE provisioning available as %s\n", serviceName.c_str());
    return true;
  }

  void stopProvisioning()
  {
    if (!g_provisioning)
      return;
    g_provisioning = false;
    WiFi.setAutoReconnect(true);
  }

  bool playbackAllowsProvisioningRestart()
  {
    if (!g_hasSnapshot)
      return false;
    return g_latestSnapshot.state == spp::DeviceState::kIdle ||
           g_latestSnapshot.state == spp::DeviceState::kConnecting ||
           g_latestSnapshot.state == spp::DeviceState::kError;
  }

  void scheduleProvisioningRestart()
  {
    if (g_provisionRestartPending)
      return;
    if (g_preferences.putBool(kProvisionOnBootKey, true) == 0)
    {
      Serial.println("Unable to persist the provisioning boot request");
      g_wifiDisconnectedAtMs = millis();
      return;
    }

    g_provisionRestartPending = true;
    g_provisionRestartScheduledAtMs = millis();
    enqueueConnectivity(spp::DeviceState::kProvisioning);
  }

  void restartForProvisioningIfReady()
  {
    if (!g_provisionRestartPending ||
        millis() - g_provisionRestartScheduledAtMs < kProvisionRestartDelayMs)
      return;
    if (g_mqtt.connected())
      g_mqtt.loop();
    Serial.println("Restarting into BLE provisioning mode");
    delay(50);
    ESP.restart();
  }

  void restartControllerIfReady()
  {
    if (!g_controllerRestartPending || !g_hasSnapshot ||
        g_latestSnapshot.lastHandledRevision < g_controllerRestartRevision ||
        !g_durableStatuses.empty())
      return;
    publishReported();
    if (g_mqtt.connected())
      g_mqtt.loop();
    Serial.println("Safe shutdown recorded; restarting the controller");
    delay(100);
    ESP.restart();
  }

  void connectMqtt()
  {
    if (g_controllerRestartPending || g_durableBackpressure ||
        g_mqttSuspendedForHttps || g_mqtt.connected() ||
        WiFi.status() != WL_CONNECTED || !clockSynchronized())
      return;
    if (millis() - g_lastMqttAttemptMs < g_mqttBackoffMs)
      return;
    g_lastMqttAttemptMs = millis();

    const String clientId = spp::config::kPianoId;
    const String will = reportedPayload(g_latestSnapshot, false);
    g_mqtt.setWill(g_reportedTopic.c_str(), will.c_str(), true, 1);
    if (g_mqtt.connect(clientId.c_str(), spp::config::kMqttUsername,
                       spp::config::kMqttPassword))
    {
      g_mqttConnectedAtMs = millis();
      g_mqtt.subscribe(g_desiredTopic, 1);
      g_mqttBackoffMs = 1000;
      g_operational = true;
      enqueueConnectivity(spp::DeviceState::kIdle);
      publishReported();
      Serial.printf("MQTT connected (%s session)\n",
                    g_mqtt.sessionPresent() ? "persistent" : "new");
      return;
    }
    Serial.printf("MQTT connection failed: error=%d returnCode=%d\n",
                  static_cast<int>(g_mqtt.lastError()),
                  static_cast<int>(g_mqtt.returnCode()));
    g_mqttBackoffMs = min<uint32_t>(g_mqttBackoffMs * 2 + random(0, 500), 30000);
  }

  void logNetworkDiagnostics()
  {
    if (millis() - g_lastNetworkDiagnosticMs < 10000)
      return;
    g_lastNetworkDiagnosticMs = millis();
    const bool wifiConnected = WiFi.status() == WL_CONNECTED;
    const String ip = wifiConnected ? WiFi.localIP().toString() : "none";
    Serial.printf(
        "Network: wifi=%s ip=%s clock=%s mqtt=%s mqttError=%d returnCode=%d\n",
        wifiConnected ? "connected" : "disconnected", ip.c_str(),
        clockSynchronized() ? "synchronized" : "waiting",
        g_mqtt.connected() ? "connected" : "disconnected",
        static_cast<int>(g_mqtt.lastError()),
        static_cast<int>(g_mqtt.returnCode()));
  }

  void handleConnectivity()
  {
    const bool connected = WiFi.status() == WL_CONNECTED;
    if (connected)
    {
      if (!g_wifiWasConnected)
      {
        g_wifiWasConnected = true;
        if (g_provisioning)
          stopProvisioning();
      }
      if (g_mqttSuspendedForHttps)
        return;
      connectMqtt();
      if (g_mqtt.connected())
      {
        g_mqtt.loop();
      }
      else if (g_operational)
      {
        g_operational = false;

        enqueueConnectivity(spp::DeviceState::kConnecting);
      }
      return;
    }

    if (g_wifiWasConnected)
    {
      g_wifiWasConnected = false;
      g_wifiDisconnectedAtMs = millis();
      g_operational = false;
      if (!g_provisioning)
        enqueueConnectivity(spp::DeviceState::kConnecting);
    }
    if (!g_provisioning && !g_provisionRestartPending && playbackAllowsProvisioningRestart() &&
        millis() - g_wifiDisconnectedAtMs >= spp::config::kWifiProvisionTimeoutMs)
    {
      scheduleProvisioningRestart();
    }
  }

  void deliverArtifact(const spp::DesiredCommand &command)
  {
    PlaybackMessage message{};
    message.command = command;
    spp::Artifact *artifact = new (std::nothrow) spp::Artifact();
    if (!artifact)
    {
      message.type = PlaybackMessageType::kArtifactFailed;
      strlcpy(message.error, "Not enough RAM to prepare an artifact", sizeof(message.error));
      xQueueSend(g_playbackQueue, &message, portMAX_DELAY);
      return;
    }

    suspendMqttForHttps();

    spp::ArtifactDownloadResult downloadResult;
    for (uint8_t attempt = 1; attempt <= kArtifactDownloadAttempts; ++attempt)
    {
      downloadResult = g_downloader.download(command.sessionId,
                                             command.artifactSha256,
                                             command.artifactBytes, *artifact);
      if (downloadResult.succeeded() || !downloadResult.retryable() ||
          attempt == kArtifactDownloadAttempts)
      {
        break;
      }
      Serial.printf("Artifact download attempt %u failed: %s; retrying\n",
                    attempt, downloadResult.message.c_str());
      delay(250U << (attempt - 1));
    }

    if (!downloadResult.succeeded())
    {
      Serial.printf("Artifact preparation failed: %s\n",
                    downloadResult.message.c_str());
      delete artifact;
      message.type = PlaybackMessageType::kArtifactFailed;
      strlcpy(message.error, downloadResult.message.c_str(),
              sizeof(message.error));
    }
    else
    {
      message.type = PlaybackMessageType::kArtifactReady;
      message.artifact = artifact;
    }
    resumeMqttAfterHttps();
    xQueueSend(g_playbackQueue, &message, portMAX_DELAY);
  }

  void processNetworkActions()
  {
    NetworkAction action{};
    if (xQueueReceive(g_networkActionQueue, &action, 0) != pdTRUE)
      return;
    if (action.type == NetworkActionType::kEnterProvisioning)
    {
      scheduleProvisioningRestart();
      return;
    }
    if (action.type == NetworkActionType::kRestartController)
    {
      g_controllerRestartPending = true;
      g_controllerRestartRevision = action.command.revision;
      return;
    }
    deliverArtifact(action.command);
  }

  bool significantChange(const spp::PlaybackSnapshot &previous,
                         const spp::PlaybackSnapshot &next)
  {
    return previous.state != next.state ||
           previous.lastHandledRevision != next.lastHandledRevision ||
           previous.sessionOutcome != next.sessionOutcome ||
           strcmp(previous.sessionId, next.sessionId) != 0 ||
           strcmp(previous.errorCode, next.errorCode) != 0;
  }

  void handleSnapshots()
  {
    spp::PlaybackSnapshot snapshot{};
    while (g_durableStatuses.size() < kDurableStatusQueueCapacity - 4 &&
           xQueueReceive(g_snapshotQueue, &snapshot, 0) == pdTRUE)
    {
      const bool significant = !g_hasSnapshot || significantChange(g_latestSnapshot, snapshot);
      g_snapshotChanged = g_snapshotChanged || significant;
      if (significant && !g_durableStatuses.push(snapshot))
      {
        Serial.println("Durable status queue is full; disconnecting MQTT to stop new commands");
        g_durableBackpressure = true;
        if (g_mqtt.connected())
          g_mqtt.disconnect();
      }
      else if (g_durableStatuses.size() >= kDurableStatusQueueCapacity - 4 &&
               !g_durableBackpressure)
      {
        Serial.println("Durable status queue is nearly full; pausing MQTT commands");
        g_durableBackpressure = true;
        if (g_mqtt.connected())
          g_mqtt.disconnect();
      }
      g_latestSnapshot = snapshot;
      g_hasSnapshot = true;
    }
  }

  void playbackTask(void *)
  {
    g_spiLink.begin();
    g_playback.begin(g_initialAppliedRevision, g_initialHandledRevision);
    uint32_t lastSnapshotMs = 0;
    while (true)
    {
      PlaybackMessage message{};
      while (xQueueReceive(g_playbackQueue, &message, 0) == pdTRUE)
      {
        if (message.type == PlaybackMessageType::kCommand)
        {
          const spp::CommandHandling handling = g_playback.handle(message.command);
          if (handling != spp::CommandHandling::kDuplicate)
          {
            const spp::PlaybackSnapshot snapshot = g_playback.snapshot();
            g_preferences.putULong("lastHandled", snapshot.lastHandledRevision);
            g_preferences.putULong("lastApplied", snapshot.lastAppliedRevision);
          }
          if (handling == spp::CommandHandling::kDownloadArtifact ||
              handling == spp::CommandHandling::kEnterProvisioning ||
              handling == spp::CommandHandling::kRestartController)
          {
            NetworkAction action{};
            if (handling == spp::CommandHandling::kDownloadArtifact)
            {
              action.type = NetworkActionType::kDownloadArtifact;
            }
            else if (handling == spp::CommandHandling::kEnterProvisioning)
            {
              action.type = NetworkActionType::kEnterProvisioning;
            }
            else
            {
              action.type = NetworkActionType::kRestartController;
            }
            action.command = message.command;
            xQueueSend(g_networkActionQueue, &action, pdMS_TO_TICKS(100));
          }
        }
        else if (message.type == PlaybackMessageType::kArtifactReady)
        {
          if (message.artifact)
          {
            g_playback.artifactReady(message.command, std::move(*message.artifact));
            delete message.artifact;
          }
        }
        else if (message.type == PlaybackMessageType::kArtifactFailed)
        {
          g_playback.artifactFailed(message.command, message.error);
        }
        else if (message.type == PlaybackMessageType::kConnectivity)
        {
          g_playback.setConnectivityState(message.connectivityState);
        }

        if (g_playback.consumeDirty())
        {
          const spp::PlaybackSnapshot snapshot = g_playback.snapshot();
          if (xQueueSend(g_snapshotQueue, &snapshot, 0) != pdTRUE)
          {
            Serial.println("Snapshot transition queue is full");
          }
          lastSnapshotMs = millis();
        }
      }

      g_playback.tick();
      const bool changed = g_playback.consumeDirty();
      const bool periodicDue = millis() - lastSnapshotMs >= 250 &&
                               uxQueueMessagesWaiting(g_snapshotQueue) == 0;
      if (changed || periodicDue)
      {
        const spp::PlaybackSnapshot snapshot = g_playback.snapshot();
        if (xQueueSend(g_snapshotQueue, &snapshot, 0) != pdTRUE && changed)
        {
          Serial.println("Snapshot transition queue is full");
        }
        lastSnapshotMs = millis();
      }
      vTaskDelay(pdMS_TO_TICKS(2));
    }
  }

} // namespace

void setup()
{
  Serial.begin(115200);
  delay(100);
  Serial.printf("Self-playing piano firmware %s\n",
                spp::config::kFirmwareVersion);
  randomSeed(esp_random());
  g_playbackQueue = xQueueCreate(8, sizeof(PlaybackMessage));
  g_networkActionQueue = xQueueCreate(4, sizeof(NetworkAction));
  g_snapshotQueue = xQueueCreate(12, sizeof(spp::PlaybackSnapshot));
  g_preferences.begin("piano", false);
  g_initialAppliedRevision = g_preferences.getULong("lastApplied", 0);
  g_initialHandledRevision = g_preferences.getULong("lastHandled", 0);
  g_provisionOnBoot = g_preferences.getBool(kProvisionOnBootKey, false);
  if (g_provisionOnBoot)
    g_preferences.remove(kProvisionOnBootKey);
  g_desiredTopic = String(spp::config::kTopicPrefix) + "/" + spp::config::kPianoId + "/v1/desired";
  g_reportedTopic = String(spp::config::kTopicPrefix) + "/" + spp::config::kPianoId + "/v1/reported";

  configureTls(g_mqttTls);
  g_mqtt.begin(spp::config::kMqttHost, spp::config::kMqttPort, g_mqttTls);
  g_mqtt.onMessage(onMqttMessage);
  g_mqtt.setKeepAlive(20);
  g_mqtt.setCleanSession(false);
  g_mqtt.setTimeout(5000);

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(!g_provisionOnBoot);
  if (!g_provisionOnBoot)
    WiFi.begin();
  g_wifiDisconnectedAtMs = millis();
  setenv("TZ", "UTC0", 1);
  tzset();
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com");

  xTaskCreatePinnedToCore(playbackTask, "piano-playback", 8192, nullptr, 3, nullptr, 1);
}

void loop()
{
  handleSnapshots();
  if (g_provisionOnBoot)
  {
    g_provisionOnBoot = false;
    startProvisioning();
  }
  handleConnectivity();
  processNetworkActions();
  logNetworkDiagnostics();

  if (g_snapshotChanged)
  {
    publishReported();
    g_snapshotChanged = false;
  }
  if (millis() - g_lastReportedMs >= spp::config::kReportedIntervalMs)
    publishReported();
  serviceDurableStatus();
  restartControllerIfReady();
  restartForProvisioningIfReady();
  delay(2);
}
