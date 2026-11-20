// INVARIANT: IDs are strings because Snowflakes don't fit in a JS number.
export interface User {
  id: string;
  username: string | null;
  display_name: string | null;
  bio?: string | null;
  custom_status?: string | null;
  avatar_hash?: string | null;
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

export type FriendState = "friend" | "incoming" | "outgoing";

export interface Friend {
  user: User;
  state: FriendState;
  since: string;
}

export interface FriendsList {
  friends: Friend[];
  incoming: Friend[];
  outgoing: Friend[];
}
