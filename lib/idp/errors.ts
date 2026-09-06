/**
 * Thrown when the IdP has definitively rejected the refresh token: the grant is
 * gone, and no amount of retrying will bring it back. This is the only refresh
 * failure that says anything about the user's session.
 *
 * It lives apart from `client.ts` so that middleware can import the class
 * without pulling in a `server-only` module, and so a test that mocks the
 * client can still throw the real error.
 */
export class RefreshTokenRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefreshTokenRejectedError";
  }
}
