import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { remotePrinters, useHousehold } from '@/lib/household';
import { connectPrinter, disconnectPrinter, tryReconnect, usePrinter } from '@/lib/printer';

import { colors, radius, space } from './theme';

/**
 * Printer status + connect control. When this device has no printer but someone in the household
 * does, it offers to print through theirs instead. `showTable` adds the household connection table.
 */
export function PrinterBar({ showTable = false }: { showTable?: boolean }) {
  const state = usePrinter();
  const household = useHousehold();
  useEffect(() => {
    tryReconnect();
  }, []);

  const supported = state.status !== 'unsupported';
  const connected = state.status === 'connected' || state.status === 'printing';
  const remote = remotePrinters(household);
  const via = !connected ? remote[0] : undefined;

  let chip: { label: string; on: boolean; onPress?: () => void } | null = null;
  if (state.status === 'connecting') chip = { label: 'Connecting…', on: false };
  else if (connected)
    chip = {
      label: state.status === 'printing' ? `Printing on ${state.name ?? 'D30'}…` : `Printer: ${state.name ?? 'D30'}`,
      on: true,
      onPress: disconnectPrinter,
    };
  else if (via) chip = { label: `Print via ${via.device_name}`, on: true };
  else if (supported) chip = { label: 'Connect printer', on: false, onPress: () => connectPrinter() };

  const served = household.lastServed && Date.now() - household.lastServed.at < 10 * 60_000 ? household.lastServed : null;

  return (
    <View style={{ gap: space(1) }}>
      {chip ? (
        <View style={s.row}>
          <Pressable
            accessibilityRole={chip.onPress ? 'button' : 'text'}
            disabled={!chip.onPress}
            onPress={chip.onPress}
            style={[s.chip, chip.on ? s.on : s.off]}>
            <View style={[s.dot, { backgroundColor: chip.on ? colors.green : colors.muted }]} />
            <Text style={s.chipText}>{chip.label}</Text>
          </Pressable>
          {supported && !connected && state.status !== 'connecting' ? (
            <Pressable onPress={() => connectPrinter(via ? {} : { acceptAll: true })}>
              <Text style={s.link}>{via ? 'Connect one here instead' : 'Printer not listed?'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {connected && household.sharing ? (
        <Text style={s.help}>
          Shared with your household{served ? ` · printed box #${served.number} for another device` : ''}. Keep the app open
          here so others can print.
        </Text>
      ) : null}
      {!connected && !via ? (
        <Text style={s.help}>
          {supported
            ? 'Or connect the D30 on any household device, and everyone can print through it.'
            : 'No printer is connected in your household. Connect the D30 from the Android app or Chrome on another device and keep it open. Then you can print from here.'}
        </Text>
      ) : null}
      {state.error ? <Text style={[s.help, { color: colors.red }]}>{state.error}</Text> : null}

      {showTable && household.printers.length ? <HouseholdTable /> : null}
    </View>
  );
}

/** The household connection status table: every device that can print right now. */
function HouseholdTable() {
  const { printers, deviceId } = useHousehold();
  return (
    <View style={s.table} accessibilityLabel="Household printers">
      <Text style={s.tableHead}>Household printers</Text>
      {printers.map((p) => (
        <View key={p.device_id} style={s.tableRow}>
          <View style={[s.dot, { backgroundColor: colors.green }]} />
          <Text style={s.tableName} numberOfLines={1}>
            {p.device_name}
            {p.device_id === deviceId ? ' (this device)' : ''}
          </Text>
          <Text style={s.tableMeta}>{p.printer_name ?? 'D30'}</Text>
        </View>
      ))}
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
  table: {
    marginTop: space(1),
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    paddingHorizontal: space(3),
    paddingVertical: space(2),
    gap: space(1),
  },
  tableHead: { fontSize: 12, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: space(2), minHeight: 28 },
  tableName: { flex: 1, fontSize: 14, color: colors.ink },
  tableMeta: { fontSize: 13, color: colors.muted },
});
