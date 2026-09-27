import { motion } from 'framer-motion';

export function FeedSkeleton() {
  return (
    <div className="relative w-full h-full flex flex-col">
      {/* Background */}
      <div className="absolute inset-0 z-0">
        <div className="w-full h-full bg-gradient-to-br from-secondary to-background animate-shimmer" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex-1 flex flex-col justify-start p-4 pb-5 space-y-4 sm:p-6 sm:pb-8">
        {/* Track info skeleton */}
        <div className="space-y-3">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="h-8 w-3/4 bg-muted/50 rounded-lg animate-shimmer"
          />
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.05 }}
            className="h-6 w-1/2 bg-muted/50 rounded-lg animate-shimmer"
          />
        </div>

        {/* Play button skeleton */}
        <div className="h-12 w-36 bg-muted/50 rounded-xl animate-shimmer" />

        {/* Harmony card skeleton */}
        <div className="glass-strong rounded-2xl p-4 space-y-3">
          <div className="h-4 w-24 bg-muted/50 rounded animate-shimmer" />
          <div className="flex gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-8 w-12 bg-muted/50 rounded-lg animate-shimmer"
                style={{ animationDelay: `${i * 100}ms` }}
              />
            ))}
          </div>
        </div>

        {/* Action buttons skeleton */}
        <div className="flex items-center justify-between pt-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              <div className="w-12 h-12 bg-muted/50 rounded-full animate-shimmer" />
              <div className="w-10 h-3 bg-muted/50 rounded animate-shimmer" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
