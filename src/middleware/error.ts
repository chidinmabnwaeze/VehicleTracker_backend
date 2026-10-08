import type { ErrorRequestHandler, RequestHandler } from "express";
import { Error as MongooseError } from "mongoose";
import { ApiError } from "../utils/ApiError";

export const notFound: RequestHandler = (req, _res, next) => {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ message: err.message, code: err.code });
    return;
  }
  if (err instanceof MongooseError.ValidationError) {
    const details = Object.values(err.errors).map((e) => e.message);
    res.status(400).json({ message: details[0] || "Validation failed", details });
    return;
  }
  if (err instanceof MongooseError.CastError) {
    res.status(400).json({ message: `Invalid ${err.path}` });
    return;
  }
  // MongoDB duplicate key
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern || {}).pop() || "value";
    res.status(409).json({ message: `${field} already exists` });
    return;
  }
  if (err?.type === "entity.parse.failed") {
    res.status(400).json({ message: "Request body is not valid JSON" });
    return;
  }

  console.error(err);
  res.status(500).json({ message: "Something went wrong" });
};
