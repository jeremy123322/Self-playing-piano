Import("env")

from pathlib import Path

project_dir = Path(env.subst("$PROJECT_DIR"))
source_files = [
    project_dir.parent / "esp32" / "src" / "artifact.cpp",
    project_dir.parent / "esp32" / "src" / "playback_controller.cpp",
    project_dir.parent / "esp32" / "src" / "spi_transport.cpp",
    project_dir.parent / "nano" / "src" / "nano_controller.cpp",
    project_dir.parent / "nano" / "src" / "solenoid_driver.cpp",
]

objects = []
for source in source_files:
    target = Path(env.subst("$BUILD_DIR")) / "embedded-core" / source.stem
    objects.append(env.Object(target=str(target), source=str(source)))

env.Append(PIOBUILDFILES=objects)
