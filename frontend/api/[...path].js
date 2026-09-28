export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const origin = process.env.RAILWAY_API_ORIGIN;
  if (!origin) {
    res.status(500).json({
      errors: { form: ["RAILWAY_API_ORIGIN is not set."] },
    });
    return;
  }

  const parts = Array.isArray(req.query.path) ? req.query.path.join("/") : (req.query.path ?? "");
  const requestUrl = new URL(req.url, "http://localhost");
  const target = `${origin.replace(/\/$/, "")}/api/${parts}${requestUrl.search}`;

  const headers = new Headers();
  if (req.headers.cookie) {
    headers.set("cookie", req.headers.cookie);
  }
  if (typeof req.headers["x-csrf-token"] === "string") {
    headers.set("x-csrf-token", req.headers["x-csrf-token"]);
  }
  if (typeof req.headers["content-type"] === "string") {
    headers.set("content-type", req.headers["content-type"]);
  }
  const forwarded = req.headers["x-forwarded-for"];
  const clientIp = typeof forwarded === "string" && forwarded.length > 0
    ? forwarded.split(",")[0].trim()
    : req.socket.remoteAddress;
  if (clientIp) {
    headers.set("x-forwarded-for", clientIp);
  }

  const chunks = [];
  if (req.method !== "GET" && req.method !== "HEAD") {
    for await (const chunk of req) {
      chunks.push(chunk);
    }
  }

  const response = await fetch(target, {
    method: req.method,
    headers,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined,
    redirect: "manual",
  });

  res.status(response.status);
  const location = response.headers.get("location");
  if (location) {
    res.setHeader("location", location);
  }
  const contentType = response.headers.get("content-type");
  if (contentType) {
    res.setHeader("content-type", contentType);
  }
  if (typeof response.headers.getSetCookie === "function") {
    for (const cookie of response.headers.getSetCookie()) {
      res.appendHeader("set-cookie", cookie);
    }
  }

  res.send(Buffer.from(await response.arrayBuffer()));
}
