import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler, notFound } from "./middleware/error";
import routes from "./routes";

const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.send("Vehicle Tracker backend is running");
});

app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

export default app;
