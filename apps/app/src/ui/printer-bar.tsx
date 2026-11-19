import { useMutation, useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { connectPrinter, disconnectPrinter, printerHelp, tryReconnect, usePrinter } from '@/lib/printer';
import { keys } from '@/lib/query';

import { colors, radius, space } from './theme';

/** Compact printer status + connect control. */
export function PrinterBar() {
  const state = usePrinter();
  // Silently reconnect to the last-used printer once per app session (shared across screens).
  useQuery({
    queryKey: keys.printerReconnect,
    queryFn: async () => {
      await tryReconnect();
      return true;
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const connect = useMutation({ mutationFn: (opts: { acceptAll?: boolean }) => connectPrinter(opts) });

  if (state.status === 'unsupported') {
    return <Text style={s.help}>{printerHelp}</Text>;
  }

  const connected = state.status === 'connected' || state.status === 'printing';
  const label =
    state.status === 'connecting'
      ? 'Connecting…'
      : state.status === 'printing'
        ? `Printing on ${state.name ?? 'D30'}…`
        : connected
          ? `Printer: ${state.name ?? 'D30'}`
          : 'Connect printer';

  return (
    <View style={{ gap: space(1) }}>
      <View style={s.row}>
        <Pressable
          accessibilityRole="button"
          onPress={() => (connected ? disconnectPrinter() : connect.mutate({}))}
          style={[s.chip, connected ? s.on : s.off]}>
          <View style={[s.dot, { backgroundColor: connected ? colors.green : colors.muted }]} />
          <Text style={s.chipText}>{label}</Text>
        </Pressable>
        {!connected ? (
          <Pressable onPress={() => connect.mutate({ acceptAll: true })}>
            <Text style={s.link}>Printer not listed?</Text>
          </Pressable>
        ) : null}
      </View>
      {state.error ? <Text style={[s.help, { color: colors.red }]}>{state.error}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    paddingHorizontal: space(3),
    minHeight: 36,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  on: { backgroundColor: colors.greenSoft, borderColor: colors.greenSoft },
  off: { backgroundColor: colors.card, borderColor: colors.line },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontSize: 14, fontWeight: '600', color: colors.ink },
  link: { fontSize: 14, color: colors.kraftDark, textDecorationLine: 'underline' },
  help: { fontSize: 13, color: colors.muted, lineHeight: 18 },
});
