import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Footer } from '@/components/Footer';
import { Footer as LandingFooter } from '@/components/landing/Footer';

/**
 * Both footers used to link to a dozen pages that were never built - About,
 * Contact, Careers, Blog, FAQ, Docs, Guide, Community, Support, Cookie
 * Policy, Licenses - every one dead-ending on the 404 page across nearly
 * every screen in the app (the plain Footer alone is rendered on ~19
 * pages). Asserts nothing here still points at one of those, and that the
 * real destinations that replaced them resolve to actual routes/mailto.
 */

const REGISTERED_ROUTES = new Set([
  '/', '/pricing', '/billing', '/feed', '/auth', '/login', '/reset-password',
  '/signup', '/search', '/compare', '/profile', '/following',
  '/spotify-callback', '/playlists', '/forum', '/terms', '/privacy',
  '/survey', '/admin',
]);

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>{ui}</MemoryRouter>
  );
}

describe('components/Footer (rendered on most interior pages)', () => {
  it('has no links to unbuilt pages', () => {
    const { container } = renderWithRouter(<Footer />);
    const hrefs = Array.from(container.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') ?? '');

    for (const href of hrefs) {
      if (href.startsWith('http') || href.startsWith('mailto:')) continue; // external/email, not a route
      expect(REGISTERED_ROUTES.has(href) || href.startsWith('/#')).toBe(true);
    }
  });

  it('Contact is a real mailto:, not a /contact route that only ever 404d', () => {
    renderWithRouter(<Footer />);
    const contact = screen.getByText('Contact').closest('a');
    expect(contact?.getAttribute('href')).toMatch(/^mailto:/);
  });

  it('the GitHub icon points at the real repo, not the bare github.com homepage', () => {
    const { container } = renderWithRouter(<Footer />);
    const github = container.querySelector('a[aria-label="GitHub"]');
    expect(github?.getAttribute('href')).toMatch(/^https:\/\/github\.com\/.+\/.+/);
  });

  it('no longer offers a Twitter icon with no real account behind it', () => {
    const { container } = renderWithRouter(<Footer />);
    expect(container.querySelector('a[aria-label="Twitter"]')).not.toBeInTheDocument();
  });
});

describe('landing/Footer (rendered on the landing page and /pricing)', () => {
  it('has no links to unbuilt pages', () => {
    const { container } = renderWithRouter(<LandingFooter />);
    const anchorHrefs = Array.from(container.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') ?? '');

    for (const href of anchorHrefs) {
      if (href.startsWith('http') || href.startsWith('mailto:')) continue;
      expect(REGISTERED_ROUTES.has(href) || href.startsWith('/#')).toBe(true);
    }
  });

  it('mailto: entries render as real <a> tags, not react-router Links (which cannot open a mail client)', () => {
    const { container } = renderWithRouter(<LandingFooter />);
    const mailLinks = Array.from(container.querySelectorAll('a[href^="mailto:"]'));
    expect(mailLinks.length).toBeGreaterThan(0);
  });
});
