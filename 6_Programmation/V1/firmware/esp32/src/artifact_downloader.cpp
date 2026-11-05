#include "artifact_downloader.h"

#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <mbedtls/sha256.h>
#include <new>

#include "config.h"

namespace spp {

namespace {

constexpr uint32_t kHttpTimeoutMs = 15000;
constexpr uint32_t kReadNoProgressTimeoutMs = 5000;
constexpr uint32_t kReadOverallTimeoutMs = 30000;

void configureTls(WiFiClientSecure& client) {
  client.setCACert(config::kTlsRootCaBundle);
}

ArtifactDownloadResult success() {
  return {ArtifactDownloadStatus::kSuccess, ""};
}

ArtifactDownloadResult retryableFailure(const String& message) {
  return {ArtifactDownloadStatus::kRetryableFailure, message};
}

ArtifactDownloadResult permanentFailure(const String& message) {
  return {ArtifactDownloadStatus::kPermanentFailure, message};
}

bool retryableHttpStatus(int responseCode) {
  return responseCode < 0 || responseCode == HTTP_CODE_REQUEST_TIMEOUT ||
         responseCode == 429 || responseCode >= 500;
}

ArtifactDownloadResult resolveDownloadUrl(const char* sessionId,
                                          String& downloadUrl) {
  WiFiClientSecure client;
  configureTls(client);
  HTTPClient request;
  const String endpoint = String(config::kApiBaseUrl) +
                          "/api/device/sessions/" + sessionId + "/artifact";
  const char* headers[] = {"Location"};
  request.collectHeaders(headers, 1);
  if (!request.begin(client, endpoint)) {
    return retryableFailure("Unable to open artifact endpoint");
  }
  request.addHeader("Authorization", String("Bearer ") + config::kDeviceToken);
  request.setTimeout(kHttpTimeoutMs);
  const int responseCode = request.GET();
  downloadUrl = request.header("Location");
  request.end();
  if ((responseCode == HTTP_CODE_TEMPORARY_REDIRECT ||
       responseCode == HTTP_CODE_FOUND) && !downloadUrl.isEmpty()) {
    return success();
  }
  if (responseCode < 0) {
    return retryableFailure("Artifact endpoint connection failed: " +
                            HTTPClient::errorToString(responseCode));
  }
  const String message = "Artifact endpoint returned HTTP " +
                         String(responseCode) +
                         " without a download location";
  return retryableHttpStatus(responseCode) ? retryableFailure(message)
                                           : permanentFailure(message);
}

size_t readExactly(Client& stream, uint8_t* destination, size_t length) {
  size_t received = 0;
  const uint32_t startedAtMs = millis();
  uint32_t lastProgressAtMs = startedAtMs;
  while (received < length) {
    const int available = stream.available();
    if (available > 0) {
      const size_t requested = min<size_t>(static_cast<size_t>(available),
                                           length - received);
      const int count = stream.read(destination + received, requested);
      if (count > 0) {
        received += static_cast<size_t>(count);
        lastProgressAtMs = millis();
        continue;
      }
    }
    if (!stream.connected() ||
        millis() - lastProgressAtMs >= kReadNoProgressTimeoutMs ||
        millis() - startedAtMs >= kReadOverallTimeoutMs) {
      break;
    }
    delay(1);
  }
  return received;
}

String bytesToHex(const uint8_t* bytes, size_t length) {
  static const char* digits = "0123456789abcdef";
  String result;
  result.reserve(length * 2);
  for (size_t index = 0; index < length; ++index) {
    result += digits[bytes[index] >> 4];
    result += digits[bytes[index] & 0x0F];
  }
  return result;
}

}  // namespace

ArtifactDownloadResult ArtifactDownloader::download(
    const char* sessionId, const char* expectedSha256, size_t expectedBytes,
    Artifact& artifact) {
  String downloadUrl;
  const ArtifactDownloadResult resolution =
      resolveDownloadUrl(sessionId, downloadUrl);
  if (!resolution.succeeded()) return resolution;

  WiFiClientSecure storageClient;
  configureTls(storageClient);
  HTTPClient request;
  if (!request.begin(storageClient, downloadUrl)) {
    return retryableFailure("Unable to connect to object storage");
  }
  request.setTimeout(kHttpTimeoutMs);
  const int responseCode = request.GET();
  const int contentLength = request.getSize();
  if (responseCode < 0) {
    request.end();
    return retryableFailure("Artifact storage connection failed: " +
                            HTTPClient::errorToString(responseCode));
  }
  if (responseCode != HTTP_CODE_OK) {
    request.end();
    const String message = "Artifact storage returned HTTP " +
                           String(responseCode);
    return retryableHttpStatus(responseCode) ? retryableFailure(message)
                                             : permanentFailure(message);
  }
  if (contentLength <= 0 ||
      static_cast<size_t>(contentLength) > config::kMaxArtifactBytes ||
      (expectedBytes > 0 &&
       static_cast<size_t>(contentLength) != expectedBytes)) {
    request.end();
    return permanentFailure("Artifact has " + String(contentLength) +
                            " bytes; expected " + String(expectedBytes));
  }

  std::unique_ptr<uint8_t[]> data(new (std::nothrow) uint8_t[contentLength]);
  if (!data) {
    request.end();
    return permanentFailure("Not enough RAM for this artifact");
  }
  const size_t received = readExactly(*request.getStreamPtr(), data.get(),
                                      static_cast<size_t>(contentLength));
  request.end();
  if (received != static_cast<size_t>(contentLength)) {
    return retryableFailure("Artifact download stopped after " +
                            String(received) + " of " +
                            String(contentLength) + " bytes");
  }

  uint8_t digest[32]{};
  mbedtls_sha256_context context;
  mbedtls_sha256_init(&context);
  mbedtls_sha256_starts_ret(&context, 0);
  mbedtls_sha256_update_ret(&context, data.get(), contentLength);
  mbedtls_sha256_finish_ret(&context, digest);
  mbedtls_sha256_free(&context);
  if (!bytesToHex(digest, sizeof(digest)).equalsIgnoreCase(expectedSha256)) {
    return retryableFailure("Artifact checksum does not match the command");
  }

  ArtifactError validationError = ArtifactError::kNone;
  if (artifact.adopt(std::move(data), contentLength, validationError)) {
    return success();
  }
  return permanentFailure(artifactErrorMessage(validationError));
}

}  // namespace spp
