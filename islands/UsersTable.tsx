import { useSignal } from "@preact/signals";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { cn } from "@/src/lib/utils/cn.ts";
import { Plus, Shield, ShieldCheck, Trash2, User } from "lucide-preact";

interface UserData {
  id: string;
  name: string | null;
  email: string;
  role: string;
  createdAt: Date | string | null;
}

interface Props {
  users: UserData[];
  currentUserId: string;
}

export default function UsersTable({
  users: initialUsers,
  currentUserId,
}: Props) {
  const userList = useSignal<UserData[]>(initialUsers);
  const deleting = useSignal<string | null>(null);
  const updatingRole = useSignal<string | null>(null);
  const showCreateDialog = useSignal(false);
  const creating = useSignal(false);

  // Create form fields
  const newName = useSignal("");
  const newEmail = useSignal("");
  const newPassword = useSignal("");
  const newRole = useSignal("admin");

  const handleRoleChange = async (userId: string, newRoleValue: string) => {
    updatingRole.value = userId;
    try {
      const res = await fetch(`/api/user/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRoleValue }),
      });

      if (res.ok) {
        const updated = await res.json();
        userList.value = userList.value.map((u) =>
          u.id === userId ? { ...u, role: updated.role } : u
        );
        toast.success(`Role updated to ${newRoleValue}`);
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to update role");
      }
    } catch (_e) {
      toast.error("An error occurred");
    } finally {
      updatingRole.value = null;
    }
  };

  const handleDelete = async (userId: string) => {
    const user = userList.value.find((u) => u.id === userId);
    if (
      !confirm(
        `Are you sure you want to delete ${user?.name || user?.email}? This cannot be undone.`,
      )
    ) {
      return;
    }

    deleting.value = userId;
    try {
      const res = await fetch(`/api/user/${userId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        userList.value = userList.value.filter((u) => u.id !== userId);
        toast.success("User deleted");
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to delete user");
      }
    } catch (_e) {
      toast.error("An error occurred");
    } finally {
      deleting.value = null;
    }
  };

  const handleCreate = async () => {
    if (!newName.value || !newEmail.value || !newPassword.value) {
      toast.error("All fields are required");
      return;
    }

    if (newPassword.value.length < 12) {
      toast.error("Password must be at least 12 characters");
      return;
    }

    creating.value = true;
    try {
      const res = await fetch("/api/user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newName.value,
          email: newEmail.value,
          password: newPassword.value,
          role: newRole.value,
        }),
      });

      if (res.ok) {
        const created = await res.json();
        userList.value = [
          ...userList.value,
          { ...created, createdAt: new Date().toISOString() },
        ];
        showCreateDialog.value = false;
        newName.value = "";
        newEmail.value = "";
        newPassword.value = "";
        newRole.value = "admin";
        toast.success("User created");
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to create user");
      }
    } catch (_e) {
      toast.error("An error occurred");
    } finally {
      creating.value = false;
    }
  };

  return (
    <div className="space-y-4">
      {/* Create User Button */}
      <div className="flex justify-end">
        <Button
          onClick={() => (showCreateDialog.value = true)}
          className="gap-2"
          size="sm"
        >
          <Plus className="size-4" />
          Create User
        </Button>
      </div>

      {/* Users List */}
      {userList.value.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <p className="mb-4">No users found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {userList.value.map((user) => {
            const isCurrentUser = user.id === currentUserId;

            return (
              <div
                key={user.id}
                className={cn(
                  "flex flex-col sm:flex-row sm:items-center gap-4 p-4 rounded-lg border bg-card",
                  isCurrentUser && "border-amber-500/30",
                )}
              >
                {/* User Info */}
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-amber-500/10 shrink-0">
                    <User className="size-5 text-amber-500" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm truncate">
                        {user.name || "Unnamed"}
                      </p>
                      {isCurrentUser && (
                        <Badge
                          variant="outline"
                          className="text-xs shrink-0"
                        >
                          You
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {user.email}
                    </p>
                  </div>
                </div>

                {/* Role Badge + Date */}
                <div className="flex items-center gap-3 shrink-0">
                  <Badge
                    variant={user.role === "admin" ? "default" : "secondary"}
                    className={cn(
                      "gap-1",
                      user.role === "admin"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-transparent"
                        : "bg-slate-500/15 text-slate-700 dark:text-slate-400 border-transparent",
                    )}
                  >
                    {user.role === "admin" ? (
                      <ShieldCheck className="size-3" />
                    ) : (
                      <Shield className="size-3" />
                    )}
                    {user.role}
                  </Badge>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {user.createdAt
                      ? new Date(user.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })
                      : "N/A"}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
                  {/* Role Selector */}
                  <Select
                    value={user.role}
                    onValueChange={(value: string) =>
                      handleRoleChange(user.id, value)}
                    disabled={isCurrentUser ||
                      updatingRole.value === user.id}
                  >
                    <SelectTrigger className="w-[120px] h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Admin</SelectItem>
                      <SelectItem value="customer">Customer</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Delete Button */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 border-red-500 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
                    onClick={() => handleDelete(user.id)}
                    disabled={isCurrentUser ||
                      deleting.value === user.id}
                  >
                    <Trash2 className="size-4" />
                    <span className="sm:hidden">
                      {deleting.value === user.id ? "Deleting..." : "Delete"}
                    </span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create User Dialog */}
      <Dialog
        open={showCreateDialog.value}
        onOpenChange={(open: boolean) => (showCreateDialog.value = open)}
      >
        <DialogContent onClose={() => (showCreateDialog.value = false)}>
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
            <DialogDescription>
              Add a new user to the system. They will be able to log in with
              the provided credentials.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={newName.value}
                onInput={(e: Event) =>
                  (newName.value =
                    (e.target as HTMLInputElement).value)}
                placeholder="John Doe"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={newEmail.value}
                onInput={(e: Event) =>
                  (newEmail.value =
                    (e.target as HTMLInputElement).value)}
                placeholder="user@example.com"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={newPassword.value}
                onInput={(e: Event) =>
                  (newPassword.value =
                    (e.target as HTMLInputElement).value)}
                placeholder="Min. 12 characters"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="role">Role</Label>
              <Select
                value={newRole.value}
                onValueChange={(value: string) => (newRole.value = value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="customer">Customer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => (showCreateDialog.value = false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating.value}
            >
              {creating.value ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
