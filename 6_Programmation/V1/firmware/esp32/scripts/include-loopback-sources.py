Import("env")

from pathlib import Path

project_dir = Path(env.subst("$PROJECT_DIR"))
source = project_dir.parent / "nano" / "src" / "nano_controller.cpp"
target = Path(env.subst("$BUILD_DIR")) / "nano-loopback" / "nano_controller"
env.Append(PIOBUILDFILES=[env.Object(target=str(target), source=str(source))])
