import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Markdown } from "@/features/chat/Markdown";
import { type Message, user } from "@/mock/data";

export function DeleteDialog({
  message,
  onConfirm,
  onClose,
}: {
  message: Message | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={message !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete message</DialogTitle>
          <DialogDescription>Are you sure? This can't be undone.</DialogDescription>
        </DialogHeader>
        {message && (
          <div className="flex gap-3 rounded-lg border border-border bg-surface-1 p-3">
            <Avatar id={message.author} size={32} />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">
                {user(message.author).name}{" "}
                <span className="text-xs font-normal text-muted-foreground">{message.time}</span>
              </p>
              <div className="line-clamp-4 text-foreground/85">
                {message.text ? <Markdown text={message.text} /> : <i>Attachment</i>}
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            autoFocus
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
