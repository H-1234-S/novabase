interface AuthUser {
  id: string;
  email: string;
}

export interface AuthResult {
  data: { user: AuthUser; accessToken: string } | null;
  error: string | null;
}

export class NovabaseAuth {
  private currentToken: string | null = null;

  constructor(private projectUrl: string) {}

  async signUp(credentials: {
    email: string;
    password: string;
  }): Promise<AuthResult> {
    try {
      const res = await fetch(`${this.projectUrl}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        return { data: null, error: err.message ?? 'Sign up failed' };
      }

      const data = (await res.json()) as {
        user: AuthUser;
        accessToken: string;
      };
      this.currentToken = data.accessToken;
      return { data, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      return { data: null, error: message };
    }
  }

  async signIn(credentials: {
    email: string;
    password: string;
  }): Promise<AuthResult> {
    try {
      const res = await fetch(`${this.projectUrl}/auth/signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as {
          message?: string;
        };
        return { data: null, error: err.message ?? 'Sign in failed' };
      }

      const data = (await res.json()) as {
        user: AuthUser;
        accessToken: string;
      };
      this.currentToken = data.accessToken;
      return { data, error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      return { data: null, error: message };
    }
  }

  async sendMagicLink(email: string): Promise<{ error: string | null }> {
    try {
      const res = await fetch(`${this.projectUrl}/auth/magic-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) return { error: 'Failed to send magic link' };
      return { error: null };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Network error';
      return { error: message };
    }
  }

  signInWithGoogle(): void {
    window.location.href = `${this.projectUrl}/auth/google`;
  }

  signInWithGithub(): void {
    window.location.href = `${this.projectUrl}/auth/github`;
  }

  signOut(): void {
    this.currentToken = null;
  }

  getUser(): AuthUser | null {
    if (!this.currentToken) return null;

    try {
      const payload = JSON.parse(atob(this.currentToken.split('.')[1])) as {
        sub: string;
        email: string;
      };
      return { id: payload.sub, email: payload.email };
    } catch {
      return null;
    }
  }

  getAccessToken(): string | null {
    return this.currentToken;
  }
}
