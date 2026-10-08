export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    // Stable machine-readable reason the frontend can branch on
    public readonly code?: string,
  ) {
    super(message);
  }
}
