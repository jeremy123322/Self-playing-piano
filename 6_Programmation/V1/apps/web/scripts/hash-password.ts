import { hash } from "@node-rs/argon2";

const password = process.argv[2];
if (!password) throw new Error("Usage: pnpm --filter @spp/web auth:hash -- <password>");

const main = async () => {
  process.stdout.write(`${Buffer.from(await hash(password), "utf8").toString("base64")}\n`);
};

void main();
