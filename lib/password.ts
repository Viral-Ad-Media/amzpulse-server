import crypto from "crypto";
const HASH_ALGO = "scrypt";
export const hashPassword = (password: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(
        `${HASH_ALGO}:${salt.toString("hex")}:${derivedKey.toString("hex")}`,
      );
    });
  });
};

export const verifyPassword = (
  password: string,
  storedHash?: string | null,
): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    if (!storedHash) return resolve(false);
    const [algo, saltHex, hashHex] = storedHash.split(":");
    if (algo !== HASH_ALGO || !saltHex || !hashHex) return resolve(false);
    const salt = Buffer.from(saltHex, "hex");
    const hash = Buffer.from(hashHex, "hex");
    crypto.scrypt(password, salt, hash.length, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(crypto.timingSafeEqual(hash, derivedKey));
    });
  });
};
