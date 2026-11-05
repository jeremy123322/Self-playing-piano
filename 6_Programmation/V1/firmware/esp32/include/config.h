#pragma once

#if !__has_include("device_config.h")
#error "Copy include/device_config.example.h to include/device_config.h and configure the device"
#endif

#include "device_config.h"
#include "spp_release.h"

static_assert(spp::device_config::kConfigured,
              "Set kConfigured=true after filling device_config.h");
static_assert(sizeof(spp::device_config::kTlsRootCaBundle) > 200,
              "A trusted TLS root certificate bundle is required");

namespace spp::config
{
#ifdef SPP_NANO_LOOPBACK
    constexpr const char *kFirmwareVersion = SPP_RELEASE_VERSION "-loopback";
#else
    constexpr const char *kFirmwareVersion = SPP_RELEASE_VERSION;
#endif
    constexpr const char *kPianoId = device_config::kPianoId;
    constexpr const char *kApiBaseUrl = device_config::kApiBaseUrl;
    constexpr const char *kDeviceToken = device_config::kDeviceToken;
    constexpr const char *kMqttHost = device_config::kMqttHost;
    constexpr uint16_t kMqttPort = device_config::kMqttPort;
    constexpr const char *kMqttUsername = device_config::kMqttUsername;
    constexpr const char *kMqttPassword = device_config::kMqttPassword;
    constexpr const char *kTopicPrefix = device_config::kMqttTopicPrefix;
    constexpr const char *kProvisionPop = device_config::kProvisionPop;
    constexpr const char *kTlsRootCaBundle = device_config::kTlsRootCaBundle;
    constexpr uint32_t kWifiProvisionTimeoutMs = 10000;
    constexpr uint32_t kDurableHeartbeatMs = 60000;
    constexpr uint32_t kReportedIntervalMs = 1000;
    constexpr size_t kMaxArtifactBytes = 128 * 1024;
} // namespace spp::config
