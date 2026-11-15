import { useEffect, useRef, useState } from "react";
import { http } from "../api/http";
import type { User } from "../api/types";

// Username box with suggestions from GET /users/search (prefix match, not you).
// Pick a suggestion or press Enter to submit what's typed.
export function UserSearchInput({
  placeholder,
  buttonLabel,
  disabled,
  onSubmit,
}: {
  placeholder: string;
  buttonLabel: string;
  disabled?: boolean;
  /** Return false to keep the text (e.g. the action failed). */
  onSubmit: (username: string) => unknown;
}) {
  const [text, setText] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [highlighted, setHighlighted] = useState(-1);
  const [open, setOpen] = useState(false);
  const latestQuery = useRef("");

  // Search 250ms after the last keystroke (the api allows 30 searches / 10s).
  useEffect(() => {
    const query = text.trim().toLowerCase();
    latestQuery.current = query;
    if (!/^[a-z0-9_.]{1,32}$/.test(query)) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const users = await http<User[]>(`/users/search?q=${encodeURIComponent(query)}&limit=8`);
        // Ignore answers for an older query that arrive late.
        if (latestQuery.current === query) {
          setResults(users);
          setHighlighted(-1);
        }
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [text]);

  async function submit(username: string) {
    if (!username.trim()) return;
    setOpen(false);
    const result = await onSubmit(username.trim());
    if (result !== false) {
      setText("");
      setResults([]);
    }
  }

  const showList = open && results.length > 0;

  return (
    <form
      className="relative flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const picked = results[highlighted];
        void submit(picked?.username ?? text);
      }}
    >
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        // Delay so a click on a suggestion lands before the list closes.
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!showList) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlighted((i) => (i + 1) % results.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlighted((i) => (i <= 0 ? results.length - 1 : i - 1));
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        className="min-w-0 flex-1 rounded-md bg-zinc-800 px-2 py-1 text-sm outline-none ring-brand focus:ring-2"
      />
      <button disabled={disabled} className="rounded-md bg-zinc-700 px-2 text-sm hover:bg-zinc-600 disabled:opacity-50">
        {buttonLabel}
      </button>

      {showList && (
        <ul className="absolute top-full right-0 left-0 z-10 mt-1 overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 shadow-lg">
          {results.map((user, index) => (
            <li key={user.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => user.username && void submit(user.username)}
                className={`block w-full px-2 py-1 text-left text-sm hover:bg-zinc-800 ${index === highlighted ? "bg-zinc-800 text-brand" : ""}`}
              >
                @{user.username}
                {user.display_name && <span className="ml-2 text-xs text-zinc-500">{user.display_name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
