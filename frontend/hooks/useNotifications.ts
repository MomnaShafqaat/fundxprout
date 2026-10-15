'use client';
// frontend/hooks/useNotifications.ts
// Connects to the private Socket.IO /notifications namespace and fetches notification history.

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { createClient } from '@/utils/supabase/client';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

export type AppNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  metadata: Record<string, any>;
  created_at: string;
};

export function useNotifications() {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const socketRef = useRef<Socket | null>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;

      let loaded = false;
      try {
        const res = await fetch(`${API_BASE}/api/notifications?limit=100`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const { notifications: data, unreadCount: count } = await res.json();
          setNotifications(data || []);
          setUnreadCount(count || 0);
          loaded = true;
        }
      } catch { /* fallback to direct Supabase query */ }

      if (!loaded && sessionData.session?.user?.id) {
        const { data: dbNotifs } = await supabase
          .from('notifications')
          .select('*')
          .eq('user_id', sessionData.session.user.id)
          .order('created_at', { ascending: false })
          .limit(50);
        if (dbNotifs) {
          setNotifications(dbNotifs as AppNotification[]);
          setUnreadCount(dbNotifs.filter((n: any) => !n.is_read).length);
        }
      }
    } catch { /* silent */ }
  }, []);

  // Connect socket and Supabase Realtime subscription
  useEffect(() => {
    let userId: string | null = null;
    let channel: any = null;

    const connect = async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      userId = data.session?.user?.id ?? null;
      if (!userId) return;

      await fetchNotifications();

      // 1. Socket.IO connection
      const socket: Socket = io(`${API_BASE}/notifications`, {
        transports: ['websocket'],
        autoConnect: false,
      });

      socket.connect();
      socket.emit('joinUserRoom', userId);

      socket.on('newNotification', (notification: AppNotification) => {
        setNotifications((prev) => {
          if (prev.some((n) => n.id === notification.id)) return prev;
          return [notification, ...prev];
        });
        setUnreadCount((prev) => prev + 1);
      });

      socketRef.current = socket;

      // 2. Supabase Realtime DB Trigger subscription
      channel = supabase
        .channel(`user_notifications_${userId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const newNotif = payload.new as AppNotification;
            setNotifications((prev) => {
              if (prev.some((n) => n.id === newNotif.id)) return prev;
              return [newNotif, ...prev];
            });
            setUnreadCount((prev) => prev + 1);
          }
        )
        .subscribe();
    };

    connect();

    return () => {
      if (socketRef.current && userId) {
        socketRef.current.emit('leaveUserRoom', userId);
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      if (channel) {
        const supabase = createClient();
        supabase.removeChannel(channel);
      }
    };
  }, [fetchNotifications]);


  const markAllRead = useCallback(async () => {
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      await fetch(`${API_BASE}/api/notifications/read-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch { /* silent */ }
  }, []);

  const markOneRead = useCallback(async (id: string) => {
    try {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;

      await fetch(`${API_BASE}/api/notifications/${id}/read`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch { /* silent */ }
  }, []);

  return { notifications, unreadCount, markAllRead, markOneRead, refetch: fetchNotifications };
}
