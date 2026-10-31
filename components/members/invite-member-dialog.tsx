"use client";

import { useState, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/form-sheet/form-sheet";
import { Spinner } from "@/components/ui/spinner";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useServerAction } from "@/hooks/use-server-action";
import {
  addCompetitionMemberById,
  getEligibleMembers,
  type CompetitionRole,
} from "@/lib/db_actions/competition-members";
import { settleAction } from "@/lib/thrown-error";

interface EligibleUser {
  id: number;
  name: string;
  username: string | null;
}

function formatUserLabel(user: EligibleUser): string {
  return user.username ? `${user.name} (${user.username})` : user.name;
}

interface InviteMemberDialogProps {
  competitionId: number;
  isOpen: boolean;
  onClose: () => void;
  onMemberChange?: () => void;
}

export function InviteMemberDialog({
  competitionId,
  isOpen,
  onClose,
  onMemberChange,
}: InviteMemberDialogProps) {
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [role, setRole] = useState<CompetitionRole>("forecaster");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [eligibleUsers, setEligibleUsers] = useState<EligibleUser[] | null>(
    null,
  );
  const [eligibleUsersError, setEligibleUsersError] = useState<string | null>(
    null,
  );
  const [isLoadingUsers, startLoadingUsers] = useTransition();
  const router = useRouter();

  // Load eligible users when the dialog opens
  useEffect(() => {
    if (!isOpen) return;
    startLoadingUsers(async () => {
      setEligibleUsersError(null);
      // Settled, as in MembersPanel: a throw in a transition would take the
      // page down with it rather than show in the dialog.
      const result = await settleAction(() =>
        getEligibleMembers(competitionId),
      );
      if (result.success) {
        setEligibleUsers(result.data);
      } else {
        setEligibleUsersError(result.error);
      }
    });
  }, [isOpen, competitionId]);

  const handleSuccess = () => {
    router.refresh();
    setSelectedUserId(null);
    setRole("forecaster");
    setEligibleUsers(null);
    onMemberChange?.();
    onClose();
  };

  const addMemberAction = useServerAction(addCompetitionMemberById, {
    successMessage: "Member added successfully",
    onSuccess: handleSuccess,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUserId === null) return;

    await addMemberAction.execute({
      competitionId,
      userId: selectedUserId,
      role,
    });
  };

  const handleClose = () => {
    if (!addMemberAction.isLoading) {
      setSelectedUserId(null);
      setRole("forecaster");
      setPopoverOpen(false);
      onClose();
    }
  };

  const selectedUser = eligibleUsers?.find((u) => u.id === selectedUserId);

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Member</DialogTitle>
            <DialogDescription>
              Search for a user to add to this competition.
            </DialogDescription>
          </DialogHeader>

          <div className="hxf">
            <Field label="Who" labelId="invite-user">
              <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="picker"
                    aria-labelledby="invite-user"
                    disabled={addMemberAction.isLoading}
                  >
                    {selectedUser ? (
                      formatUserLabel(selectedUser)
                    ) : (
                      <span className="none">Nobody chosen yet</span>
                    )}
                    <span className="car" aria-hidden="true">
                      ▾
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Search by name or username..." />
                    <CommandList>
                      {eligibleUsersError ? (
                        <div className="riso-cmd-empty py-6 text-center text-sm">
                          {eligibleUsersError}
                        </div>
                      ) : isLoadingUsers ? (
                        <div className="flex items-center justify-center py-6">
                          <Spinner className="h-4 w-4" />
                        </div>
                      ) : (
                        <>
                          <CommandEmpty>No users found.</CommandEmpty>
                          <CommandGroup>
                            {(eligibleUsers ?? []).map((user) => (
                              <CommandItem
                                key={user.id}
                                value={formatUserLabel(user)}
                                onSelect={() => {
                                  setSelectedUserId(
                                    user.id === selectedUserId ? null : user.id,
                                  );
                                  setPopoverOpen(false);
                                }}
                              >
                                <Check
                                  className={cn(
                                    "mr-2 h-4 w-4",
                                    selectedUserId === user.id
                                      ? "opacity-100"
                                      : "opacity-0",
                                  )}
                                />
                                {formatUserLabel(user)}
                              </CommandItem>
                            ))}
                          </CommandGroup>
                        </>
                      )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </Field>

            <Field label="Role" labelId="invite-role">
              <div
                className="choose"
                role="radiogroup"
                aria-labelledby="invite-role"
              >
                <label htmlFor="forecaster">
                  <input
                    type="radio"
                    id="forecaster"
                    name="role"
                    value="forecaster"
                    checked={role === "forecaster"}
                    onChange={(e) => setRole(e.target.value as CompetitionRole)}
                    disabled={addMemberAction.isLoading}
                  />
                  <span>
                    <span className="who">Forecaster</span>
                    <span className="what">
                      {" "}
                      — can forecast, and read the field
                    </span>
                  </span>
                </label>
                <label htmlFor="admin">
                  <input
                    type="radio"
                    id="admin"
                    name="role"
                    value="admin"
                    checked={role === "admin"}
                    onChange={(e) => setRole(e.target.value as CompetitionRole)}
                    disabled={addMemberAction.isLoading}
                  />
                  <span>
                    <span className="who">Admin</span>
                    <span className="what">
                      {" "}
                      — all of that, plus props and the roster
                    </span>
                  </span>
                </label>
              </div>
            </Field>
          </div>

          <DialogFooter className="hxf">
            <button
              type="button"
              className="quit"
              onClick={handleClose}
              disabled={addMemberAction.isLoading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="submit"
              disabled={addMemberAction.isLoading || selectedUserId === null}
            >
              {addMemberAction.isLoading ? "Adding…" : "Add member"}
              <span className="arrow" aria-hidden="true">
                →
              </span>
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
