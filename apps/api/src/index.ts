import path from "node:path";
import { config as loadEnv } from "dotenv";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { connectDb } from "./db.js";
import { authRouter } from "./routes/auth.js";
import { kitsRouter } from "./routes/kits.js";
import { errorHandler } from "./middleware/error.js";

loadEnv({ path: path.resolve(process.cwd(), "../../.env") });
loadEnv();

const app = express();
const port = Number(process.env.PORT || 4000);
const webOrigin = process.env.WEB_ORIGIN || "http://localhost:3000";

app.use(
  cors({
    origin: webOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use(morgan("dev"));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRouter);
app.use("/kits", kitsRouter);

app.use(errorHandler);

await connectDb();
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
