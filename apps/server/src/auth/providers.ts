import * as arctic from "arctic";

function env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing env var: ${key}`);
  return val;
}

let _google: arctic.Google | null = null;
let _github: arctic.GitHub | null = null;

export function getGoogle(): arctic.Google {
  if (!_google) {
    _google = new arctic.Google(
      env("GOOGLE_CLIENT_ID"),
      env("GOOGLE_CLIENT_SECRET"),
      env("OAUTH_REDIRECT_BASE") + "/api/auth/callback/google",
    );
  }
  return _google;
}

export function getGitHub(): arctic.GitHub {
  if (!_github) {
    _github = new arctic.GitHub(
      env("GITHUB_CLIENT_ID"),
      env("GITHUB_CLIENT_SECRET"),
      env("OAUTH_REDIRECT_BASE") + "/api/auth/callback/github",
    );
  }
  return _github;
}
