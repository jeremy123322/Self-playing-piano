import { BluetoothIcon, OctagonXIcon, PowerIcon, type LucideIcon } from "lucide-react";
import type { CommandType } from "@spp/contracts";
import type { MessageKey } from "@/lib/i18n/messages";
import type { DiagnosticsPiano } from "@/lib/diagnostics-types";

/**
 * Declarative registry of admin-only device actions (beyond regular play/pause/stop transport).
 * Add new entries here as more device-level actions become available - the diagnostics UI
 * renders every entry with its own confirmation dialog and availability check automatically.
 */
export interface DeviceActionDefinition {
  type: CommandType;
  icon: LucideIcon;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
  confirmTitleKey: MessageKey;
  confirmDescriptionKey: MessageKey;
  confirmActionKey: MessageKey;
  isAvailable: (piano: DiagnosticsPiano) => boolean;
}

export const DEVICE_ACTIONS: readonly DeviceActionDefinition[] = [
  {
    type: "emergency_recover",
    icon: OctagonXIcon,
    labelKey: "diagnostics.action.recover.label",
    descriptionKey: "diagnostics.action.recover.description",
    confirmTitleKey: "diagnostics.action.recover.confirmTitle",
    confirmDescriptionKey: "diagnostics.action.recover.confirmDescription",
    confirmActionKey: "diagnostics.action.recover.confirmAction",
    isAvailable: (piano) => piano.online,
  },
  {
    type: "restart_controller",
    icon: PowerIcon,
    labelKey: "diagnostics.action.restartController.label",
    descriptionKey: "diagnostics.action.restartController.description",
    confirmTitleKey: "diagnostics.action.restartController.confirmTitle",
    confirmDescriptionKey: "diagnostics.action.restartController.confirmDescription",
    confirmActionKey: "diagnostics.action.restartController.confirmAction",
    isAvailable: (piano) => piano.online,
  },
  {
    type: "enter_provisioning",
    icon: BluetoothIcon,
    labelKey: "diagnostics.action.provisioning.label",
    descriptionKey: "diagnostics.action.provisioning.description",
    confirmTitleKey: "diagnostics.action.provisioning.confirmTitle",
    confirmDescriptionKey: "diagnostics.action.provisioning.confirmDescription",
    confirmActionKey: "diagnostics.action.provisioning.confirmAction",
    isAvailable: (piano) => piano.online && piano.state === "idle",
  },
];
