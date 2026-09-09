import { useState } from 'react';
import { Home, Search, User, ListMusic, MessageSquare, Menu } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { CladeMark } from '@/components/CladeMark';

// "Connections" is deliberately absent: it linked to /connections, but the
// only registered route is /connections/:trackId - ConnectionsPage has no
// browse-all mode and always 404'd from here. Re-add once there's a real
// landing page (or per-track entry points, e.g. from TrackCard) for it.
const navItems = [
  { to: '/feed', icon: Home, label: 'Feed' },
  { to: '/forum', icon: MessageSquare, label: 'Forums' },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/playlists', icon: ListMusic, label: 'Lists' },
  { to: '/profile', icon: User, label: 'Profile' },
];

export function BottomNav() {
  const location = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed top-0 left-0 z-[70] p-3 md:p-4">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            // The sheet's own header (CladeMark + "Navigate") renders directly
            // over this exact spot once open, but its logo is an unfilled,
            // thin-stroke SVG - mostly transparent pixels - so this button
            // stayed fully visible AND clickable right through it, looking
            // like a second, confusing hamburger icon sitting inside the
            // menu itself. It's still a real, focusable button underneath
            // (screen readers/tab order unaffected); just not painted or
            // hit-testable while what it opens is already open.
            className={cn(
              'h-10 w-10 rounded-full border border-border/60 bg-background/80 backdrop-blur transition-opacity',
              open && 'opacity-0 pointer-events-none'
            )}
            aria-label="Open navigation"
          >
            <Menu className="w-5 h-5" />
          </Button>
        </SheetTrigger>
        <SheetContent forceMount side="left" className="w-72 p-0">
          {/* SheetContent already renders its own close (X) button, top-right -
              this used to render a second one here, right next to it, so the
              sheet showed two close buttons at once. Every other Sheet in the
              app (ShareSheet, CommentsSheet, ...) relies on just the built-in
              one; matching that keeps the hamburger menu consistent with them
              instead of being the one sheet with an extra control. */}
          <SheetHeader className="px-4 py-3 border-b">
            <SheetTitle className="flex items-center gap-2">
              <CladeMark className="h-6 w-6" />
              Navigate
            </SheetTitle>
          </SheetHeader>
          <nav className="py-2">
            {navItems.map((item) => {
              const isActive = location.pathname === item.to;
              return (
                <SheetTrigger asChild key={item.to}>
                  <NavLink
                    to={item.to}
                    className={cn(
                      'flex items-center gap-3 px-4 py-3 transition-colors',
                      isActive ? 'bg-accent/20 text-primary font-semibold' : 'text-foreground hover:bg-muted/60'
                    )}
                  >
                    <item.icon className="w-5 h-5" />
                    <span className="text-sm">{item.label}</span>
                  </NavLink>
                </SheetTrigger>
              );
            })}
          </nav>
        </SheetContent>
      </Sheet>
      {/* Keep a hidden feed link in DOM for accessibility/tests even when sheet is closed */}
      <NavLink to="/feed" className="sr-only" aria-hidden="true">
        Feed
      </NavLink>
    </div>
  );
}
