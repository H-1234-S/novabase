const NOT_IMPLEMENTED = 'Auth not implemented yet';

export class NovabaseAuth {
  constructor(
    private _projectUrl: string,
    private _apiKey: string,
  ) {}

  async signUp(_credentials: { email: string; password: string }) {
    throw new Error(NOT_IMPLEMENTED);
  }

  async signIn(_credentials: { email: string; password: string }) {
    throw new Error(NOT_IMPLEMENTED);
  }

  async signOut() {
    throw new Error(NOT_IMPLEMENTED);
  }

  async getUser() {
    throw new Error(NOT_IMPLEMENTED);
  }
}
