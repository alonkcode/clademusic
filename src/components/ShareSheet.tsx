import { useState } from 'react';
import { motion } from 'framer-motion';
import { Share2, Copy, Check, Twitter, Send, Link2, MessageCircle } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Track } from '@/types';
import { TrackThumbnail } from '@/components/TrackThumbnail';

interface ShareSheetProps {
  track: Track;
  onShare?: () => void;
}

export function ShareSheet({ track, onShare }: ShareSheetProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const shareUrl = `${window.location.origin}/track/${track.id}`;
  const shareText = `Check out "${track.title}" by ${track.artist} on CladeMusic! 🎵`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast({ title: 'Link copied!' });
      setTimeout(() => setCopied(false), 2000);
      onShare?.();
    } catch (error) {
      toast({ title: 'Failed to copy', variant: 'destructive' });
    }
  };

  const handleNativeShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: track.title,
          text: shareText,
          url: shareUrl,
        });
        onShare?.();
        setOpen(false);
      } catch (error) {
        // User cancelled or error
      }
    }
  };

  const shareOptions = [
    {
      name: 'Copy Link',
      icon: copied ? Check : Copy,
      onClick: handleCopyLink,
      className: copied ? 'text-green-500' : '',
    },
    {
      name: 'Twitter/X',
      icon: Twitter,
      onClick: () => {
        window.open(
          `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
          '_blank'
        );
        onShare?.();
      },
    },
    {
      name: 'WhatsApp',
      icon: MessageCircle,
      onClick: () => {
        window.open(
          `https://wa.me/?text=${encodeURIComponent(shareText + ' ' + shareUrl)}`,
          '_blank'
        );
        onShare?.();
      },
    },
    {
      name: 'Telegram',
      icon: Send,
      onClick: () => {
        window.open(
          `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`,
          '_blank'
        );
        onShare?.();
      },
    },
  ];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground gap-2"
        >
          <Share2 className="w-4 h-4" />
          Share
        </Button>
      </SheetTrigger>

      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-primary" />
            Share "{track.title}"
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 pb-8">
          {/* Track preview */}
          <div className="flex gap-3 p-3 rounded-xl glass">
            <TrackThumbnail
              track={track}
              className="w-16 h-16 rounded-lg object-cover"
              fallback={
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                  <Link2 className="w-6 h-6 text-muted-foreground" />
                </div>
              }
            />
            <div className="flex-1 min-w-0">
              <h4 className="font-medium truncate">{track.title}</h4>
              <p className="text-sm text-muted-foreground truncate">{track.artist}</p>
            </div>
          </div>

          {/* Native share (mobile) */}
          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <Button 
              onClick={handleNativeShare}
              className="w-full gap-2"
              variant="default"
            >
              <Share2 className="w-4 h-4" />
              Share
            </Button>
          )}

          {/* Share options grid */}
          <div className="grid grid-cols-4 gap-3">
            {shareOptions.map((option) => (
              <motion.button
                key={option.name}
                whileTap={{ scale: 0.95 }}
                onClick={option.onClick}
                className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-muted/50 transition-colors"
              >
                <div className={`p-3 rounded-full bg-muted ${option.className || ''}`}>
                  <option.icon className="w-5 h-5" />
                </div>
                <span className="text-xs text-muted-foreground">{option.name}</span>
              </motion.button>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
