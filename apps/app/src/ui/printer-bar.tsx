import { useMutation, useQuery } from '@tanstack/react-query';
import { SymbolView } from 'expo-symbols';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { remotePrinters, useHousehold } from '@/lib/household';
import { connectPrinter, disconnectPrinter, usePrinter } from '@/lib/printer';
import { queries } from '@/lib/queries';

import { Button, Card, styles } from './components';
import { colors, radius, space } from './theme';

export function PrinterButton({ availability, onPress }: {
  availability: 'ready' | 'setup' | 'unavailable';
  onPress: () => void;
}) {
  const available = availability === 'ready';
  const materialSymbol = availability === 'unavailable' ? 'print_disabled' : 'print';
  const statusLabel = {
    ready: 'printer available',
    setup: 'connect a printer',
    unavailable: 'printing unavailable',
  }[availability];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Printer options, ${statusLabel}`}
      onPress={onPress}
      style={({ pressed }) => [s.iconButton, pressed && { opacity: 0.6 }]}>
      <SymbolView
        name={{ ios: available ? 'printer.fill' : 'printer', android: materialSymbol, web: materialSymbol }}
        tintColor={available ? colors.green : colors.muted}
        size={24}
        aria-hidden
        importantForAccessibility="no-hide-descendants"
      />
    </Pressable>
  );
}

export function PrinterOptions({ visible, houseId, onClose }: { visible: boolean; houseId: string; onClose: () => void }) {
  return (
    <Modal transparent visible={visible} onRequestClose={onClose} animationType="fade">
      <View style={s.modal}>
        <Card style={s.modalCard}>
          <Text accessibilityRole="header" style={styles.h2}>Printer</Text>
          <PrinterBar houseId={houseId} />
          <Button label="Done" variant="secondary" onPress={onClose} />
        </Card>
      </View>
    </Modal>
  );
}

/**
 * Printer status + connect control. When this device has no printer but another device in the
 * current house does, it offers to print through that one. `showTable` adds the house's printer table.
 */
export function PrinterBar({ showTable = false, houseId }: { showTable?: boolean; houseId?: string }) {
  const state = usePrinter();
  const household = useHousehold();
  useQuery(queries.printerReconnect());
  const connect = useMutation({ mutationFn: (opts: { acceptAll?: boolean }) => connectPrinter(opts) });

  const supported = state.status !== 'unsupported';
  const connected = state.status === 'connected' || state.status === 'printing';
  const via =
    !connected && (houseId === undefined || houseId === household.houseId) ? remotePrinters(household)[0] : undefined;

  let chip: { label: string; on: boolean; onPress?: () => void } | null = null;
  if (state.status === 'connecting') chip = { label: 'Connecting…', on: false };
  else if (connected)
    chip = {
      label: state.status === 'printing' ? `Printing on ${state.name ?? 'D30'}…` : `Printer: ${state.name ?? 'D30'}`,
      on: true,
      onPress: disconnectPrinter,
    };
  else if (via) chip = { label: `Print via ${via.device_name}`, on: true };
  else if (supported) chip = { label: 'Connect printer', on: false, onPress: () => connect.mutate({}) };

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
            <Pressable onPress={() => connect.mutate(via ? {} : { acceptAll: true })}>
              <Text style={s.link}>{via ? 'Connect one here instead' : 'Printer not listed?'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {!connected && !via ? (
        <Text style={s.help}>
          {supported
            ? 'Or connect the D30 on any device in your house, and everyone can print through it.'
            : 'No printer is connected in your house. Connect the D30 from the Android app or Chrome on another device and keep it open. Then you can print from here.'}
        </Text>
      ) : null}
      {state.error ? <Text style={[s.help, { color: colors.red }]}>{state.error}</Text> : null}

      {showTable && household.printers.length ? <HouseholdTable /> : null}
    </View>
  );
}

/** The house's connection status table: every device in it that can print right now. */
function HouseholdTable() {
  const { printers, deviceId } = useHousehold();
  return (
    <View style={s.table} accessibilityLabel="Printers in this house">
      <Text style={s.tableHead}>Printers in this house</Text>
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
  iconButton: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  modal: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(4), backgroundColor: 'rgba(29, 26, 22, 0.4)' },
  modalCard: { width: '100%', maxWidth: 360 },
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
