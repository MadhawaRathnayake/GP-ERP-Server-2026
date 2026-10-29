import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto"

// Password hashing with Node's built-in scrypt (no native dependencies).
// Stored format: scrypt$N$r$p$<salt base64>$<hash base64>, so parameters can be raised later without breaking old hashes.

const scrypt = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key))))

const PARAMS = { N: 16384, r: 8, p: 1 }
const KEY_LENGTH = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, KEY_LENGTH, PARAMS)
  return ["scrypt", PARAMS.N, PARAMS.r, PARAMS.p, salt.toString("base64"), hash.toString("base64")].join("$")
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, salt, hash] = stored.split("$")
  if (algo !== "scrypt" || !salt || !hash) return false
  const expected = Buffer.from(hash, "base64")
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length, { N: Number(N), r: Number(r), p: Number(p) })
  return timingSafeEqual(actual, expected)
}
