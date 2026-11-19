import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { Friend } from "../../api/types";
import { Button, fieldClass as field } from "../../components/ui";
import { useFriends } from "../../stores/friends";
import { fromJson, nameOf, useProfiles } from "../../stores/profiles";
import { FriendRow, RowButton } from "./FriendRow";
import { useAddFriend, useUserSearch } from "./useUserSearch";

export function FriendsPanel({ onDm }: { onDm: (username: string) => void }) {
  const { list, error, accept, deleteRequest, removeFriend } = useFriends();
  const [open, setOpen] = useState(true);
  const [username, setUsername] = useState("");
  const { query, valid: validQuery, ready: searchReady, search } = useUserSearch(username, open);
  const addFriend = useAddFriend(setUsername);

  const profiles = useProfiles((s) => s.byId);
  const name = (f: Friend) => nameOf(profiles[f.user.id] ?? fromJson(f.user));
  const pendingCount = list.incoming.length;

  return (
    <section className="border-b border-line">
      <button
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wide text-fg-muted hover:text-fg"
        onClick={() => setOpen(!open)}
      >
        <span>
          Friends ({list.friends.length})
          {pendingCount > 0 && (
            <span className="ml-2 rounded-full bg-brand px-1.5 text-on-brand">{pendingCount}</span>
          )}
        </span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>

      {open && (
        <div className="max-h-72 space-y-2 overflow-y-auto px-3 pb-3">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (validQuery && !addFriend.isPending) {
                addFriend.mutate({ target: query, input: username });
              }
            }}
          >
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-label="Search by username"
              placeholder="Search by username"
              className={field}
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={!validQuery || addFriend.isPending}
            >
              Add
            </Button>
          </form>
          {error && <p className="text-xs text-danger">{error}</p>}
          {query && !validQuery && (
            <p className="text-xs text-fg-muted">
              Use 1 to 32 letters, numbers, underscores, or dots.
            </p>
          )}
          {validQuery && (!searchReady || search.isPending) && (
            <p role="status" className="text-xs text-fg-muted">
              Searching…
            </p>
          )}
          {searchReady && search.isError && (
            <p role="alert" className="text-xs text-danger">
              {search.error.message}
            </p>
          )}
          {searchReady && search.isSuccess && search.data.length === 0 && (
            <p role="status" className="text-xs text-fg-muted">
              No matching users.
            </p>
          )}
          {searchReady &&
            search.data?.map((user) => {
              const target = user.username;
              if (!target) return null;
              const isFriend = list.friends.some((friend) => friend.user.id === user.id);
              const sent = list.outgoing.some((friend) => friend.user.id === user.id);
              const incoming = list.incoming.some((friend) => friend.user.id === user.id);
              return (
                <div key={user.id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{user.display_name ?? target}</p>
                    {user.display_name && (
                      <p className="truncate text-xs text-fg-muted">@{target}</p>
                    )}
                  </div>
                  {isFriend || sent ? (
                    <span className="shrink-0 text-xs text-fg-muted">
                      {isFriend ? "Friend" : "Request sent"}
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`${incoming ? "Accept request from" : "Add"} @${target}`}
                      disabled={addFriend.isPending}
                      className="shrink-0 text-xs text-brand hover:underline disabled:opacity-50"
                      onClick={() => addFriend.mutate({ target, input: username })}
                    >
                      {incoming ? "Accept" : "Add"}
                    </button>
                  )}
                </div>
              );
            })}

          {list.incoming.map((f) => (
            <FriendRow key={f.user.id} label={name(f)} avatarId={f.user.id} hint="Incoming request">
              <RowButton onClick={() => accept(f.user.id)} className="text-success">
                Accept
              </RowButton>
              <RowButton onClick={() => deleteRequest(f.user.id)} className="text-danger">
                Decline
              </RowButton>
            </FriendRow>
          ))}
          {list.outgoing.map((f) => (
            <FriendRow key={f.user.id} label={name(f)} avatarId={f.user.id} hint="Request sent">
              <RowButton onClick={() => deleteRequest(f.user.id)} className="text-fg-muted">
                Cancel
              </RowButton>
            </FriendRow>
          ))}
          {list.friends.map((f) => (
            <FriendRow key={f.user.id} label={name(f)} avatarId={f.user.id} userId={f.user.id}>
              <RowButton
                onClick={() => f.user.username && onDm(f.user.username)}
                className="text-brand"
              >
                Message
              </RowButton>
              <RowButton
                onClick={() =>
                  confirm(`Remove ${name(f)} from your friends?`) && removeFriend(f.user.id)
                }
                className="text-danger"
              >
                Remove
              </RowButton>
            </FriendRow>
          ))}
          {list.friends.length + list.incoming.length + list.outgoing.length === 0 && (
            <p className="text-xs text-fg-subtle">
              No friends yet. Search by username to add someone.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
