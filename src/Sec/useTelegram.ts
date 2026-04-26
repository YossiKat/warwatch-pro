import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface TelegramMessage {
  id: string;
  update_id: number;
  chat_id: number;
  message_id: number | null;
  sender_name: string | null;
  text: string | null;
  message_date: string | null;
  content_hash: string | null;
  is_duplicate: boolean;
  duplicate_of: string | null;
  severity: string;
  tags: string[];
  created_at: string;
}

interface TelegramGroup {
  id: string;
  chat_id: number;
  title: string;
  type: string;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
}

interface TelegramStats {
  totalMessages: number;
  duplicates: number;
  uniqueMessages: number;
  groups: TelegramGroup[];
  severityCounts: Record<string, number>;
  messagesByGroup: Record<string, number>;
  recentMessages: TelegramMessage[];
}

const ALERT_KEYWORD_RE = /אזעקה|צבע אדום|רקטה|טיל|יירוט|שיגור|נפילה|פיצוץ|חילופי אש|انفجار|إطلاق|صواريخ|غارة|Explosion|Missile|Launch|Air strike|Siren|Red alert/i;
const TEN_MINUTES_MS = 10 * 60 * 1000;

export function useTelegram() {
  const [messages, setMessages] = useState<TelegramMessage[]>([]);
  const [groups, setGroups] = useState<TelegramGroup[]>([]);
  const [isPolling, setIsPolling] = useState(false);
  const [lastPoll, setLastPoll] = useState<Date | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchMessages = useCallback(async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('telegram_messages')
      .select('id,created_at,is_duplicate,content_hash,message_date,text,sender_name,message_id,chat_id,update_id,duplicate_of,severity,tags,bot_name')
      .gte('created_at', twoHoursAgo)
      .not('text', 'is', null)
      .neq('text', '')
      .order('created_at', { ascending: false })
      .limit(500);

    if (!error && data) {
      setMessages(data as TelegramMessage[]);
    }
  }, []);

  const fetchGroups = useCallback(async () => {
    const { data, error } = await supabase
      .from('telegram_groups')
      .select('*')
      .order('last_message_at', { ascending: false });

    if (!error && data) {
      setGroups(data as TelegramGroup[]);
    }
  }, []);

  const refreshData = useCallback(async () => {
    await Promise.all([fetchMessages(), fetchGroups()]);
  }, [fetchMessages, fetchGroups]);

  const triggerPoll = useCallback(async (silent = false) => {
    if (!silent) setIsPolling(true);
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      await fetch(`https://${projectId}.supabase.co/functions/v1/telegram-poll`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});

      setLastPoll(new Date());
      window.setTimeout(() => {
        void refreshData();
      }, 2000);
    } finally {
      if (!silent) setIsPolling(false);
    }
  }, [refreshData]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  useEffect(() => {
    const channel = supabase
      .channel(`telegram-rt-${Date.now()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telegram_messages' }, (payload) => {
        setMessages(prev => [payload.new as TelegramMessage, ...prev].slice(0, 300));
        setLastPoll(new Date());
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      void refreshData();
    };

    intervalRef.current = setInterval(refresh, 30000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshData]);

  useEffect(() => {
    const handleWake = () => {
      if (document.visibilityState === 'hidden') return;
      void refreshData();
    };

    window.addEventListener('focus', handleWake);
    window.addEventListener('pageshow', handleWake);
    window.addEventListener('online', handleWake);
    document.addEventListener('visibilitychange', handleWake);

    return () => {
      window.removeEventListener('focus', handleWake);
      window.removeEventListener('pageshow', handleWake);
      window.removeEventListener('online', handleWake);
      document.removeEventListener('visibilitychange', handleWake);
    };
  }, [refreshData]);

  const filteredMessages = messages.filter(m => {
    const ageMs = Date.now() - new Date(m.created_at).getTime();
    if (ALERT_KEYWORD_RE.test(m.text || '') && ageMs > TEN_MINUTES_MS) return false;
    return true;
  });

  const stats: TelegramStats = {
    totalMessages: filteredMessages.length,
    duplicates: filteredMessages.filter(m => m.is_duplicate).length,
    uniqueMessages: filteredMessages.filter(m => !m.is_duplicate).length,
    groups,
    severityCounts: filteredMessages.reduce((acc, m) => {
      acc[m.severity] = (acc[m.severity] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    messagesByGroup: filteredMessages.reduce((acc, m) => {
      const key = m.chat_id.toString();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    recentMessages: filteredMessages.slice(0, 50),
  };

  return { messages: filteredMessages, groups, stats, isPolling, lastPoll, triggerPoll, fetchMessages };
}
