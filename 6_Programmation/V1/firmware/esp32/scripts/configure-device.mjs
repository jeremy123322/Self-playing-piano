import { X509Certificate } from "node:crypto";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import tls from "node:tls";
import { writeFile } from "node:fs/promises";

const workspaceRoot = resolve(import.meta.dirname, "../../..");
const environmentPath = resolve(workspaceRoot, process.argv[2] ?? "apps/web/.env.local");
const outputPath = resolve(workspaceRoot, "firmware/esp32/include/device_config.h");

loadEnvFile(environmentPath);

const required = (name) => {
  const value = process.env[name];
  if (value) return value;
  throw new Error(`${name} is required in ${environmentPath}`);
};

const tlsRoot = (host, port) => new Promise((resolveRoot, reject) => {
  const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true });
  const timer = setTimeout(() => {
    socket.destroy();
    reject(new Error(`TLS connection to ${host}:${port} timed out`));
  }, 10_000);

  socket.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  socket.once("secureConnect", () => {
    clearTimeout(timer);
    let certificate = socket.getPeerCertificate(true);
    const seen = new Set();
    while (certificate?.raw && !seen.has(certificate.fingerprint256)) {
      seen.add(certificate.fingerprint256);
      if (!certificate.issuerCertificate || certificate.issuerCertificate === certificate) break;
      certificate = certificate.issuerCertificate;
    }
    socket.end();
    if (!certificate?.raw) {
      reject(new Error(`No trusted root certificate found for ${host}:${port}`));
      return;
    }
    const parsed = new X509Certificate(certificate.raw);
    resolveRoot({ fingerprint: parsed.fingerprint256, pem: parsed.toString(), subject: parsed.subject });
  });
});

const apiBaseUrl = new URL(required("API_BASE_URL"));
if (apiBaseUrl.protocol !== "https:") throw new Error("API_BASE_URL must use HTTPS");

const mqttUrl = new URL(required("MQTT_URL"));
if (mqttUrl.protocol !== "mqtts:") throw new Error("MQTT_URL must use mqtts://");

const libraryResponse = await fetch(new URL("/api/songs", apiBaseUrl));
if (!libraryResponse.ok) throw new Error(`Song library returned HTTP ${libraryResponse.status}`);
const library = await libraryResponse.json();
const songId = library.songs?.[0]?.id;
if (!songId) throw new Error("At least one published song is required to resolve the Blob TLS host");

const artifactResponse = await fetch(new URL(`/api/songs/${songId}/artifact`, apiBaseUrl), { redirect: "manual" });
if (artifactResponse.status !== 307) throw new Error(`Artifact resolver returned HTTP ${artifactResponse.status}`);
const artifactLocation = artifactResponse.headers.get("location");
if (!artifactLocation) throw new Error("Artifact resolver did not return a redirect location");
const artifactUrl = new URL(artifactLocation);
if (artifactUrl.protocol !== "https:") throw new Error("Artifact download URL must use HTTPS");

const targets = [
  { host: mqttUrl.hostname, port: Number(mqttUrl.port || 8883) },
  { host: apiBaseUrl.hostname, port: Number(apiBaseUrl.port || 443) },
  { host: artifactUrl.hostname, port: Number(artifactUrl.port || 443) },
];
const roots = new Map();
for (const target of targets) {
  const root = await tlsRoot(target.host, target.port);
  roots.set(root.fingerprint, root);
  console.log(`Verified ${target.host}:${target.port} with ${root.subject}`);
}

const cppString = (value) => JSON.stringify(value);
const caBundle = [...roots.values()].map(({ pem }) => pem.trim()).join("\n");
const output = `#pragma once

namespace spp::device_config {

constexpr bool kConfigured = true;
constexpr char kPianoId[] = ${cppString(required("PIANO_ID"))};
constexpr char kApiBaseUrl[] = ${cppString(apiBaseUrl.origin)};
constexpr char kDeviceToken[] = ${cppString(required("PIANO_DEVICE_TOKEN"))};
constexpr char kMqttHost[] = ${cppString(mqttUrl.hostname)};
constexpr unsigned short kMqttPort = ${Number(mqttUrl.port || 8883)};
constexpr char kMqttUsername[] = ${cppString(required("MQTT_DEVICE_USERNAME"))};
constexpr char kMqttPassword[] = ${cppString(required("MQTT_DEVICE_PASSWORD"))};
constexpr char kMqttTopicPrefix[] = ${cppString(process.env.MQTT_TOPIC_PREFIX ?? "pianos")};
constexpr char kProvisionPop[] = ${cppString(process.env.PIANO_PROVISION_POP ?? "piano-setup")};

constexpr char kTlsRootCaBundle[] = R"SPP_CA(
${caBundle}
)SPP_CA";

}  // namespace spp::device_config
`;

await writeFile(outputPath, output, { encoding: "utf8", mode: 0o600 });
console.log(`Wrote ignored device configuration to ${outputPath}`);
