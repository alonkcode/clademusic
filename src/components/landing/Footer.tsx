import { useState } from 'react';
import { motion } from 'framer-motion';
import { Waves, Github, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';

// Every entry here has to resolve to something real: either a registered
// route, an in-page anchor that actually exists on the landing page, or a
// mailto: fallback. This footer previously linked to a dozen pages (About,
// Blog, Careers, Docs, FAQ, ...) that were never built - every one of them
// dead-ended on the 404 page. Rather than fake placeholder pages for
// content that doesn't exist, unbuilt destinations are either dropped or
// pointed at the closest real equivalent (e.g. Cookie Policy -> the
// Privacy Policy page, which already covers cookies in section 5.4).
export function Footer() {
  const [newsletterEmail, setNewsletterEmail] = useState('');
  const footerLinks = {
    Product: [
      { label: 'Features', href: '/#features' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'Demo', href: '/#demo' },
    ],
    Company: [
      { label: 'Contact', href: 'mailto:hello@cladeai.com' },
    ],
    Resources: [
      { label: 'Community (Forums)', href: '/forum' },
    ],
    Legal: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Service', href: '/terms' },
      { label: 'Cookie Policy', href: '/privacy' },
    ],
  };

  // GitHub points at the real repo. Twitter/Instagram were bare, unclaimed
  // handles (twitter.com/clade, instagram.com/clade) - not this project's
  // accounts, and sending users to a stranger's profile (or a squatted one)
  // is worse than just not showing the icon.
  const socialLinks = [
    { icon: Github, href: 'https://github.com/kaospan/clademusic', color: '#FFD700' },
    { icon: Mail, href: 'mailto:hello@cladeai.com', color: '#90EE90' },
  ];

  return (
    <footer className="relative bg-[#0A0A0F] border-t border-gray-900">
      {/* Top gradient line */}
      <div className="h-1 w-full bg-gradient-to-r from-[#00F5FF] via-[#FF00FF] to-[#FFD700]" />

      <div className="container mx-auto px-6 py-16">
        <div className="grid md:grid-cols-5 gap-12 mb-12">
          {/* Brand */}
          <div className="md:col-span-1">
            <Link to="/" className="inline-flex items-center space-x-3 mb-4">
              <Waves className="w-8 h-8 text-[#00F5FF]" />
              <span className="text-2xl font-bold bg-gradient-to-r from-[#00F5FF] via-[#FF00FF] to-[#FFD700] bg-clip-text text-transparent">
                Clade
              </span>
            </Link>
            <p className="text-gray-400 text-sm mb-6">
              Find Your Harmony
            </p>
            
            {/* Social Links */}
            <div className="flex items-center space-x-4">
              {socialLinks.map((social, index) => (
                <motion.a
                  key={index}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  whileHover={{ scale: 1.08 }}
                  transition={{ duration: 0.3 }}
                  className="w-10 h-10 rounded-full bg-[#1A1A2E] border border-gray-800 flex items-center justify-center hover:border-gray-700 transition-colors"
                  style={{
                    color: social.color,
                  }}
                >
                  <social.icon className="w-5 h-5" />
                </motion.a>
              ))}
            </div>
          </div>

          {/* Links */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="font-semibold text-white mb-4">{category}</h3>
              <ul className="space-y-3">
                {links.map((link) => (
                  <li key={link.label}>
                    {/* mailto: is a real navigation, not an internal route -
                        Link's `to` would try to client-side-route to it and
                        just 404 within the SPA instead of opening mail. */}
                    {link.href.startsWith('mailto:') ? (
                      <a href={link.href} className="text-gray-400 hover:text-[#00F5FF] transition-colors text-sm">
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        to={link.href}
                        className="text-gray-400 hover:text-[#00F5FF] transition-colors text-sm"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Newsletter */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="border-t border-gray-900 pt-12 mb-12"
        >
          <div className="max-w-2xl mx-auto text-center">
            <h3 className="text-2xl font-bold text-white mb-3">
              Stay in Harmony
            </h3>
            <p className="text-gray-400 mb-6">
              Get the latest features, music theory tips, and harmony insights delivered to your inbox.
            </p>
            {/* There's no newsletter/ESP integration behind this yet - it
                previously just submitted nowhere. Opening a pre-filled
                mailto: is an honest stand-in (a real signup, just routed
                through email instead of a service) rather than a button
                that silently did nothing. */}
            <form
              className="flex flex-col sm:flex-row gap-4 max-w-md mx-auto"
              onSubmit={(e) => {
                e.preventDefault();
                const email = newsletterEmail.trim();
                window.location.href = `mailto:hello@cladeai.com?subject=${encodeURIComponent('Newsletter signup')}&body=${encodeURIComponent(email ? `Please add ${email} to the newsletter.` : '')}`;
              }}
            >
              <input
                type="email"
                required
                value={newsletterEmail}
                onChange={(e) => setNewsletterEmail(e.target.value)}
                placeholder="Enter your email"
                className="flex-1 px-4 py-3 bg-[#1A1A2E] border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#00F5FF] transition-all"
              />
              <motion.button
                type="submit"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                className="px-6 py-3 bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] text-white font-semibold rounded-lg hover:shadow-lg hover:shadow-[#00F5FF]/50 transition-all"
              >
                Subscribe
              </motion.button>
            </form>
          </div>
        </motion.div>

        {/* Bottom */}
        <div className="border-t border-gray-900 pt-8 flex flex-col md:flex-row items-center justify-between text-sm text-gray-500">
          <p>© 2026 Clade. All rights reserved.</p>
          <p className="mt-4 md:mt-0">
            Made with <span className="text-red-500">♥</span> for music lovers everywhere
          </p>
        </div>
      </div>

      {/* Decorative bottom wave */}
      <div className="absolute bottom-0 left-0 right-0 h-1 opacity-20">
        <svg className="w-full h-full" preserveAspectRatio="none">
          {(() => {
            const base = 'M0,0 Q25,5 50,0 T100,0 Q125,5 150,0 T200,0';
            const alt = 'M0,5 Q25,0 50,5 T100,5 Q125,0 150,5 T200,5';
            return (
              <motion.path
                d={base}
                stroke="url(#footerGradient)"
                strokeWidth="2"
                fill="none"
                animate={{ d: [base, alt, base] }}
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: 'easeInOut',
                }}
              />
            );
          })()}
          <defs>
            <linearGradient id="footerGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#00F5FF" />
              <stop offset="50%" stopColor="#FF00FF" />
              <stop offset="100%" stopColor="#FFD700" />
            </linearGradient>
          </defs>
        </svg>
      </div>
    </footer>
  );
}
