import { useState } from "react";

import { Button } from "../../components/ui";
import { useFriends } from "../../stores/friends";
import { useAddFriend, useUserSearch } from "./useUserSearch";

export function AddFriend() {
  const list = useFriends((s) => s.list);
  const [username, setUsername] = useState("");
  const { query, valid, ready, search } = useUserSearch(username, true);
  const addFriend = useAddFriend(setUsername);

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h2 className="font-semibold uppercase text-fg">Add friend</h2>
        <p className="text-sm text-fg-muted">You can add friends with their username.</p>
      </div>
      <form
        className="flex items-center gap-2 rounded-panel border border-surface-0 bg-surface-0 py-2 pl-4 pr-2 focus-within:border-brand"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !addFriend.isPending) addFriend.mutate({ target: query, input: username });
        }}
      >
        <input
          autoFocus
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          aria-label="Username"
          placeholder="You can add friends with their username."
          className="min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-fg-subtle"
        />
        <Button type="submit" size="sm" disabled={!valid || addFriend.isPending}>
          Send friend request
        </Button>
      </form>
      {query && !valid && (
        <p className="text-sm text-danger">Use 1 to 32 letters, numbers, underscores, or dots.</p>
      )}
      {addFriend.isSuccess && <p className="text-sm text-success">Friend request sent.</p>}

      {valid && (
        <div className="space-y-1">
          {(!ready || search.isPending) && (
            <p role="status" className="text-sm text-fg-subtle">
              Searching…
            </p>
          )}
          {ready && search.isError && (
            <p role="alert" className="text-sm text-danger">
              {search.error.message}
            </p>
          )}
          {ready && search.isSuccess && search.data.length === 0 && (
            <p role="status" className="text-sm text-fg-subtle">
              No matching users.
            </p>
          )}
          {ready &&
            search.data?.map((user) => {
              const target = user.username;
              if (!target) return null;
              const isFriend = list.friends.some((f) => f.user.id === user.id);
              const sent = list.outgoing.some((f) => f.user.id === user.id);
              const incoming = list.incoming.some((f) => f.user.id === user.id);
              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between gap-2 rounded-control px-2 py-2 hover:bg-surface-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-fg">{user.display_name ?? target}</p>
                    <p className="truncate text-xs text-fg-subtle">@{target}</p>
                  </div>
                  {isFriend || sent ? (
                    <span className="shrink-0 text-xs text-fg-subtle">
                      {isFriend ? "Friend" : "Request sent"}
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant={incoming ? "primary" : "secondary"}
                      aria-label={`${incoming ? "Accept request from" : "Add"} @${target}`}
                      disabled={addFriend.isPending}
                      onClick={() => addFriend.mutate({ target, input: username })}
                    >
                      {incoming ? "Accept" : "Add"}
                    </Button>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
