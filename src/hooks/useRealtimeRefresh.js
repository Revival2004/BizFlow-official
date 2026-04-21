import { useEffect, useRef } from 'react';
import { supabase } from '../utils/supabase';

export function useRealtimeRefresh({
  channelName,
  bindings = [],
  enabled = true,
  debounceMs = 300,
  onChange,
}) {
  const onChangeRef = useRef(onChange);
  const timeoutRef = useRef(null);
  const bindingsKey = JSON.stringify(bindings);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!enabled || !bindings.length) {
      return undefined;
    }

    const trigger = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      timeoutRef.current = setTimeout(() => {
        onChangeRef.current?.();
      }, debounceMs);
    };

    let channel = supabase.channel(channelName);

    bindings.forEach((binding) => {
      channel = channel.on('postgres_changes', binding, trigger);
    });

    channel.subscribe();

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }

      supabase.removeChannel(channel);
    };
  }, [bindingsKey, channelName, debounceMs, enabled]);
}
