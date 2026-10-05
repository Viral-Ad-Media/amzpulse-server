export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export const readJsonBody = async (req) => {
  if (Buffer.isBuffer(req.body)) {
    const rawBody = req.body.toString("utf8").trim();
    return rawBody ? JSON.parse(rawBody) : {};
  }
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    return req.body.trim() ? JSON.parse(req.body) : {};
  }

  const chunks = [];
  for await (const chunkPart of req) {
    chunks.push(
      Buffer.isBuffer(chunkPart) ? chunkPart : Buffer.from(chunkPart),
    );
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
};

export const sendJson = (res, status, payload) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  res.end(JSON.stringify(payload));
};

export const sendError = (res, error) => {
  const status = error?.status || 500;
  if (status === 429 && error?.details?.retryAfterSeconds) {
    res.setHeader("Retry-After", String(error.details.retryAfterSeconds));
  }
  sendJson(res, status, {
    error:
      status >= 500
        ? "Product service unavailable. Try again later."
        : error?.message || "Request failed",
  });
};
