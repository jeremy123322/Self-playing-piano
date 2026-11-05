#include "wifi_provisioner.h"

#include <Arduino.h>
#include <cstring>
#include <esp32-hal-bt.h>
#include <esp_bt.h>
#include <wifi_provisioning/manager.h>
#include <wifi_provisioning/scheme_ble.h>

namespace spp {

bool startBleWifiProvisioning(const char* proofOfPossession, const char* serviceName) {
  const esp_bt_controller_status_t controllerStatus = esp_bt_controller_get_status();
  if (controllerStatus != ESP_BT_CONTROLLER_STATUS_IDLE && !btStop()) {
    Serial.printf("BLE controller cleanup failed from state %d\n", controllerStatus);
    return false;
  }

  wifi_prov_mgr_config_t config{};
  config.scheme = wifi_prov_scheme_ble;

  const wifi_prov_event_handler_t schemeHandler =
      WIFI_PROV_SCHEME_BLE_EVENT_HANDLER_FREE_BTDM;
  const wifi_prov_event_handler_t appHandler = WIFI_PROV_EVENT_HANDLER_NONE;
  memcpy(&config.scheme_event_handler, &schemeHandler, sizeof(schemeHandler));
  memcpy(&config.app_event_handler, &appHandler, sizeof(appHandler));

  const esp_err_t initResult = wifi_prov_mgr_init(config);
  if (initResult != ESP_OK) {
    Serial.printf("BLE provisioning initialization failed: %s\n", esp_err_to_name(initResult));
    return false;
  }

  const esp_err_t startResult = wifi_prov_mgr_start_provisioning(
      WIFI_PROV_SECURITY_1, proofOfPossession, serviceName, nullptr);
  if (startResult == ESP_OK) return true;

  Serial.printf("BLE provisioning start failed: %s\n", esp_err_to_name(startResult));
  wifi_prov_mgr_deinit();
  return false;
}

}  // namespace spp
