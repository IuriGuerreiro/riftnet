import { Avatar } from "../../components/Avatar";
import { useConnection } from "../../stores/connection";
import { useNameFor } from "../session/useRealtime";

const dot = { online: "bg-green-500", connecting: "bg-yellow-500", offline: "bg-red-500" };

export function UserHeader({ onEditProfile }: { onEditProfile: () => void }) {
  const { status, error, user: me } = useConnection();
  const nameFor = useNameFor();
  return (
    <header className="space-y-1 border-b border-zinc-800 p-4">
      <button
        className="flex w-full items-center gap-2 rounded-lg text-left font-bold hover:bg-zinc-800"
        title="Edit profile"
        disabled={!me}
        onClick={onEditProfile}
      >
        <Avatar userId={me?.id} />
        <span className="truncate text-brand">{me ? nameFor(me.id) : "…"}</span>
      </button>
      <p className="flex items-center gap-2 text-xs text-zinc-400">
        <span className={`size-2 rounded-full ${dot[status]}`} />
        {status}
        {error && <span className="text-red-400">({error})</span>}
      </p>
    </header>
  );
}
