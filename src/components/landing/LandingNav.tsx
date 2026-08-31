import { motion, useScroll, useTransform } from 'framer-motion';
import { LogIn, Menu } from 'lucide-react';
import { CladeMark } from '@/components/CladeMark';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';

export function LandingNav() {
  const navigate = useNavigate();
  const { scrollY } = useScroll();
  const [isVisible, setIsVisible] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const backgroundColor = useTransform(
    scrollY,
    [0, 100],
    ['rgba(10, 10, 15, 0)', 'rgba(10, 10, 15, 0.95)']
  );

  const backdropBlur = useTransform(
    scrollY,
    [0, 100],
    ['blur(0px)', 'blur(12px)']
  );

  useEffect(() => {
    const handleScroll = () => {
      setIsVisible(window.scrollY > 100);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navItems = [
    { label: 'Explore', href: '/auth' },
    { label: 'Features', href: '#features' },
    { label: 'Demo', href: '#demo' },
    { label: 'Testimonials', href: '#testimonials' },
    { label: 'Pricing', href: '/pricing' },
  ];

  const scrollToSection = (href: string) => {
    if (href.startsWith('#')) {
      const element = document.querySelector(href);
      element?.scrollIntoView({ behavior: 'smooth' });
    } else {
      navigate(href);
    }
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      <motion.nav
        style={{
          backgroundColor,
          backdropFilter: backdropBlur,
        }}
        className="fixed top-0 left-0 right-0 z-50"
        initial={{ y: -100 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="container mx-auto px-6">
          <div className="flex items-center justify-between h-20">
            {/* Brand. The app-wide hamburger is fixed in this corner, so the
                lockup starts clear of it rather than sitting underneath. */}
            <motion.button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.99 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="flex items-center space-x-3 ml-12 md:ml-16"
            >
              <CladeMark className="w-9 h-9 text-white" />
              <span className="text-2xl font-bold bg-gradient-to-r from-[#00F5FF] via-[#FF00FF] to-[#FFD700] bg-clip-text text-transparent">
                Clade
              </span>
            </motion.button>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center space-x-8">
              {navItems.map((item) => (
                <motion.button
                  key={item.label}
                  onClick={() => scrollToSection(item.href)}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.99 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className="text-gray-300 hover:text-white transition-colors font-medium"
                >
                  {item.label}
                </motion.button>
              ))}

              <Button
                onClick={() => navigate('/auth')}
                size="sm"
                className="bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] hover:shadow-lg hover:shadow-[#00F5FF]/50 transition-all"
              >
                <LogIn className="w-4 h-4 mr-2" />
                Sign In
              </Button>
            </div>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden p-2 text-white"
            >
              <Menu className="w-6 h-6" />
            </button>
          </div>
        </div>
      </motion.nav>

      {/* Mobile Menu */}
      <motion.div
        initial={{ opacity: 0, x: '100%' }}
        animate={{
          opacity: isMobileMenuOpen ? 1 : 0,
          x: isMobileMenuOpen ? 0 : '100%',
        }}
        transition={{ duration: 0.3 }}
        className="fixed inset-y-0 right-0 w-64 bg-[#0A0A0F] border-l border-gray-900 z-50 md:hidden"
      >
        <div className="p-6 space-y-4">
          {navItems.map((item) => (
            <button
              key={item.label}
              onClick={() => scrollToSection(item.href)}
              className="block w-full text-left px-4 py-3 text-gray-300 hover:text-white hover:bg-[#1A1A2E] rounded-lg transition-colors"
            >
              {item.label}
            </button>
          ))}
          <Button
            onClick={() => {
              navigate('/auth');
              setIsMobileMenuOpen(false);
            }}
            className="w-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF]"
          >
            <LogIn className="w-4 h-4 mr-2" />
            Sign In
          </Button>
        </div>
      </motion.div>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setIsMobileMenuOpen(false)}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden"
        />
      )}

      {/* Scroll to Top Button */}
      {isVisible && (
        <motion.button
          initial={{ opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.5 }}
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.97 }}
          className="fixed bottom-8 right-8 z-50 w-12 h-12 rounded-full bg-gradient-to-r from-[#00F5FF] to-[#FF00FF] flex items-center justify-center shadow-lg shadow-[#00F5FF]/50"
        >
          <svg
            className="w-6 h-6 text-white"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 10l7-7m0 0l7 7m-7-7v18"
            />
          </svg>
        </motion.button>
      )}
    </>
  );
}
