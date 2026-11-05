#pragma once

namespace spp::device_config {

constexpr bool kConfigured = false;
constexpr char kPianoId[] = "00000000-0000-0000-0000-000000000000";
constexpr char kApiBaseUrl[] = "https://your-project.vercel.app";
constexpr char kDeviceToken[] = "replace-me";
constexpr char kMqttHost[] = "broker.example.com";
constexpr unsigned short kMqttPort = 8883;
constexpr char kMqttUsername[] = "piano-device";
constexpr char kMqttPassword[] = "replace-me";
constexpr char kMqttTopicPrefix[] = "pianos";
constexpr char kProvisionPop[] = "piano-setup";

// Concatenate the PEM root certificates needed by EMQX, Vercel and object storage.
constexpr char kTlsRootCaBundle[] = R"PEM(
-----BEGIN CERTIFICATE-----
replace-with-trusted-root-certificates
Paste the complete PEM roots here, including every BEGIN/END CERTIFICATE block.
The bundle must validate the MQTT broker, Vercel API, and selected object store.
Do not use this placeholder on a device.
-----END CERTIFICATE-----
)PEM";

}  // namespace spp::device_config
