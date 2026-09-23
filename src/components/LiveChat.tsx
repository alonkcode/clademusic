import { useMemo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Users, X, Smile, Reply } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';
import { useLocalBotChat } from '@/chat/useLocalBotChat';

interface ChatMessage {
  id: string;
  user_id: string;
  message: string;
  created_at: string;
  reply_to?: string | null;
  user?: {
    id: string;
    display_name?: string;
    avatar_url?: string;
  };
}

interface UserPresence {
  user_id: string;
  status: 'online' | 'away' | 'offline';
  current_track_id?: string;
}

interface LiveChatProps {
  roomId?: string;
  roomType?: 'global' | 'track';
  trackId?: string;
  className?: string;
}

// If the backend environment doesn't provision chat_messages/chat_rooms, avoid repeated 404 spam
let chatSchemaMissing = false;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function getOrCreateTrackRoom(trackId: string): Promise<string | null> {
  const find = async () => {
    const { data } = await supabase
      .from('chat_rooms')
      .select('id')
      .eq('type', 'track')
      .eq('track_id', trackId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return data?.id ?? null;
  };

  const existing = await find();
  if (existing) return existing;

  const { data: created, error } = await supabase
    .from('chat_rooms')
    .insert({ name: 'Track Chat', type: 'track', track_id: trackId })
    .select('id')
    .single();
  if (!error && created) return created.id;
  // Another client created the same track room first (unique index): use theirs.
  if ((error as any)?.code === '23505') return find();
  throw error;
}

export function LiveChat({ 
  roomId = 'global', 
  roomType = 'global',
  trackId,
  className = '' 
}: LiveChatProps) {
  const disabled = chatSchemaMissing;
  const { user } = useAuth();
  const demoEnabled = disabled || !user;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [onlineUsers, setOnlineUsers] = useState<UserPresence[]>([]);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  // chat_messages.room_id is a uuid, so the 'global' room type is resolved to
  // its real id before any query, subscription or insert uses it.
  const [resolvedRoomId, setResolvedRoomId] = useState<string | null>(null);
  const selfProfileRef = useRef<ChatMessage['user'] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const demoRoomKey = useMemo(() => {
    if (roomType === 'track' && trackId) return `track:${trackId}`;
    return `room:${roomId}`;
  }, [roomId, roomType, trackId]);

  const demo = useLocalBotChat({
    enabled: demoEnabled,
    roomKey: demoRoomKey,
    localDisplayName: (user as any)?.user_metadata?.full_name || (user as any)?.email || 'You',
  });

  // Resolve the room, then load its history
  useEffect(() => {
    if (demoEnabled) return;
    if (disabled) return;
    if (!user) return;

    let cancelled = false;
    setResolvedRoomId(null);
    setMessages([]);
    setIsLoading(true);

    const initRoom = async () => {
      try {
        let id: string | null = null;

        if (UUID_PATTERN.test(roomId)) {
          id = roomId;
        } else if (roomType === 'global') {
          const { data: room } = await supabase
            .from('chat_rooms')
            .select('id')
            .eq('type', 'global')
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
          id = room?.id ?? null;
        } else if (roomType === 'track' && trackId) {
          id = await getOrCreateTrackRoom(trackId);
        }

        if (cancelled) return;
        if (!id) {
          setIsLoading(false);
          return;
        }
        setResolvedRoomId(id);
        await loadMessages(id, () => cancelled);
      } catch (error) {
        console.error('Error initializing chat room:', error);
        if (!cancelled) setIsLoading(false);
      }
    };

    initRoom();
    return () => {
      cancelled = true;
    };
  }, [user?.id, roomId, roomType, trackId, disabled, demoEnabled]);

  // Load the most recent messages, oldest first
  const loadMessages = async (chatRoomId: string, isCancelled: () => boolean = () => false) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('chat_messages')
        .select('id, user_id, message, created_at, reply_to, profiles_public(display_name, avatar_url)')
        .eq('room_id', chatRoomId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (isCancelled()) return;

      if (error) {
        if ((error as any)?.code === 'PGRST205' || (error as any)?.message?.includes("Could not find the table 'public.chat_messages'")) {
          console.warn('[LiveChat] chat_messages table missing; disabling chat UI');
          chatSchemaMissing = true;
          setMessages([]);
          setIsLoading(false);
          return;
        }
        throw error;
      }
      setMessages(
        (data || [])
          .map((m: any) => ({
            id: m.id,
            user_id: m.user_id,
            message: m.message,
            created_at: m.created_at,
            reply_to: m.reply_to,
            user: m.profiles_public ? { id: m.user_id, ...m.profiles_public } : undefined,
          }))
          .reverse()
      );
      scrollToBottom();
    } catch (error) {
      console.error('Error loading messages:', error);
    } finally {
      if (!isCancelled()) setIsLoading(false);
    }
  };

  // Subscribe to new messages
  useEffect(() => {
    if (demoEnabled) return;
    if (disabled) return;
    if (!user) return;
    if (!resolvedRoomId) return;

    const channel = supabase
      .channel(`chat:${resolvedRoomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${resolvedRoomId}`,
        },
        async (payload) => {
          const incoming = payload.new as ChatMessage;
          // profiles' RLS only lets a user read their own row, so authors are
          // looked up through the public view or every other user is anonymous.
          const { data: userData } = await supabase
            .from('profiles_public')
            .select('id, display_name, avatar_url')
            .eq('id', incoming.user_id)
            .maybeSingle();

          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id)
              ? prev
              : [...prev, { ...incoming, user: userData ?? undefined }]
          );
          scrollToBottom();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, resolvedRoomId]);

  // Subscribe to user presence (per room, so the count reflects this room)
  useEffect(() => {
    if (demoEnabled) return;
    if (disabled) return;
    if (!user) return;
    if (!resolvedRoomId) return;

    const presenceChannel = supabase.channel(`presence:${resolvedRoomId}`, {
      config: { presence: { key: user.id } },
    });

    presenceChannel
      .on('presence', { event: 'sync' }, () => {
        const state = presenceChannel.presenceState();
        const users = Object.values(state).flat() as UserPresence[];
        setOnlineUsers(users);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await presenceChannel.track({
            user_id: user.id,
            status: 'online',
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      supabase.removeChannel(presenceChannel);
    };
  }, [user?.id, resolvedRoomId]);

  // Update presence on mount/unmount
  useEffect(() => {
    if (demoEnabled) return;
    if (disabled) return;
    if (!user) return;

    const updatePresence = async (status: 'online' | 'offline') => {
      await supabase
        .from('user_presence')
        .upsert({
          user_id: user.id,
          status,
          current_track_id: trackId,
          last_seen: new Date().toISOString(),
        });
    };

    updatePresence('online');

    return () => {
      updatePresence('offline');
    };
  }, [user, trackId]);

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    if (demoEnabled) {
      demo.sendLocalMessage(newMessage, replyingTo?.id || null);
      setNewMessage('');
      setReplyingTo(null);
      inputRef.current?.focus();
      return;
    }

    if (!user || !resolvedRoomId) return;

    try {
      const { data: inserted, error } = await supabase
        .from('chat_messages')
        .insert({
          room_id: resolvedRoomId,
          user_id: user.id,
          message: newMessage.trim(),
          reply_to: replyingTo?.id || null,
        })
        .select('id, user_id, message, created_at, reply_to')
        .single();

      if (error) throw error;

      // The realtime subscription echoes this row back too, but only where the
      // table is published to realtime. Show it now regardless; the echo is
      // dropped as a duplicate by id.
      if (inserted) {
        if (!selfProfileRef.current) {
          const { data: me } = await supabase
            .from('profiles_public')
            .select('id, display_name, avatar_url')
            .eq('id', user.id)
            .maybeSingle();
          selfProfileRef.current = me ?? { id: user.id };
        }
        const self = selfProfileRef.current;
        setMessages((prev) =>
          prev.some((m) => m.id === inserted.id)
            ? prev
            : [...prev, { ...(inserted as ChatMessage), user: self }]
        );
        scrollToBottom();
      }

      setNewMessage('');
      setReplyingTo(null);
      inputRef.current?.focus();
    } catch (error) {
      console.error('Error sending message:', error);
      toast({ title: "Message not sent", description: 'Please try again.', variant: 'destructive' });
    }
  };

  const activeUserId = demoEnabled ? demo.localUserId : user?.id;
  const effectiveMessages = (demoEnabled ? (demo.messages as any) : messages) as ChatMessage[];

  return (
    <div className={`flex flex-col glass rounded-xl overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          <h3 className="font-semibold">
            {roomType === 'global' ? 'Global Chat' : 'Track Chat'}
          </h3>
          {demoEnabled && (
            <Badge variant="secondary" className="text-xs">
              Demo
            </Badge>
          )}
          <Badge variant="secondary" className="text-xs">
            {(demoEnabled ? demo.onlineUsers.length : onlineUsers.length)} online
          </Badge>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4 h-[400px]">
        {!demoEnabled && isLoading ? (
          <div className="text-center py-8">
            <div className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : effectiveMessages.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-12 h-12 mx-auto mb-3 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">
              {demoEnabled ? 'Demo chat is warming up…' : 'No messages yet. Start the conversation!'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {effectiveMessages.map((msg) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className={`flex gap-3 ${
                    activeUserId && msg.user_id === activeUserId ? 'flex-row-reverse' : ''
                  }`}
                >
                  <Avatar className="w-8 h-8 flex-shrink-0">
                    {msg.user?.avatar_url ? (
                      <img src={msg.user.avatar_url} alt="" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-semibold">
                        {msg.user?.display_name?.[0]?.toUpperCase() || '?'}
                      </div>
                    )}
                  </Avatar>

                  <div
                    className={`flex-1 min-w-0 ${
                      activeUserId && msg.user_id === activeUserId ? 'text-right' : ''
                    }`}
                  >
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className="text-sm font-medium truncate">
                        {msg.user?.display_name || 'Anonymous'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(msg.created_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>

                    {msg.reply_to && (
                      <div className="text-xs text-muted-foreground mb-1 opacity-70">
                        <Reply className="w-3 h-3 inline mr-1" />
                        Replying to message
                      </div>
                    )}

                    <div
                      className={`inline-block px-3 py-2 rounded-lg max-w-[80%] break-words ${
                        activeUserId && msg.user_id === activeUserId
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted'
                      }`}
                    >
                      <p className="text-sm">{msg.message}</p>
                    </div>

                    {activeUserId && msg.user_id !== activeUserId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs mt-1 opacity-0 hover:opacity-100 transition-opacity"
                        onClick={() => setReplyingTo(msg)}
                      >
                        <Reply className="w-3 h-3 mr-1" />
                        Reply
                      </Button>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={scrollRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t">
        {replyingTo && (
          <div className="mb-2 p-2 bg-muted rounded-lg flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              <Reply className="w-3 h-3 inline mr-1" />
              Replying to {replyingTo.user?.display_name}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => setReplyingTo(null)}
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}

        <form onSubmit={sendMessage} className="flex gap-2">
          <Input
            ref={inputRef}
            placeholder={demoEnabled ? 'Type a message (demo)…' : 'Type a message…'}
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            className="flex-1"
            maxLength={500}
          />
          <Button type="submit" size="icon" disabled={!newMessage.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </form>
        {demoEnabled && (
          <p className="mt-2 text-xs text-muted-foreground">
            Demo mode uses local bot users. Sign in + enable Supabase chat tables for real-time chat.
          </p>
        )}
      </div>
    </div>
  );
}
