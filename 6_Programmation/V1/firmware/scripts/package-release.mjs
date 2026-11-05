import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const firmwareRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseHeader = await readFile(
  resolve(firmwareRoot, "shared/include/spp_release.h"),
  "utf8",
);
const protocolHeader = await readFile(
  resolve(firmwareRoot, "shared/include/spp_spi_protocol.h"),
  "utf8",
);
const version = releaseHeader.match(/SPP_RELEASE_VERSION\s+"([^"]+)"/)?.[1];
const protocolVersion = Number(
  protocolHeader.match(/kProtocolVersion\s*=\s*(\d+)/)?.[1],
);

if (!version || !Number.isInteger(protocolVersion)) {
  throw new Error("Could not read the firmware release identity");
}

const inputs = [
  {
    source: "esp32/.pio/build/esp32doit-devkit-v1/firmware.bin",
    target: "esp32-firmware.bin",
    board: "esp32doit-devkit-v1",
  },
  {
    source: "esp32/.pio/build/esp32doit-devkit-v1/bootloader.bin",
    target: "esp32-bootloader.bin",
    board: "esp32doit-devkit-v1",
  },
  {
    source: "esp32/.pio/build/esp32doit-devkit-v1/partitions.bin",
    target: "esp32-partitions.bin",
    board: "esp32doit-devkit-v1",
  },
  {
    source: "nano/.pio/build/nanoatmega328/firmware.hex",
    target: "nano-firmware.hex",
    board: "nanoatmega328",
  },
];

const releaseDirectory = resolve(firmwareRoot, "releases", version);
await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(releaseDirectory, { recursive: true });

const files = [];
for (const input of inputs) {
  const source = resolve(firmwareRoot, input.source);
  const destination = resolve(releaseDirectory, input.target);
  const content = await readFile(source);
  await copyFile(source, destination);
  files.push({
    file: basename(destination),
    board: input.board,
    bytes: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  });
}

const manifest = {
  version,
  spiProtocolVersion: protocolVersion,
  builtAt: new Date().toISOString(),
  files,
};

await writeFile(
  resolve(releaseDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

console.log(`Packaged firmware ${version} in ${releaseDirectory}`);
for (const file of files) {
  console.log(`${file.file}  ${file.bytes} bytes  ${file.sha256}`);
}
