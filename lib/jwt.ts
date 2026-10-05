import crypto from "crypto";

export interface JwtPayload {
  sub: string; // user id
  orgId: string;
  email?: string;
  role?: string;
  version?: number;
  exp?: number;
  iat?: number;
}

const base64url = (input: Buffer | string) =>
  Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

const fromBase64Url = (input: string) => {
  const padded = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(input.length + (4 - (input.length % 4 || 4)), "=");
  return Buffer.from(padded, "base64").toString("utf-8");
};

export const signJwt = (
  payload: JwtPayload,
  secret: string,
  expiresInSeconds = 60 * 60,
) => {
  const header = { alg: "HS256", typ: "JWT" };
  const issuedAt = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: issuedAt, exp: issuedAt + expiresInSeconds };

  const headerEncoded = base64url(JSON.stringify(header));
  const payloadEncoded = base64url(JSON.stringify(body));
  const data = `${headerEncoded}.${payloadEncoded}`;
  const signature = base64url(
    crypto.createHmac("sha256", secret).update(data).digest(),
  );
  return `${data}.${signature}`;
};

export const verifyJwt = (token: string, secret: string): JwtPayload | null => {
  try {
    if (token.split(".").length !== 3) return null;
    const [headerB64, payloadB64, signature] = token.split(".");
    const header = JSON.parse(fromBase64Url(headerB64));
    if (header.alg !== "HS256" || header.typ !== "JWT") return null;
    if (!headerB64 || !payloadB64 || !signature) return null;

    const data = `${headerB64}.${payloadB64}`;
    const expected = base64url(
      crypto.createHmac("sha256", secret).update(data).digest(),
    );
    const expectedBuffer = Buffer.from(expected);
    const signatureBuffer = Buffer.from(signature);
    if (
      expectedBuffer.length !== signatureBuffer.length ||
      !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
    ) {
      return null;
    }

    const payload = JSON.parse(fromBase64Url(payloadB64)) as JwtPayload;
    if (
      !Number.isSafeInteger(payload.exp) ||
      payload.exp! <= Math.floor(Date.now() / 1000) ||
      typeof payload.sub !== "string" ||
      !payload.sub ||
      typeof payload.orgId !== "string" ||
      !payload.orgId
    )
      return null;
    return payload;
  } catch {
    return null;
  }
};
