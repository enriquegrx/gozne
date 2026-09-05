export class AuthError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export const invalidProof = () =>
  new AuthError(
    401,
    'AUTH_INVALID_PROOF',
    'Authentication could not be completed',
  );
