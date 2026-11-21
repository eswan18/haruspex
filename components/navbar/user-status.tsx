"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  CircleHelp,
  LogOut,
  Settings,
  User2,
  UserRoundPen,
} from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import { Button } from "../ui/button";
import { useLogout } from "@/hooks/useLogout";

export function UserStatus() {
  const { user, isLoading, error } = useCurrentUser();
  const loggedIn = user && !isLoading && !error;
  const logout = useLogout("/login");

  const renderUserIcon = () => {
    if (user?.picture_url) {
      return (
        <Image
          src={user.picture_url}
          alt={user.name}
          width={36}
          height={36}
          className="h-full w-full object-cover"
        />
      );
    }
    return user?.is_admin ? (
      <UserRoundPen className="h-4 w-4" />
    ) : (
      <User2 className="h-4 w-4" />
    );
  };

  return (
    <div className="flex items-center">
      {loggedIn ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={user.picture_url ? "ghost" : "outline"}
              size="icon"
              className={`riso-icon-btn p-0 ${user.picture_url ? "is-avatar" : ""}`}
            >
              {renderUserIcon()}
              <span className="sr-only">User menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="riso-surface w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{user.name}</p>
                <p className="riso-quiet text-xs leading-none">
                  {user.is_admin ? "Administrator" : "User"}
                </p>
              </div>
            </DropdownMenuLabel>
            <Link href="/account">
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                <span>Account Settings</span>
              </DropdownMenuItem>
            </Link>
            <Link href="/help">
              <DropdownMenuItem>
                <CircleHelp className="mr-2 h-4 w-4" />
                <span>Help</span>
              </DropdownMenuItem>
            </Link>
            <DropdownMenuItem onClick={logout}>
              <LogOut className="mr-2 h-4 w-4" />
              <span>Log out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : isLoading ? (
        // Round, avatar-sized placeholder so it morphs into the avatar without
        // a shape/size shift once the user resolves.
        <div role="status" className="riso-wait h-9 w-9 animate-pulse">
          <span className="sr-only">Loading…</span>
        </div>
      ) : (
        // Straight to the provider: /login is only a launcher. Plain <a>, since
        // /oauth/login mints PKCE cookies and Link would prefetch that.
        <a className="riso-btn" href="/oauth/login">
          Sign in
        </a>
      )}
    </div>
  );
}
