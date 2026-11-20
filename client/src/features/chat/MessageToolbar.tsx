import { Pencil, Reply, Trash2 } from "lucide-react";

import { IconButton } from "../../components/ui";
import { ReactionPicker } from "../reactions/ReactionPicker";

export function MessageToolbar({
  messageId,
  canChange,
  onReply,
  onEdit,
  onDelete,
}: {
  messageId: bigint;
  canChange: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="pointer-events-none absolute -top-4 right-4 z-10 flex items-center rounded-control border border-line bg-surface-1 p-0.5 opacity-0 shadow-pop transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
      <ReactionPicker messageId={messageId} />
      <IconButton label="Reply" size="sm" icon={<Reply size={18} />} onClick={onReply} />
      {canChange && (
        <>
          <IconButton label="Edit" size="sm" icon={<Pencil size={16} />} onClick={onEdit} />
          <IconButton
            label="Delete"
            size="sm"
            tone="danger"
            icon={<Trash2 size={16} />}
            onClick={onDelete}
          />
        </>
      )}
    </div>
  );
}
