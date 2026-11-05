import { verify } from "@node-rs/argon2";

export const verifyEncodedHash = async (encodedHash: string | undefined, password: string) => {
  if (!encodedHash) return false;
  try {
    return await verify(Buffer.from(encodedHash, "base64").toString("utf8"), password);
  } catch {
    return false;
  }
};
