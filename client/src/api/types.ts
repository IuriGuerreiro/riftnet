// INVARIANT: IDs are strings because Snowflakes don't fit in a JS number.
export interface User {
  id: string;
  username: string | null;
  display_name: string | null;
}

export interface Session {
  access_token: string;
  access_expires_at: number;
  refresh_token: string;
  user: User;
}

export interface ApiErrorBody {
  code: string;
  message: string;
}
