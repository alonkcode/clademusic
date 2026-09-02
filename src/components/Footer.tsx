import { Link } from 'react-router-dom';
import { Music2, Github, Mail, Heart } from 'lucide-react';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-4 py-8 md:py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div className="col-span-1 md:col-span-1">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <Music2 className="h-6 w-6 text-primary" />
              <span className="font-bold text-lg">CladeAI</span>
            </Link>
            <p className="text-sm text-muted-foreground mb-4">
              Discover, discuss, and share music with a passionate community of listeners worldwide.
            </p>
            <div className="flex gap-3">
              {/* Was a bare https://github.com / https://twitter.com - not
                  even a wrong handle, just the generic homepages. GitHub now
                  points at the real repo; Twitter had no real account to
                  link to, so it's gone rather than sending people to a
                  stranger's (or squatted) profile. */}
              <a
                href="https://github.com/kaospan/clademusic"
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground transition"
                aria-label="GitHub"
              >
                <Github className="h-5 w-5" />
              </a>
              <a
                href="mailto:hello@cladeai.com"
                className="text-muted-foreground hover:text-foreground transition"
                aria-label="Email"
              >
                <Mail className="h-5 w-5" />
              </a>
            </div>
          </div>

          {/* Product */}
          <div>
            <h3 className="font-semibold mb-3">Product</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/" className="text-muted-foreground hover:text-foreground transition">
                  Home
                </Link>
              </li>
              <li>
                <Link to="/feed" className="text-muted-foreground hover:text-foreground transition">
                  Feed
                </Link>
              </li>
              <li>
                <Link to="/forum" className="text-muted-foreground hover:text-foreground transition">
                  Forums
                </Link>
              </li>
              <li>
                <Link to="/search" className="text-muted-foreground hover:text-foreground transition">
                  Search
                </Link>
              </li>
            </ul>
          </div>

          {/* Company */}
          <div>
            <h3 className="font-semibold mb-3">Company</h3>
            {/* About/Careers/Blog dropped - no such pages exist, and there's
                no real content to put on them. Contact -> the same address
                as the mail icon above, rather than a /contact page that
                only ever 404'd. */}
            <ul className="space-y-2 text-sm">
              <li>
                <a href="mailto:hello@cladeai.com" className="text-muted-foreground hover:text-foreground transition">
                  Contact
                </a>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <h3 className="font-semibold mb-3">Legal</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <Link to="/terms" className="text-muted-foreground hover:text-foreground transition">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="text-muted-foreground hover:text-foreground transition">
                  Privacy Policy
                </Link>
              </li>
              {/* Cookie Policy and Community Guidelines never had their own
                  pages - Privacy Policy already covers cookies (section
                  5.4), and Forums is this app's actual community. */}
              <li>
                <Link to="/privacy" className="text-muted-foreground hover:text-foreground transition">
                  Cookie Policy
                </Link>
              </li>
              <li>
                <Link to="/forum" className="text-muted-foreground hover:text-foreground transition">
                  Community Guidelines
                </Link>
              </li>
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-border mt-8 pt-6 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
            © {currentYear} CladeAI. All rights reserved.
          </p>
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            Made with <Heart className="h-4 w-4 text-red-500 fill-current" /> for music lovers everywhere
          </p>
        </div>
      </div>
    </footer>
  );
}
