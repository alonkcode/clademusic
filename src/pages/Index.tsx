import { LandingNav } from '@/components/landing/LandingNav';
import { HeroSection } from '@/components/landing/HeroSection';
import { InteractiveDemo } from '@/components/landing/InteractiveDemo';
import { FeaturesGrid } from '@/components/landing/FeaturesGrid';
import { TestimonialsSection } from '@/components/landing/TestimonialsSection';
import { CTASection } from '@/components/landing/CTASection';
import { Footer } from '@/components/landing/Footer';

const Index = () => {
  return (
    <div className="min-h-screen bg-[#0A0A0F]">
      {/* LandingNav is this page's own nav (brand mark + Explore/Features/
          Demo/Testimonials/Pricing + its own mobile menu button) - the
          app-shell BottomNav doesn't belong here too. Rendering both gave
          mobile visitors two hamburger buttons on screen at once (this
          page's top-right vs BottomNav's floating top-left one). */}
      <LandingNav />
      <HeroSection />
      <div id="demo">
        <InteractiveDemo />
      </div>
      <FeaturesGrid />
      <div id="testimonials">
        <TestimonialsSection />
      </div>
      <CTASection />
      <Footer />
    </div>
  );
};

export default Index;
