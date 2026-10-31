"use client";

import React, { useState, useEffect } from "react";
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
} from "@/components/ui/navigation-menu";

import { BugReportButton } from "@/components/bug-report/bug-report-button";
import ThemeToggle from "./theme-toggle";
import { UserStatus } from "./user-status";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  BarChartHorizontal,
  Flag,
  Medal,
  Megaphone,
  MessageCircle,
  Target,
  User2,
  Users,
  Menu,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { getCompetitions } from "@/lib/db_actions/competitions";
import { Competition } from "@/types/db_types";
import { getCompetitionStatusFromObject } from "@/lib/competition-status";
import { NavLink, NavLinkGroup, NavLinkSection } from "./nav-types";
import { DropdownNavbarItem } from "./dropdown-navbar-item";
import { MobileDropdownItem } from "./mobile-dropdown-item";
import { Wordmark } from "./wordmark";

export default function NavBar() {
  const { user, isLoading } = useCurrentUser();
  const { enabled: personalProps } = useFeatureFlag("personal-props");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [competitions, setCompetitions] = useState<Competition[]>([]);

  useEffect(() => {
    if (!isLoading) {
      getCompetitions().then((result) => {
        if (!result.success) {
          console.error("Failed to load competitions:", result.error);
          return;
        }
        const allCompetitions = result.data;
        // Filter competitions based on status (non-admins only see non-upcoming competitions)
        const filteredCompetitions = user?.is_admin
          ? allCompetitions
          : allCompetitions.filter((comp) => {
              const status = getCompetitionStatusFromObject(comp);
              return status !== "upcoming";
            });

        setCompetitions(filteredCompetitions);
      });
    }
  }, [isLoading, user?.is_admin]);

  const toggleGroup = (groupLabel: string) => {
    const newExpanded = new Set(expandedGroups);
    if (newExpanded.has(groupLabel)) {
      newExpanded.delete(groupLabel);
    } else {
      newExpanded.add(groupLabel);
    }
    setExpandedGroups(newExpanded);
  };

  const links: (NavLink | NavLinkGroup)[] = [];

  if (competitions.length > 0) {
    const privateComps = competitions.filter((c) => c.is_private);
    const publicComps = competitions.filter((c) => !c.is_private);
    const toNavLink = (competition: Competition): NavLink => ({
      href: `/competitions/${competition.id}`,
      label: competition.name,
      icon: <Medal size={16} />,
    });

    const sections: NavLinkSection[] = [];
    if (privateComps.length > 0) {
      sections.push({ heading: "Private", links: privateComps.map(toNavLink) });
    }
    if (publicComps.length > 0) {
      sections.push({ heading: "Public", links: publicComps.map(toNavLink) });
    }

    links.push({
      label: "Competitions",
      sections,
    });
  }

  // Personal props are behind a flag, so the way in only exists for the
  // readers who have it.
  if (user && personalProps) {
    links.push({
      href: "/props",
      label: "Your props",
      icon: <User2 size={16} />,
    });
  }

  if (user) {
    links.push({
      href: "/standalone/calibration",
      label: "Calibration",
      icon: <Target size={16} />,
    });
  }

  const adminLinks: NavLink[] = [
    { href: "/admin/users", label: "Users", icon: <Users size={16} /> },
    {
      href: "/admin/competitions",
      label: "Competitions",
      icon: <Medal size={16} />,
    },
    {
      href: "/admin/announcements",
      label: "Announcements",
      icon: <Megaphone size={16} />,
    },
    {
      href: "/admin/feature-flags",
      label: "Feature Flags",
      icon: <Flag size={16} />,
    },
    {
      href: "/admin/suggested-props",
      label: "Suggested Props",
      icon: <MessageCircle size={16} />,
    },
    {
      href: "/admin/forecast-progress",
      label: "Forecast Progress",
      icon: <BarChartHorizontal size={16} />,
    },
  ];

  if (user?.is_admin) {
    links.unshift({ label: "Admin", links: adminLinks });
  }

  function isLink(link: NavLink | NavLinkGroup): link is NavLink {
    return (link as NavLink).href !== undefined;
  }

  return (
    <nav className="riso-nav">
      <div className="flex h-16 items-center justify-between px-4 w-full">
        {/* Desktop Navigation */}
        <div className="flex items-center justify-start">
          {/* Mobile menu button */}
          {user && (
            <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="riso-icon-btn md:hidden mr-3"
                >
                  <Menu className="h-6 w-6" />
                  <span className="sr-only">Toggle menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="riso-surface w-[300px] border-r-[3px] sm:w-[400px]"
              >
                <SheetHeader>
                  <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
                  <SheetClose asChild>
                    <Link
                      href="/"
                      aria-label="Haruspex home"
                      className="flex w-full items-center px-2 py-2"
                    >
                      <Wordmark />
                    </Link>
                  </SheetClose>
                </SheetHeader>
                <div className="mt-6 space-y-2">
                  {links.map((link) =>
                    isLink(link) ? (
                      <SheetClose asChild key={link.href}>
                        <Link href={link.href}>
                          <Button
                            variant="ghost"
                            className="riso-kicker h-12 w-full justify-start"
                          >
                            {link.label}
                          </Button>
                        </Link>
                      </SheetClose>
                    ) : (
                      <MobileDropdownItem
                        key={link.label}
                        group={link}
                        isExpanded={expandedGroups.has(link.label)}
                        onToggle={() => toggleGroup(link.label)}
                      />
                    ),
                  )}
                </div>
              </SheetContent>
            </Sheet>
          )}

          <Link
            href="/"
            aria-label="Haruspex home"
            className="inline-flex items-center py-1.5 pr-2"
          >
            <Wordmark />
          </Link>

          {user && (
            <div className="riso-navlinks hidden md:flex items-center space-x-1">
              <NavigationMenu>
                <NavigationMenuList>
                  {links.map((link) =>
                    isLink(link) ? (
                      <NavigationMenuItem key={link.href}>
                        <NavigationMenuLink
                          href={link.href}
                          className="riso-kicker"
                        >
                          {link.label}
                        </NavigationMenuLink>
                      </NavigationMenuItem>
                    ) : (
                      <DropdownNavbarItem key={link.label} group={link} />
                    ),
                  )}
                </NavigationMenuList>
              </NavigationMenu>
            </div>
          )}
        </div>

        {/* Right side actions */}
        <div className="flex items-center gap-3">
          <UserStatus />
          {user && <BugReportButton user={user} />}
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
